import mongoose from 'mongoose';
import moment from 'moment-timezone';
import Razorpay from 'razorpay';
import crypto from 'crypto';

import Subscription from '../../models/Subscription.model.js';
import SubscriptionPayment from '../../models/SubscriptionPayment.model.js';
import User from '../../models/User.model.js';
import WebhookEvent from '../../models/WebhookEvent.model.js';
import NotificationService from '../../services/notification.service.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { TIMEZONE } from '../../utils/date.util.js';

// ==============================
// CONSTANTS & CONFIGURATION
// ==============================

// Razorpay requires a finite total_count; this is ~98 years of 30-day cycles,
// i.e. effectively "until cancelled" for any real-world subscriber.
const TOTAL_BILLING_CYCLES = 50;
const IN_FLIGHT_RAZORPAY_STATUSES = ['authenticated', 'active', 'pending'];
const TERMINAL_RAZORPAY_STATUSES = ['cancelled', 'completed', 'expired'];

export const PLAN_NAME = 'Monthly Basic';
export const PLAN_PRICE = 199;
const PLAN_AMOUNT_IN_PAISE = PLAN_PRICE * 100;

export const TRIAL_PLAN_NAME = '3-Day Trial';
export const TRIAL_PRICE = 5;
const TRIAL_AMOUNT_IN_PAISE = TRIAL_PRICE * 100;

// FOR TESTING: 15 minutes trial (change to 3 for production: 3 * 24 * 60 = 4320 minutes)
const TRIAL_MINUTES = 15;
export const TRIAL_DAYS = TRIAL_MINUTES / (24 * 60); // 15 minutes in days
const SUBSCRIPTION_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

// ==============================
// RAZORPAY INSTANCE
// ==============================

export const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    console.error('❌ Razorpay credentials missing');
    throw new ApiError(500, 'Payment gateway credentials are not configured.');
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

// ==============================
// HELPER FUNCTIONS
// ==============================

export const createPaidWindow = (baseDate = new Date()) => {
  const startDate = new Date(baseDate);
  const expiryDate = new Date(baseDate.getTime() + SUBSCRIPTION_DAYS * DAY_MS);
  return { startDate, expiryDate };
};

export const syncUserSubscriptionState = async (user, subscription, session) => {
  user.subscriptionID = subscription._id;

  if (subscription.status === 'active') {
    user.isSubscribed = true;
    user.isTrial = false;
  } else if (subscription.status === 'trial') {
    user.isSubscribed = false;
    user.isTrial = true;
  } else {
    user.isSubscribed = false;
    user.isTrial = false;
  }

  await user.save(session ? { session } : undefined);
};

// ==============================
// 1️⃣ CREATE RECURRING SUBSCRIPTION
// Called when: User clicks "Subscribe" button for first time
// Flow: Creates Razorpay subscription with ₹5 addon (trial)
// ==============================

// ==============================
// 1️⃣ CREATE RECURRING SUBSCRIPTION
// Called when: User clicks "Subscribe" button for first time
// Flow: Creates Razorpay subscription with ₹5 addon (trial)
// ==============================

export async function createRecurringSubscription(req, res) {
  try {
    const userId = req.user._id;
    console.log('userId', userId);
    // Check if plan ID is configured
    const planId = process.env.RAZORPAY_PLAN_ID?.trim();
    console.log('planId', planId);
    if (!planId) {
      throw new ApiError(
        500,
        'Recurring plan is not configured. Run scripts/createRazorpaySubscriptionPlan.mjs and set RAZORPAY_PLAN_ID.'
      );
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    // ✅ FIX: Find OR Create subscription
    let subscription = await Subscription.findOne({ userId });

    if (!subscription) {
      // ✅ Create new subscription if doesn't exist
      console.log(`[CREATE] No subscription found for user ${userId}, creating new...`);

      subscription = new Subscription({
        userId: userId,
        planName: PLAN_NAME,
        price: PLAN_PRICE,
        status: 'pending',
        paymentMethod: 'upi_autopay',
        // Set trial dates if needed
        trialStartDate: null,
        trialEndDate: null,
        trialNotificationSent: false,
        // Razorpay fields
        razorpayCustomerId: null,
        razorpaySubscriptionId: null,
        razorpayPlanId: null,
        razorpaySubscriptionStatus: null,
        // Payment fields
        paymentStatus: 'not_applicable',
        orderStatus: 'created',
        paymentHistory: [],
        billingCycleCount: 0,
      });

      await subscription.save();
      console.log(`[CREATE] ✅ New subscription created for user ${userId}`);
    }

    // Check if already has active recurring subscription
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

    // Check if already has active paid subscription
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

    // Create or reuse Razorpay customer
    let customerId = subscription.razorpayCustomerId;
    if (!customerId) {
      console.log(`[CREATE] Creating Razorpay customer for user ${userId}...`);

      const customer = await razorpay.customers.create({
        name: user.name || 'User',
        email: user.email || undefined,
        contact: user.phone,
        fail_existing: 0,
        notes: { userId: userId.toString() },
      });
      customerId = customer.id;
      console.log(`[CREATE] ✅ Razorpay customer created: ${customerId}`);
    }

    // Calculate start time: current time + trial duration, with minimum safety buffer.
    // Razorpay requires start_at to be at least 1 hour (3600 seconds) in the future.
    const MIN_BUFFER_SECONDS = 60 * 60; // 1 hour minimum — Razorpay requirement
    const trialEndTimestamp = Math.floor((Date.now() + TRIAL_DAYS * DAY_MS) / 1000);
    const minAllowedTimestamp = Math.floor(Date.now() / 1000) + MIN_BUFFER_SECONDS;
    const startAt = Math.max(trialEndTimestamp, minAllowedTimestamp);

    console.log(`[CREATE] Trial will end at: ${new Date(startAt * 1000).toISOString()}`);

    const subscriptionPayload = {
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
    };

    console.log(`[CREATE] Sending payload to Razorpay:`, JSON.stringify(subscriptionPayload, null, 2));

    // Create Razorpay subscription with addon (trial amount)
    console.log(`[CREATE] Creating Razorpay subscription with plan: ${planId}`);

    const razorpaySubscription = await razorpay.subscriptions.create(subscriptionPayload);

    console.log(`[CREATE] ✅ Razorpay subscription created: ${razorpaySubscription.id}`);

    // Update local subscription
    subscription.razorpayCustomerId = customerId;
    subscription.razorpaySubscriptionId = razorpaySubscription.id;
    subscription.razorpayPlanId = planId;
    subscription.razorpaySubscriptionStatus = razorpaySubscription.status;
    subscription.planName = PLAN_NAME;
    subscription.price = PLAN_PRICE;
    subscription.paymentMethod = 'upi_autopay';
    await subscription.save();

    // Link subscription to user
    if (String(user.subscriptionID || '') !== String(subscription._id)) {
      user.subscriptionID = subscription._id;
      await user.save();
    }

    console.log("response",
      "razorpaySubscriptionId :", razorpaySubscription.id,
      "status :", razorpaySubscription.status,
      "shortUrl :", razorpaySubscription.short_url,
      "key :", process.env.RAZORPAY_KEY_ID,
      "authAmount :", TRIAL_PRICE,
      "recurringAmount :", PLAN_PRICE,
      "trialDays :", TRIAL_DAYS * 24 * 60, // Convert to minutes for display
      "subscriptionId :", subscription._id,
    )
    // Return response with checkout details
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
          trialDays: TRIAL_DAYS * 24 * 60, // Convert to minutes for display
          subscriptionId: subscription._id,
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
// 2️⃣ VERIFY RECURRING SUBSCRIPTION
// Called when: Razorpay Checkout success callback fires
// Flow: Verifies ₹5 payment signature and activates trial
// ==============================

export async function verifyRecurringSubscription(req, res) {
  const userId = req.user._id;
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
  console.log('razorpay_payment_id:', razorpay_payment_id, 'razorpay_subscription_id:', razorpay_subscription_id, 'razorpay_signature:', razorpay_signature);

  console.log(req.body, 'all body of verify-payment')
  // Validate input
  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw new ApiError(
      400,
      'Payment verification data is required (razorpay_payment_id, razorpay_subscription_id, razorpay_signature).'
    );
  }

  // Find subscription
  const subscription = await Subscription.findOne({
    userId,
    razorpaySubscriptionId: razorpay_subscription_id,
  });

  if (!subscription) {
    throw new ApiError(404, 'Recurring subscription not found for this payment.');
  }

  // Idempotency check
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

  // Verify signature
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    throw new ApiError(400, 'Payment verification failed. Invalid signature.');
  }

  // Fetch payment from Razorpay
  const razorpay = getRazorpayInstance();
  const payment = await razorpay.payments.fetch(razorpay_payment_id);

  if (!payment) {
    throw new ApiError(404, 'Payment not found on Razorpay.');
  }

  if (payment.status !== 'captured') {
    throw new ApiError(400, `Payment is not captured. Current status: ${payment.status}`);
  }

  // Validate amount (allow exact trial amount OR Razorpay's nominal mandate authorization like 1 INR or 1 paisa)
  if (payment.amount > TRIAL_AMOUNT_IN_PAISE) {
    throw new ApiError(
      400,
      `Invalid authorization amount. Expected up to ₹${TRIAL_PRICE}, got ₹${payment.amount / 100}.`
    );
  }

  // Fetch subscription from Razorpay
  const rzpSubscription = await razorpay.subscriptions.fetch(razorpay_subscription_id);

  // Activate trial
  await handleSubscriptionAuthenticated({
    subscription: { entity: rzpSubscription },
    payment: { entity: payment },
  });

  // Get updated subscription
  const refreshed = await Subscription.findById(subscription._id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        subscriptionId: refreshed._id,
        status: refreshed.status,
        trialEndDate: refreshed.trialEndDate,
        razorpaySubscriptionStatus: refreshed.razorpaySubscriptionStatus,
        trialMinutes: TRIAL_MINUTES,
      },
      `Payment verified. Your ${TRIAL_MINUTES}-minute trial is now active.`
    )
  );
}

// ==============================
// 3️⃣ CANCEL RECURRING SUBSCRIPTION
// Called when: User clicks "Cancel Subscription"
// Flow: Cancels future charges, keeps access until current period ends
// ==============================

export async function cancelRecurringSubscription(req, res) {
  const userId = req.user._id;

  const subscription = await Subscription.findOne({ userId });
  if (!subscription || !subscription.razorpaySubscriptionId) {
    throw new ApiError(404, 'No recurring subscription found for this user.');
  }

  // Check if already cancelled
  if (TERMINAL_RAZORPAY_STATUSES.includes(subscription.razorpaySubscriptionStatus)) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          status: subscription.razorpaySubscriptionStatus,
          expiryDate: subscription.expiryDate
        },
        'Subscription is already cancelled.'
      )
    );
  }

  try {
    const razorpay = getRazorpayInstance();

    // Cancel at cycle end (no more charges, but keep access)
    const cancelled = await razorpay.subscriptions.cancel(
      subscription.razorpaySubscriptionId,
      { cancel_at_cycle_end: 1 }
    );

    // Update local record
    subscription.razorpaySubscriptionStatus = cancelled.status;
    subscription.cancelledAt = new Date();
    await subscription.save();

    // Send notification
    await NotificationService.createNotification(userId, {
      type: 'subscription',
      title: '❌ Subscription Cancelled',
      body: 'Your subscription has been cancelled. You will retain access until your current period ends.',
      status: 'info',
      data: {
        subscriptionId: subscription._id.toString(),
        expiryDate: subscription.expiryDate,
      },
      relatedEntityId: subscription._id,
      relatedEntityType: 'subscription',
    });

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          status: cancelled.status,
          expiryDate: subscription.expiryDate
        },
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
// 4️⃣ GET RECURRING SUBSCRIPTION STATUS
// Called when: User checks subscription status
// Flow: Returns current subscription details
// ==============================

export async function getRecurringSubscriptionStatus(req, res) {
  const userId = req.user._id;

  const subscription = await Subscription.findOne({ userId })
    .populate('paymentHistory')
    .lean();

  if (!subscription || !subscription.razorpaySubscriptionId) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          hasRecurringSubscription: false,
          subscription: null
        },
        'No recurring subscription found.'
      )
    );
  }

  // Check if trial is expired but subscription not yet charged
  const now = new Date();
  let trialExpired = false;
  if (subscription.status === 'trial' && subscription.trialEndDate) {
    trialExpired = subscription.trialEndDate < now;
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        hasRecurringSubscription: true,
        subscription: {
          id: subscription._id,
          planName: subscription.planName,
          price: subscription.price,
          status: subscription.status,
          startDate: subscription.startDate,
          expiryDate: subscription.expiryDate,
          trialStartDate: subscription.trialStartDate,
          trialEndDate: subscription.trialEndDate,
          trialExpired,
          razorpaySubscriptionId: subscription.razorpaySubscriptionId,
          razorpaySubscriptionStatus: subscription.razorpaySubscriptionStatus,
          nextBillingDate: subscription.nextBillingDate,
          billingCycleCount: subscription.billingCycleCount,
          cancelledAt: subscription.cancelledAt,
          paymentHistory: subscription.paymentHistory,
          paymentMethod: subscription.paymentMethod,
        },
      },
      'Recurring subscription status retrieved.'
    )
  );
}

// ==============================
// 5️⃣ SYNC SUBSCRIPTION FROM RAZORPAY
// Called when: Webhook was missed (e.g., local dev) and DB is out of sync
// Flow: Fetches live data from Razorpay and updates local subscription
// ==============================

export async function syncSubscriptionFromRazorpay(req, res) {
  const userId = req.user._id;

  const subscription = await Subscription.findOne({ userId });

  if (!subscription || !subscription.razorpaySubscriptionId) {
    throw new ApiError(404, 'No recurring subscription found for this user.');
  }

  const razorpay = getRazorpayInstance();

  // Fetch live subscription from Razorpay
  const rzpSub = await razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);

  console.log(`[SYNC] Razorpay subscription status: ${rzpSub.status}, paid_count: ${rzpSub.paid_count}`);

  // Update razorpay status and next billing date
  subscription.razorpaySubscriptionStatus = rzpSub.status;
  if (rzpSub.current_end) {
    subscription.nextBillingDate = new Date(rzpSub.current_end * 1000);
  }

  // If Razorpay shows paid_count > 0 but our local billingCycleCount is 0 → webhook was missed
  const missedCharge = (rzpSub.paid_count || 0) > (subscription.billingCycleCount || 0);

  if (missedCharge && subscription.status !== 'active') {
    console.log(`[SYNC] Missed charge detected! Razorpay paid_count=${rzpSub.paid_count}, local count=${subscription.billingCycleCount}`);

    // Fetch payments for this subscription from Razorpay
    const payments = await razorpay.subscriptions.fetchAllPayments(subscription.razorpaySubscriptionId);
    const capturedPayments = (payments?.items || []).filter(
      (p) => p.status === 'captured' && p.amount === PLAN_AMOUNT_IN_PAISE
    );

    if (capturedPayments.length > 0) {
      const now = new Date();
      const { startDate, expiryDate } = createPaidWindow(now);

      subscription.status = 'active';
      subscription.planName = PLAN_NAME;
      subscription.price = PLAN_PRICE;
      subscription.startDate = startDate;
      subscription.expiryDate = expiryDate;
      subscription.paidAt = now;
      subscription.billingCycleCount = rzpSub.paid_count;

      // Save payment records that are missing
      for (const payment of capturedPayments) {
        const exists = await SubscriptionPayment.findOne({ razorpayPaymentId: payment.id });
        if (!exists) {
          const record = await SubscriptionPayment.create({
            userId: subscription.userId,
            subscriptionId: subscription._id,
            razorpaySubscriptionId: rzpSub.id,
            razorpayPaymentId: payment.id,
            razorpayOrderId: payment.order_id || `sync_${rzpSub.id}_${payment.id}`,
            planName: PLAN_NAME,
            amount: payment.amount,
            currency: payment.currency || 'INR',
            requestedPaymentMethod: 'upi_autopay',
            actualPaymentMethod: payment.method,
            gatewayStatus: payment.status,
            status: 'paid',
            verifiedAt: new Date(payment.created_at * 1000),
            gatewayResponse: payment,
          });

          if (!subscription.paymentHistory.includes(record._id)) {
            subscription.paymentHistory.push(record._id);
          }
        }
      }

      await subscription.save();

      // Sync user state
      const user = await User.findById(subscription.userId);
      if (user) {
        await syncUserSubscriptionState(user, subscription);
      }

      console.log(`[SYNC] ✅ Subscription activated for user ${userId} after detecting missed webhook`);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            synced: true,
            missedWebhook: true,
            status: subscription.status,
            expiryDate: subscription.expiryDate,
            billingCycleCount: subscription.billingCycleCount,
          },
          'Subscription synced from Razorpay. Missed webhook recovered — subscription is now active.'
        )
      );
    }
  }

  // No missed charge — just update status
  await subscription.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        synced: true,
        missedWebhook: false,
        razorpayStatus: rzpSub.status,
        localStatus: subscription.status,
        paid_count: rzpSub.paid_count,
        nextBillingDate: subscription.nextBillingDate,
      },
      'Subscription synced from Razorpay.'
    )
  );
}

// ==============================
// 6️⃣ RAZORPAY WEBHOOK
// Called when: Razorpay sends webhook events
// Flow: Handles all subscription events (authenticated, charged, cancelled, etc.)
// NO AUTH REQUIRED - Signature verified
// ==============================

export async function razorpayWebhook(req, res) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // Verify webhook signature (if secret is configured)
  if (webhookSecret) {
    const receivedSignature = req.headers['x-razorpay-signature'];

    if (!receivedSignature) {
      console.error('[WEBHOOK] Missing x-razorpay-signature header');
      return res.status(400).json({ status: 'error', message: 'Missing signature' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.rawBody || JSON.stringify(req.body))
      .digest('hex');

    if (receivedSignature !== expectedSignature) {
      console.error('[WEBHOOK] Signature mismatch');
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }
  }

  const event = req.body?.event;
  const payload = req.body?.payload;

  if (!event || typeof event !== 'string' || !payload) {
    console.error('[WEBHOOK] Malformed payload — missing event/payload');
    return res.status(400).json({ status: 'error', message: 'Malformed payload' });
  }

  console.log(`[WEBHOOK] Received event: ${event}`);

  // Deduplicate webhook deliveries
  const bodyForHash = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const eventHash = crypto.createHash('sha256').update(bodyForHash).digest('hex');

  try {
    await WebhookEvent.create({ hash: eventHash, event });
  } catch (dedupError) {
    if (dedupError.code === 11000) {
      console.log(`[WEBHOOK] Duplicate delivery for event ${event}, skipping reprocessing`);
      return res.status(200).json({ status: 'ok', duplicate: true });
    }
    console.error('[WEBHOOK] Dedup check failed, proceeding without it:', dedupError.message);
  }

  // Process event
  try {
    // Payment events (legacy order flow)
    if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;

      if (!orderId) {
        console.log('[WEBHOOK] payment.captured — no order_id, skipping');
        return res.status(200).json({ status: 'ok' });
      }

      const paymentRecord = await SubscriptionPayment.findOne({ razorpayOrderId: orderId });

      if (paymentRecord && paymentRecord.status !== 'paid') {
        paymentRecord.razorpayPaymentId = payment.id;
        paymentRecord.actualPaymentMethod = payment.method;
        paymentRecord.gatewayStatus = payment.status;
        paymentRecord.status = 'paid';
        paymentRecord.verifiedAt = new Date();
        paymentRecord.gatewayResponse = payment;
        await paymentRecord.save();
        console.log(`[WEBHOOK] Payment record updated for order: ${orderId}`);
      }

      const subscription = await Subscription.findOne({ razorpayOrderId: orderId });

      if (subscription && subscription.status !== 'active') {
        const now = new Date();
        const isTrialPayment = payment.amount === TRIAL_AMOUNT_IN_PAISE;

        if (isTrialPayment) {
          const trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
          subscription.planName = TRIAL_PLAN_NAME;
          subscription.price = TRIAL_PRICE;
          subscription.status = 'trial';
          subscription.trialStartDate = now;
          subscription.trialEndDate = trialEndDate;
        } else {
          const { startDate, expiryDate } = createPaidWindow(now);
          subscription.planName = PLAN_NAME;
          subscription.price = PLAN_PRICE;
          subscription.status = 'active';
          subscription.startDate = startDate;
          subscription.expiryDate = expiryDate;
          subscription.paidAt = now;
        }

        subscription.razorpayPaymentId = payment.id;
        subscription.paymentStatus = 'captured';
        subscription.orderStatus = 'paid';
        subscription.paymentMethod = payment.method;

        if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
          subscription.paymentHistory.push(paymentRecord._id);
        }

        await subscription.save();

        const user = await User.findById(subscription.userId);
        if (user) {
          await syncUserSubscriptionState(user, subscription);
        }

        console.log(`[WEBHOOK] Subscription updated for user: ${subscription.userId}`);
      }
    }

    if (event === 'payment.failed') {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;

      if (orderId) {
        await SubscriptionPayment.findOneAndUpdate(
          { razorpayOrderId: orderId },
          {
            $set: {
              status: 'failed',
              gatewayStatus: payment.status,
              gatewayResponse: payment,
            },
          }
        );

        await Subscription.findOneAndUpdate(
          { razorpayOrderId: orderId },
          {
            $set: {
              orderStatus: 'failed',
              paymentStatus: 'failed',
            },
          }
        );

        console.log(`[WEBHOOK] Payment failed for order: ${orderId}`);
      }
    }

    if (event === 'payment.authorized') {
      const payment = payload.payment?.entity;
      console.log(`[WEBHOOK] payment.authorized — payment ${payment?.id} authorized, awaiting capture`);
    }

    // Subscription events (recurring auto-debit flow)
    if (event.startsWith('subscription.')) {
      if (event === 'subscription.authenticated') {
        await handleSubscriptionAuthenticated(payload);
      } else if (event === 'subscription.activated') {
        await handleSubscriptionActivated(payload);
      } else if (event === 'subscription.pending') {
        await handleSubscriptionPending(payload);
      } else if (event === 'subscription.charged') {
        await handleSubscriptionCharged(payload);
      } else if (event === 'subscription.halted') {
        await handleSubscriptionHalted(payload);
      } else if (event === 'subscription.cancelled') {
        await handleSubscriptionCancelled(payload);
      } else if (event === 'subscription.completed') {
        await handleSubscriptionCompleted(payload);
      } else if (event === 'subscription.updated') {
        await handleSubscriptionUpdated(payload);
      }
    }
  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error.message);
    // Don't throw - always return 200 to Razorpay
  }

  // Always return 200 to prevent retries
  return res.status(200).json({ status: 'ok' });
}

// ==============================
// WEBHOOK EVENT HANDLERS
// ==============================

// 5a️⃣ SUBSCRIPTION.AUTHENTICATED
// Called when: User completes ₹5 mandate/payment
// Flow: Activates trial period (15 minutes for testing)
export async function handleSubscriptionAuthenticated(payload) {
  const subEntity = payload?.subscription?.entity;
  const paymentEntity = payload?.payment?.entity;

  if (!subEntity?.id) {
    console.log('[WEBHOOK] subscription.authenticated — missing subscription entity');
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const subscription = await Subscription.findOne({
        razorpaySubscriptionId: subEntity.id
      }).session(session);

      if (!subscription) {
        console.log(`[WEBHOOK] subscription.authenticated — no local subscription for ${subEntity.id}`);
        return;
      }

      const now = new Date();
      const alreadyActivated = ['trial', 'active'].includes(subscription.status);

      if (!alreadyActivated) {
        // Activate trial
        subscription.status = 'trial';
        subscription.planName = TRIAL_PLAN_NAME;
        subscription.price = TRIAL_PRICE;
        subscription.trialStartDate = now;
        subscription.trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
        subscription.trialNotificationSent = false;

        console.log(`[WEBHOOK] Trial activated for user ${subscription.userId}, expires in ${TRIAL_MINUTES} minutes`);
      }

      // Update subscription details
      subscription.paymentMethod = paymentEntity?.method || subscription.paymentMethod || 'upi_autopay';
      subscription.razorpaySubscriptionStatus = subEntity.status;
      subscription.nextBillingDate = subEntity.current_end
        ? new Date(subEntity.current_end * 1000)
        : subscription.nextBillingDate;

      // Create payment record for trial
      if (paymentEntity?.id) {
        const paymentRecord = await SubscriptionPayment.findOneAndUpdate(
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

        if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
          subscription.paymentHistory.push(paymentRecord._id);
        }
      }

      await subscription.save({ session });

      // Sync user state
      const user = await User.findById(subscription.userId).session(session);
      if (user) {
        await syncUserSubscriptionState(user, subscription, session);
      }

      // Send trial activation notification
      await NotificationService.createNotification(subscription.userId, {
        type: 'subscription',
        title: '🎉 Trial Activated!',
        body: `Your ${TRIAL_MINUTES}-minute trial has started. You'll be charged ₹${PLAN_PRICE} automatically after the trial ends.`,
        status: 'success',
        data: {
          subscriptionId: subscription._id.toString(),
          trialEndDate: subscription.trialEndDate,
          trialMinutes: TRIAL_MINUTES,
        },
        relatedEntityId: subscription._id,
        relatedEntityType: 'subscription',
      });

      console.log(`[WEBHOOK] subscription.authenticated — trial activated for user ${subscription.userId}`);
    });
  } catch (error) {
    console.error('[WEBHOOK] Error in handleSubscriptionAuthenticated:', error);
  } finally {
    await session.endSession();
  }
}

// 5b️⃣ SUBSCRIPTION.CHARGED
// Called when: Auto-debit of ₹199 occurs (after trial ends)
// Flow: Activates paid subscription for 30 days
export async function handleSubscriptionCharged(payload) {
  const subEntity = payload?.subscription?.entity;
  const paymentEntity = payload?.payment?.entity;

  if (!subEntity?.id) {
    console.log('[WEBHOOK] subscription.charged — missing subscription entity');
    return;
  }

  if (!paymentEntity?.id) {
    console.log('[WEBHOOK] subscription.charged — missing payment entity, cannot process');
    return;
  }

  let newChargeNotice = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const subscription = await Subscription.findOne({
        razorpaySubscriptionId: subEntity.id
      }).session(session);

      if (!subscription) {
        console.log(`[WEBHOOK] subscription.charged — no local subscription for ${subEntity.id}`);
        return;
      }

      // Check if this payment was already processed (idempotency)
      const existingPayment = await SubscriptionPayment.findOne({
        razorpayPaymentId: paymentEntity.id,
      }).session(session);

      const now = new Date();

      if (!existingPayment) {
        // First time seeing this payment - activate paid subscription
        const { startDate, expiryDate } = createPaidWindow(now);

        subscription.status = 'active';
        subscription.planName = PLAN_NAME;
        subscription.price = PLAN_PRICE;
        subscription.startDate = startDate;
        subscription.expiryDate = expiryDate;
        subscription.paidAt = now;
        subscription.billingCycleCount = (subscription.billingCycleCount || 0) + 1;

        console.log(`[WEBHOOK] Charged ₹${PLAN_PRICE} for user ${subscription.userId}, cycle #${subscription.billingCycleCount}`);
      }

      // Update subscription details
      subscription.razorpaySubscriptionStatus = subEntity.status;
      subscription.paymentMethod = paymentEntity.method || subscription.paymentMethod;
      subscription.nextBillingDate = subEntity.current_end
        ? new Date(subEntity.current_end * 1000)
        : subscription.nextBillingDate;

      // Create or update payment record
      const paymentRecord = await SubscriptionPayment.findOneAndUpdate(
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
            verifiedAt: now,
            gatewayResponse: paymentEntity,
          },
        },
        { upsert: true, new: true, session }
      );

      if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
        subscription.paymentHistory.push(paymentRecord._id);
      }

      await subscription.save({ session });

      // Sync user state only for new charges
      if (!existingPayment) {
        const user = await User.findById(subscription.userId).session(session);
        if (user) {
          await syncUserSubscriptionState(user, subscription, session);
        }

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
  } catch (error) {
    console.error('[WEBHOOK] Error in handleSubscriptionCharged:', error);
  } finally {
    await session.endSession();
  }

  // Send notification outside transaction (after commit)
  if (newChargeNotice) {
    try {
      const expiryLabel = moment(newChargeNotice.expiryDate)
        .tz(TIMEZONE)
        .format('D MMM YYYY');

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

// 5c️⃣ SUBSCRIPTION.ACTIVATED
// Called when: Razorpay marks subscription as active (status sync only)
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

// 5d️⃣ SUBSCRIPTION.UPDATED
// Called when: Subscription details update (status sync only)
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

// 5e️⃣ SUBSCRIPTION.PENDING
// Called when: Charge attempt failed but retrying (no access change)
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

// 5f️⃣ SUBSCRIPTION.HALTED
// Called when: All retries exhausted, no more charges (access continues until expiry)
export async function handleSubscriptionHalted(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  subscription.razorpaySubscriptionStatus = subEntity.status;
  await subscription.save();

  console.log(
    `[WEBHOOK] subscription.halted — retries exhausted for user ${subscription.userId}; access lapses at ${subscription.expiryDate}`
  );
}

// 5g️⃣ SUBSCRIPTION.CANCELLED
// Called when: Subscription cancelled (no more charges, access until expiry)
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
    `[WEBHOOK] subscription.cancelled — user ${subscription.userId} retains access until ${subscription.expiryDate}`
  );
}

// 5h️⃣ SUBSCRIPTION.COMPLETED
// Called when: All billing cycles completed
export async function handleSubscriptionCompleted(payload) {
  const subEntity = payload?.subscription?.entity;
  if (!subEntity?.id) return;

  const subscription = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
  if (!subscription) return;

  subscription.razorpaySubscriptionStatus = 'completed';
  await subscription.save();

  console.log(`[WEBHOOK] subscription.completed — all billing cycles finished for user ${subscription.userId}`);
}