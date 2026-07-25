// controllers/user/subscriptionRecurring.controller.js
//
// True auto-debit recurring billing via the Razorpay Subscriptions API
// (UPI AutoPay / e-mandate). This is additive to subscription.controller.js's
// existing manual one-time-order flow — it does not replace or modify it.
//
// Flow: ₹5 addon charged at mandate authorization -> 3-day trial (start_at
// delays the first real cycle) -> ₹199 auto-charged every 30 days via the
// Razorpay Plan (period: daily, interval: 30) until cancelled/halted.
//
// WEBHOOK IS THE SOURCE OF TRUTH. Razorpay delivers subscription.* /
// payment.* events to POST /api/user/subscription/webhook (see
// razorpayWebhook in subscription.controller.js), which dispatches into the
// handleSubscription* functions below. Every one of those functions is
// idempotent (safe to run more than once for the same underlying payment/
// status), and the webhook route itself dedupes retried deliveries by raw
// body hash — see WebhookEvent.model.js.
//
// No cron job or polling is used to synchronize subscription/payment status.
//
// verifyRecurringSubscription is NOT polling — it's a synchronous,
// client-triggered check (same shape as the existing order-based
// verify-payment) that runs once, immediately after Razorpay Checkout's
// success callback fires, purely to give the user instant UI feedback
// instead of waiting on the webhook round-trip. It performs its own
// signature + Razorpay-API verification (never trusts the client) and
// funnels into the exact same handleSubscriptionAuthenticated used by the
// webhook, so there is a single source of truth for the business logic
// either way — the webhook remains authoritative and will independently
// confirm/reconcile the same event.

import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Subscription from '../../models/Subscription.model.js';
import SubscriptionPayment from '../../models/SubscriptionPayment.model.js';
import User from '../../models/User.model.js';
import NotificationService from '../../services/notification.service.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { TIMEZONE } from '../../utils/date.util.js';
import crypto from 'crypto';
import {
  getRazorpayInstance,
  createPaidWindow,
  syncUserSubscriptionState,
  PLAN_NAME,
  PLAN_PRICE,
  TRIAL_PLAN_NAME,
  TRIAL_PRICE,
  TRIAL_DAYS,
  DAY_MS,
} from './subscription.controller.js';

const TRIAL_AMOUNT_IN_PAISE = TRIAL_PRICE * 100;
// Razorpay requires a finite total_count; this is ~98 years of 30-day cycles,
// i.e. effectively "until cancelled" for any real-world subscriber.
const TOTAL_BILLING_CYCLES = 1200;
const IN_FLIGHT_RAZORPAY_STATUSES = ['authenticated', 'active', 'pending'];
const TERMINAL_RAZORPAY_STATUSES = ['cancelled', 'completed', 'expired'];

// ==============================
// CREATE RECURRING SUBSCRIPTION
// ==============================
export async function createRecurringSubscription(req, res) {
  try {
    const userId = req.user._id;

    const planId = process.env.RAZORPAY_PLAN_ID?.trim();
    if (!planId) {
      throw new ApiError(
        500,
        'Recurring plan is not configured. Run scripts/createRazorpaySubscriptionPlan.mjs and set RAZORPAY_PLAN_ID.'
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    const subscription = await Subscription.findOne({ userId });
    if (!subscription) {
      throw new ApiError(400, 'Subscription record not found. Please contact support.');
    }

    if (
      subscription.razorpaySubscriptionId &&
      IN_FLIGHT_RAZORPAY_STATUSES.includes(subscription.razorpaySubscriptionStatus)
    ) {
      throw new ApiError(
        400,
        'You already have a recurring subscription in progress or active.',
        [
          {
            razorpaySubscriptionId: subscription.razorpaySubscriptionId,
            status: subscription.razorpaySubscriptionStatus,
          },
        ]
      );
    }

    if (
      subscription.status === 'active' &&
      subscription.expiryDate &&
      subscription.expiryDate > new Date()
    ) {
      throw new ApiError(400, 'You already have an active subscription.', [
        { expiryDate: subscription.expiryDate, planName: subscription.planName },
      ]);
    }

    const razorpay = getRazorpayInstance();

    // Reuse an existing Razorpay customer for this user if we already created one
    let customerId = subscription.razorpayCustomerId;
    if (!customerId) {
      const customer = await razorpay.customers.create({
        name: user.name,
        email: user.email || undefined,
        contact: user.phone,
        fail_existing: 0, // reuse Razorpay's existing customer for this contact instead of erroring
        notes: { userId: userId.toString() },
      });
      customerId = customer.id;
    }

    // Delays the first ₹199 cycle by TRIAL_DAYS; the mandate + ₹5 addon is
    // still collected now, during authorization.
    const startAt = Math.floor((Date.now() + TRIAL_DAYS * DAY_MS) / 1000);

    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: planId,
      customer_id: customerId,
      total_count: TOTAL_BILLING_CYCLES,
      quantity: 1,
      customer_notify: 1,
      start_at: startAt,
      addons: [
        {
          item: {
            name: TRIAL_PLAN_NAME,
            amount: TRIAL_AMOUNT_IN_PAISE,
            currency: 'INR',
          },
        },
      ],
      notes: {
        userId: userId.toString(),
        subscriptionDocId: subscription._id.toString(),
      },
    });

    subscription.razorpayCustomerId = customerId;
    subscription.razorpaySubscriptionId = razorpaySubscription.id;
    subscription.razorpayPlanId = planId;
    subscription.razorpaySubscriptionStatus = razorpaySubscription.status;
    subscription.planName = PLAN_NAME;
    subscription.price = PLAN_PRICE;
    subscription.paymentMethod = 'upi_autopay';
    await subscription.save();

    if (String(user.subscriptionID || '') !== String(subscription._id)) {
      user.subscriptionID = subscription._id;
      await user.save();
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          razorpaySubscriptionId: razorpaySubscription.id,
          status: razorpaySubscription.status,
          shortUrl: razorpaySubscription.short_url,
          key: process.env.RAZORPAY_KEY_ID,
          authAmount: TRIAL_PRICE,
          recurringAmount: PLAN_PRICE,
          trialDays: TRIAL_DAYS,
        },
        'Recurring subscription created. Complete the ₹5 authorization to activate your trial.'
      )
    );
  } catch (error) {
    console.error('❌ RAZORPAY RECURRING SUBSCRIPTION ERROR:', error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      500,
      error?.error?.description || error?.message || 'Failed to create recurring subscription.'
    );
  }
}

// ==============================
// VERIFY RECURRING SUBSCRIPTION PAYMENT (₹5 authorization)
// Client calls this immediately after Razorpay Checkout's success handler
// fires (subscription-mode checkout returns razorpay_payment_id,
// razorpay_subscription_id, razorpay_signature — same idea as the existing
// order-based verify-payment, but the signature formula and identifiers
// differ because this is a Subscription, not an Order).
// This gives the user instant feedback; if the client never calls this
// (e.g. app killed right after payment), the subscription.authenticated
// webhook independently activates the trial regardless — the webhook is the
// authoritative fallback, not the other way around.
// ==============================
export async function verifyRecurringSubscription(req, res) {
  const userId = req.user._id;

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw new ApiError(
      400,
      'Payment verification data is required (razorpay_payment_id, razorpay_subscription_id, razorpay_signature).'
    );
  }

  const subscription = await Subscription.findOne({
    userId,
    razorpaySubscriptionId: razorpay_subscription_id,
  });

  if (!subscription) {
    throw new ApiError(404, 'Recurring subscription not found for this payment.');
  }

  // Idempotency — if this specific recurring subscription is already authenticated/active, no need to re-verify.
  if (
    subscription.razorpaySubscriptionStatus === 'authenticated' ||
    subscription.razorpaySubscriptionStatus === 'active'
  ) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          subscriptionId: subscription._id,
          status: subscription.status,
          trialEndDate: subscription.trialEndDate,
        },
        'Payment already verified.'
      )
    );
  }

  // Razorpay's signature formula for Subscriptions checkout differs from Orders:
  // hmac_sha256(razorpay_payment_id + "|" + razorpay_subscription_id, key_secret)
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    throw new ApiError(400, 'Payment verification failed. Invalid signature.');
  }

  const razorpay = getRazorpayInstance();
  const payment = await razorpay.payments.fetch(razorpay_payment_id);

  if (!payment) {
    throw new ApiError(404, 'Payment not found on Razorpay.');
  }
  if (payment.status !== 'captured') {
    throw new ApiError(400, `Payment is not captured. Current status: ${payment.status}`);
  }
  if (payment.amount !== TRIAL_AMOUNT_IN_PAISE) {
    throw new ApiError(400, `Unexpected authorization amount. Got ₹${payment.amount / 100}.`);
  }

  const rzpSubscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);

  await handleSubscriptionAuthenticated({
    subscription: { entity: rzpSubscription },
    payment: { entity: payment },
  });

  const refreshed = await Subscription.findById(subscription._id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        subscriptionId: refreshed._id,
        status: refreshed.status,
        trialEndDate: refreshed.trialEndDate,
        razorpaySubscriptionStatus: refreshed.razorpaySubscriptionStatus,
      },
      'Payment verified. Your 3-day trial is now active.'
    )
  );
}

// ==============================
// CANCEL RECURRING SUBSCRIPTION
// ==============================
export async function cancelRecurringSubscription(req, res) {
  const userId = req.user._id;

  const subscription = await Subscription.findOne({ userId });
  if (!subscription || !subscription.razorpaySubscriptionId) {
    throw new ApiError(404, 'No recurring subscription found for this user.');
  }

  if (TERMINAL_RAZORPAY_STATUSES.includes(subscription.razorpaySubscriptionStatus)) {
    return res.status(200).json(
      new ApiResponse(
        200,
        { status: subscription.razorpaySubscriptionStatus, expiryDate: subscription.expiryDate },
        'Subscription is already cancelled.'
      )
    );
  }

  try {
    const razorpay = getRazorpayInstance();
    // cancel_at_cycle_end: stop future charges, but the user keeps access
    // through the period already paid for (existing expiry cron handles the
    // actual cutoff once subscription.expiryDate passes).
    const cancelled = await razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId, {
      cancel_at_cycle_end: 1,
    });

    subscription.razorpaySubscriptionStatus = cancelled.status;
    subscription.cancelledAt = new Date();
    await subscription.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        { status: cancelled.status, expiryDate: subscription.expiryDate },
        'Subscription cancelled. No further charges will occur; you will retain access until your current period ends.'
      )
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      500,
      error?.error?.description || error?.message || 'Failed to cancel subscription.'
    );
  }
}

// ==============================
// GET RECURRING SUBSCRIPTION STATUS
// ==============================
export async function getRecurringSubscriptionStatus(req, res) {
  const userId = req.user._id;

  const subscription = await Subscription.findOne({ userId });

  if (!subscription || !subscription.razorpaySubscriptionId) {
    return res.status(200).json(
      new ApiResponse(200, { hasRecurringSubscription: false }, 'No recurring subscription found.')
    );
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        hasRecurringSubscription: true,
        razorpaySubscriptionId: subscription.razorpaySubscriptionId,
        razorpaySubscriptionStatus: subscription.razorpaySubscriptionStatus,
        status: subscription.status,
        nextBillingDate: subscription.nextBillingDate,
        billingCycleCount: subscription.billingCycleCount,
        expiryDate: subscription.expiryDate,
        trialEndDate: subscription.trialEndDate,
        cancelledAt: subscription.cancelledAt,
      },
      'Recurring subscription status retrieved.'
    )
  );
}

// ==============================
// WEBHOOK EVENT HANDLERS
// Called from subscription.controller.js's razorpayWebhook dispatcher.
// Each is idempotent — safe to run more than once for the same event.
// ==============================

export async function handleSubscriptionAuthenticated(payload) {
  const subEntity = payload?.subscription?.entity;
  const paymentEntity = payload?.payment?.entity;
  if (!subEntity?.id) return;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id }).session(session);
      if (!subscription) {
        console.log(`[WEBHOOK] subscription.authenticated — no local subscription for ${subEntity.id}`);
        return;
      }

      const alreadyActivated =
        ['trial', 'active'].includes(subscription.status) &&
        subscription.razorpaySubscriptionStatus === subEntity.status;

      const now = new Date();

      if (!alreadyActivated) {
        subscription.status = 'trial';
        subscription.planName = TRIAL_PLAN_NAME;
        subscription.price = TRIAL_PRICE;
        subscription.startDate = now;
        subscription.trialStartDate = now;
        subscription.trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
        subscription.trialNotificationSent = false;
        subscription.paidAt = now;
      }

      subscription.paymentMethod = paymentEntity?.method || subscription.paymentMethod || 'upi_autopay';
      subscription.razorpaySubscriptionStatus = subEntity.status;
      subscription.nextBillingDate = subEntity.current_end
        ? new Date(subEntity.current_end * 1000)
        : subscription.nextBillingDate;
      await subscription.save({ session });

      const user = await User.findById(subscription.userId).session(session);
      if (user) {
        user.isTrial = true;
        await syncUserSubscriptionState(user, subscription, session);
      }

      if (paymentEntity?.id) {
        await SubscriptionPayment.findOneAndUpdate(
          { razorpayPaymentId: paymentEntity.id },
          {
            $setOnInsert: {
              userId: subscription.userId,
              razorpayOrderId: paymentEntity.order_id || `sub_auth_${subEntity.id}`,
              planName: TRIAL_PLAN_NAME,
              amount: paymentEntity.amount,
              currency: paymentEntity.currency || 'INR',
              requestedPaymentMethod: 'upi_autopay',
            },
            $set: {
              subscriptionId: subscription._id,
              razorpaySubscriptionId: subEntity.id,
              razorpayPaymentId: paymentEntity.id,
              actualPaymentMethod: paymentEntity.method,
              gatewayStatus: paymentEntity.status,
              status: 'paid',
              verifiedAt: now,
              gatewayResponse: paymentEntity,
            },
          },
          { upsert: true, new: true, session }
        );
      }

      console.log(`[WEBHOOK] subscription.authenticated — trial activated for user ${subscription.userId}`);
    });
  } finally {
    await session.endSession();
  }
}

export async function handleSubscriptionCharged(payload) {
  const subEntity = payload?.subscription?.entity;
  const paymentEntity = payload?.payment?.entity;
  if (!subEntity?.id || !paymentEntity?.id) return;

  // Populated only for a genuinely new charge (not a duplicate delivery),
  // then used to notify the user after the transaction commits.
  let newChargeNotice = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id }).session(session);
      if (!subscription) {
        console.log(`[WEBHOOK] subscription.charged — no local subscription for ${subEntity.id}`);
        return;
      }

      // Idempotency: if this exact payment was already logged, only refresh
      // status/next-billing-date — don't re-extend the access window.
      const existingPayment = await SubscriptionPayment.findOne({
        razorpayPaymentId: paymentEntity.id,
      }).session(session);

      if (!existingPayment) {
        const { startDate, expiryDate } = createPaidWindow(new Date());
        subscription.status = 'active';
        subscription.planName = PLAN_NAME;
        subscription.price = PLAN_PRICE;
        subscription.startDate = startDate;
        subscription.expiryDate = expiryDate;
        subscription.paidAt = new Date();
        subscription.billingCycleCount = (subscription.billingCycleCount || 0) + 1;
      }

      subscription.razorpaySubscriptionStatus = subEntity.status;
      subscription.paymentMethod = paymentEntity.method || subscription.paymentMethod;
      subscription.nextBillingDate = subEntity.current_end
        ? new Date(subEntity.current_end * 1000)
        : subscription.nextBillingDate;
      await subscription.save({ session });

      await SubscriptionPayment.findOneAndUpdate(
        { razorpayPaymentId: paymentEntity.id },
        {
          $setOnInsert: {
            userId: subscription.userId,
            razorpayOrderId: paymentEntity.order_id || `sub_charge_${subEntity.id}_${paymentEntity.id}`,
            planName: PLAN_NAME,
            amount: paymentEntity.amount,
            currency: paymentEntity.currency || 'INR',
            requestedPaymentMethod: 'upi_autopay',
          },
          $set: {
            subscriptionId: subscription._id,
            razorpaySubscriptionId: subEntity.id,
            razorpayPaymentId: paymentEntity.id,
            actualPaymentMethod: paymentEntity.method,
            gatewayStatus: paymentEntity.status,
            status: 'paid',
            verifiedAt: new Date(),
            gatewayResponse: paymentEntity,
          },
        },
        { upsert: true, new: true, session }
      );

      if (!existingPayment) {
        const user = await User.findById(subscription.userId).session(session);
        if (user) {
          user.isTrial = false;
          await syncUserSubscriptionState(user, subscription, session);
        }
        console.log(
          `[WEBHOOK] subscription.charged — cycle #${subscription.billingCycleCount} (₹${PLAN_PRICE}) activated for user ${subscription.userId}`
        );

        newChargeNotice = {
          userId: subscription.userId,
          subscriptionId: subscription._id,
          expiryDate: subscription.expiryDate,
          cycleCount: subscription.billingCycleCount,
        };
      } else {
        console.log(`[WEBHOOK] subscription.charged — duplicate delivery for payment ${paymentEntity.id}, skipped`);
      }
    });
  } finally {
    await session.endSession();
  }

  // Sent after the transaction has committed, and only for a genuinely new
  // charge — duplicate webhook deliveries for the same payment never re-notify.
  if (newChargeNotice) {
    try {
      const expiryLabel = moment(newChargeNotice.expiryDate).tz(TIMEZONE).format('D MMM YYYY');
      await NotificationService.createNotification(newChargeNotice.userId, {
        type: 'subscription',
        title: '✅ Auto-Payment Successful',
        body: `₹${PLAN_PRICE} was auto-debited for your subscription. You're covered until ${expiryLabel}.`,
        status: 'success',
        data: {
          subscriptionId: newChargeNotice.subscriptionId.toString(),
          amount: PLAN_PRICE,
          cycleCount: newChargeNotice.cycleCount,
          expiryDate: newChargeNotice.expiryDate.toISOString(),
        },
        relatedEntityId: newChargeNotice.subscriptionId,
        relatedEntityType: 'subscription',
      });
    } catch (notifyError) {
      console.error(
        `[WEBHOOK] Failed to send auto-payment notification for user ${newChargeNotice.userId}:`,
        notifyError.message
      );
    }
  }
}

// subscription.activated / subscription.updated are pure status-sync events:
// the actual access-granting business logic (trial activation with its
// payment record, cycle activation with its payment record) is owned by
// handleSubscriptionAuthenticated / handleSubscriptionCharged, which are the
// only handlers that receive a payment entity and can log it idempotently.
// Duplicating that logic here (without a payment entity to key off) would
// risk granting access based on a status flip alone — so these only keep our
// mirrored fields fresh.
export async function handleSubscriptionActivated(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        razorpaySubscriptionStatus: subEntity.status,
        nextBillingDate: subEntity.current_end
          ? new Date(subEntity.current_end * 1000)
          : subscription.nextBillingDate,
      },
    }
  );

  console.log(`[WEBHOOK] subscription.activated — status synced for user ${subscription.userId}`);
}

export async function handleSubscriptionUpdated(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  await Subscription.updateOne(
    { _id: subscription._id },
    {
      $set: {
        razorpaySubscriptionStatus: subEntity.status,
        nextBillingDate: subEntity.current_end
          ? new Date(subEntity.current_end * 1000)
          : subscription.nextBillingDate,
      },
    }
  );

  console.log(`[WEBHOOK] subscription.updated — status synced for user ${subscription.userId}`);
}

// A scheduled charge attempt failed but Razorpay is still retrying (grace
// period before it gives up and fires subscription.halted). Access must NOT
// be cut off here — only subscription.halted or the existing expiry logic
// (natural expiryDate lapse, checked in getSubscriptionStatus/checkSubscription)
// should end access. This only records the pending state for visibility.
export async function handleSubscriptionPending(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  await Subscription.updateOne(
    { _id: subscription._id },
    { $set: { razorpaySubscriptionStatus: subEntity.status } }
  );

  console.log(
    `[WEBHOOK] subscription.pending — charge retry in progress for user ${subscription.userId}, access unaffected`
  );
}

export async function handleSubscriptionHalted(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  subscription.razorpaySubscriptionStatus = subEntity.status;
  await subscription.save();

  // No further Razorpay charges will occur. We deliberately don't cut access
  // off here — the pre-existing local expiry cron (unrelated to Razorpay
  // status sync; it only checks our own stored expiryDate/trialEndDate,
  // same as the legacy one-time-order flow) will flip status to 'expired'
  // once the already-paid-for period naturally ends.
  console.log(
    `[WEBHOOK] subscription.halted — retries exhausted for user ${subscription.userId}; access lapses at ${subscription.expiryDate} via the existing expiry cron`
  );
}

export async function handleSubscriptionCancelled(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  subscription.razorpaySubscriptionStatus = 'cancelled';
  if (!subscription.cancelledAt) {
    subscription.cancelledAt = new Date();
  }
  await subscription.save();

  console.log(
    `[WEBHOOK] subscription.cancelled — user ${subscription.userId} retains access until ${subscription.expiryDate}, then expires via the existing expiry cron`
  );
}

export async function handleSubscriptionCompleted(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  subscription.razorpaySubscriptionStatus = 'completed';
  await subscription.save();

  console.log(`[WEBHOOK] subscription.completed — all billing cycles finished for user ${subscription.userId}`);
}
