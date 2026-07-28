
import Subscription from '../../models/Subscription.model.js';
import SubscriptionPayment from '../../models/SubscriptionPayment.model.js';
import User from '../../models/User.model.js';
import WebhookEvent from '../../models/WebhookEvent.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

export const PLAN_NAME = 'Monthly Basic';
export const PLAN_PRICE = 199;
const PLAN_AMOUNT_IN_PAISE = PLAN_PRICE * 100;

export const TRIAL_PLAN_NAME = '3-Day Trial';
export const TRIAL_PRICE = 5;
const TRIAL_AMOUNT_IN_PAISE = TRIAL_PRICE * 100;

const TRIAL_MINUTES = 5;
export const TRIAL_DAYS = TRIAL_MINUTES / (24 * 60); // 5 minutes

const SUBSCRIPTION_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const getRazorpayInstance = () => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (!keyId || !keySecret) {
    console.error('❌ Razorpay credentials missing');

    throw new ApiError(
      500,
      'Payment gateway credentials are not configured.'
    );
  }

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

export const createPaidWindow = (baseDate = new Date()) => {
  const startDate = new Date(baseDate);
  const expiryDate = new Date(baseDate.getTime() + SUBSCRIPTION_DAYS * DAY_MS);

  return { startDate, expiryDate };
};

const loadUserSubscription = async (userId) => {
  return Subscription.findOne({ userId });
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
// CREATE SUBSCRIPTION ORDER
// ==============================
export async function createSubscriptionOrder(req, res) {
  try {
    const userId = req.user._id;

    const paymentMethod = String(req.body.paymentMethod || 'upi')
      .trim()
      .toLowerCase();

    // ✅ find user
    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    // ✅ check active subscription
    const existingSubscription = await Subscription.findOne({
      userId,
      status: 'active',
      expiryDate: { $gt: new Date() },
    });

    if (existingSubscription) {
      throw new ApiError(
        400,
        'You already have an active subscription.',
        [
          {
            expiryDate: existingSubscription.expiryDate,
            planName: existingSubscription.planName,
          },
        ]
      );
    }

    // Determine if this is a trial payment (₹5) or full subscription (₹199)
    let subscription = await loadUserSubscription(userId);

    if (!subscription) {
      throw new ApiError(
        400,
        'Subscription record not found. Please contact support.'
      );
    }

    // Agar subscription 'pending' hai, iska matlab abhi tak user ne trial activate nahi kiya
    const isTrialPayment = subscription.status === 'pending';

    const amount = isTrialPayment ? TRIAL_AMOUNT_IN_PAISE : PLAN_AMOUNT_IN_PAISE;
    const planLabel = isTrialPayment ? TRIAL_PLAN_NAME : PLAN_NAME;
    const planPrice = isTrialPayment ? TRIAL_PRICE : PLAN_PRICE;

    if (!amount || amount <= 0) {
      throw new ApiError(500, 'Invalid plan configuration.');
    }

    const currency = 'INR';

    const receipt = `rcpt_${Date.now().toString(36)}_${userId
      .toString()
      .slice(-6)}`;

    // ✅ Razorpay order payload
    const options = {
      amount,
      currency,
      receipt,
      notes: {
        userId: userId.toString(),
        plan: planLabel,
        paymentMethod,
        isTrialPayment: String(isTrialPayment),
      },
    };

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create(options);

    // ❌ IMPORTANT FIX:
    // Only update subscription — DO NOT create payment record here

    subscription.planName = planLabel;
    subscription.price = planPrice;
    subscription.paymentMethod = paymentMethod;

    subscription.razorpayOrderId = order.id;
    subscription.orderStatus = 'created';
    subscription.paymentStatus = 'created';

    subscription.paymentAmount = order.amount;
    subscription.paymentCurrency = order.currency;
    subscription.receipt = order.receipt;
    subscription.paymentNotes = order.notes;

    await subscription.save();

    // link user
    if (String(user.subscriptionID || '') !== String(subscription._id)) {
      user.subscriptionID = subscription._id;
      await user.save();
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
          paymentMethod,
          planName: planLabel,
          planPrice: planPrice,
          isTrialPayment,
          key: process.env.RAZORPAY_KEY_ID,
        },
        'Subscription order created successfully.'
      )
    );
  } catch (error) {
    console.error('❌ RAZORPAY ORDER ERROR:', error);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(
      500,
      error?.error?.description ||
      error?.message ||
      'Failed to create payment order'
    );
  }
}

// ==============================
// VERIFY PAYMENT
// ==============================
export async function verifyPayment(req, res) {
  const userId = req.user._id;

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body;

  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature
  ) {
    throw new ApiError(
      400,
      'Payment verification data is required (razorpay_order_id, razorpay_payment_id, razorpay_signature).'
    );
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const subscription = await Subscription.findOne({
    userId,
    razorpayOrderId: razorpay_order_id,
  });

  if (!subscription) {
    throw new ApiError(
      404,
      'Subscription order not found for this payment.'
    );
  }

  // Idempotency check — if already verified, return success
  if (
    subscription.razorpayPaymentId === razorpay_payment_id &&
    subscription.status === 'active' &&
    subscription.paymentStatus === 'captured'
  ) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          subscriptionId: subscription._id,
          status: subscription.status,
          expiryDate: subscription.expiryDate,
          paymentId: subscription.razorpayPaymentId,
          planName: subscription.planName,
          price: subscription.price,
        },
        'Payment already verified.'
      )
    );
  }

  // Verify Razorpay signature
  const generatedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    // Update payment record as failed
    await SubscriptionPayment.findOneAndUpdate(
      { userId, razorpayOrderId: razorpay_order_id },
      {
        $set: {
          status: 'failed',
          gatewayStatus: 'signature_mismatch',
        },
      }
    );

    throw new ApiError(400, 'Payment verification failed. Invalid signature.');
  }

  // Fetch payment details from Razorpay to verify amount, currency, status
  const razorpay = getRazorpayInstance();
  const payment = await razorpay.payments.fetch(razorpay_payment_id);

  if (!payment) {
    throw new ApiError(404, 'Payment not found on Razorpay.');
  }

  if (payment.status !== 'captured') {
    throw new ApiError(
      400,
      `Payment is not captured. Current status: ${payment.status}`
    );
  }

  const validAmounts = [TRIAL_AMOUNT_IN_PAISE, PLAN_AMOUNT_IN_PAISE];
  if (!validAmounts.includes(payment.amount)) {
    throw new ApiError(
      400,
      `Invalid payment amount. Got ₹${payment.amount / 100}.`
    );
  }

  if (payment.currency !== 'INR') {
    throw new ApiError(
      400,
      'Invalid payment currency. Only INR is supported.'
    );
  }

  if (payment.order_id && payment.order_id !== razorpay_order_id) {
    throw new ApiError(400, 'Payment order mismatch.');
  }

  // All checks passed — activate subscription
  const now = new Date();
  const isTrialPayment = payment.amount === TRIAL_AMOUNT_IN_PAISE;

  if (isTrialPayment) {
    // ₹5 trial payment — keep status 'trial', set trialEndDate
    const trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    subscription.planName = TRIAL_PLAN_NAME;
    subscription.price = TRIAL_PRICE;
    subscription.status = 'trial';
    subscription.startDate = now;
    subscription.trialEndDate = trialEndDate;
    user.isTrial = true;
  } else {
    // ₹199 full subscription
    const { startDate, expiryDate } = createPaidWindow(now);
    subscription.planName = PLAN_NAME;
    subscription.price = PLAN_PRICE;
    subscription.status = 'active';
    subscription.startDate = startDate;
    subscription.expiryDate = expiryDate;
    user.isTrial = false;
  }
  subscription.paymentMethod = payment.method || subscription.paymentMethod;
  subscription.paymentRef = razorpay_payment_id;
  subscription.razorpayOrderId = razorpay_order_id;
  subscription.razorpayPaymentId = razorpay_payment_id;
  subscription.razorpaySignature = razorpay_signature;
  subscription.orderStatus = 'paid';
  subscription.paymentStatus = payment.status;
  subscription.paymentAmount = payment.amount;
  subscription.paymentCurrency = payment.currency;
  subscription.paidAt = now;
  subscription.paymentNotes = {
    ...(subscription.paymentNotes || {}),
    razorpayPaymentId: razorpay_payment_id,
    method: payment.method,
  };

  // Save/update SubscriptionPayment record
  const paymentRecord = await SubscriptionPayment.findOneAndUpdate(
    {
      userId,
      razorpayOrderId: razorpay_order_id,
    },
    {
      $setOnInsert: {
        userId,
        razorpayOrderId: razorpay_order_id,
        planName: PLAN_NAME,
        amount: payment.amount,
        currency: payment.currency,
        requestedPaymentMethod: subscription.paymentMethod,
      },
      $set: {
        subscriptionId: subscription._id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        actualPaymentMethod: payment.method,
        gatewayStatus: payment.status,
        status: 'paid',
        verifiedAt: now,
        gatewayResponse: payment,
      },
    },
    {
      new: true,
      upsert: true,
    }
  );

  // Add payment to subscription's payment history
  if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
    subscription.paymentHistory.push(paymentRecord._id);
  }

  await subscription.save();

  // Sync user state
  await syncUserSubscriptionState(user, subscription);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        subscriptionId: subscription._id,
        status: subscription.status,
        startDate: subscription.startDate,
        expiryDate: subscription.expiryDate,
        planName: subscription.planName,
        price: subscription.price,
        paymentMethod: subscription.paymentMethod,
        paymentId: subscription.razorpayPaymentId,
      },
      'Payment verified and subscription activated for 30 days.'
    )
  );
}

// ==============================
// GET SUBSCRIPTION STATUS
// ==============================
export async function getSubscriptionStatus(req, res) {
  const userId = req.user._id;

  const user = await User.findById(userId).populate('subscriptionID');

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  let subscription = user.subscriptionID;

  // If subscription ref is missing on user, try to find it directly
  if (!subscription) {
    subscription = await loadUserSubscription(userId);

    if (subscription) {
      user.subscriptionID = subscription._id;
      await user.save();
    }
  }

  // No subscription found at all
  if (!subscription) {
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          isSubscribed: false,
          hasSubscription: false,
          status: 'none',
          message: 'No subscription found. Please contact support if this is an error.',
        },
        'No subscription found.'
      )
    );
  }

  const now = new Date();

  // Auto-expire trial if trialEndDate has passed
  if (
    subscription.status === 'trial' &&
    subscription.trialEndDate &&
    subscription.trialEndDate < now
  ) {
    subscription.status = 'expired';
    await subscription.save();

    user.isSubscribed = false;
    user.isTrial = false;
    await user.save();
  }

  // Auto-expire paid subscription if expiryDate has passed
  if (
    subscription.status === 'active' &&
    subscription.expiryDate &&
    subscription.expiryDate < now
  ) {
    subscription.status = 'expired';
    await subscription.save();

    user.isSubscribed = false;
    user.isTrial = false;
    await user.save();
  }

  // Sync user state
  await syncUserSubscriptionState(user, subscription);

  // Calculate remaining days
  let remainingDays = 0;
  if (subscription.status === 'trial' && subscription.trialEndDate) {
    remainingDays = Math.max(0, Math.ceil((subscription.trialEndDate - now) / DAY_MS));
  } else if (subscription.status === 'active' && subscription.expiryDate) {
    remainingDays = Math.max(0, Math.ceil((subscription.expiryDate - now) / DAY_MS));
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        isSubscribed: user.isSubscribed,
        isTrial: user.isTrial,
        hasSubscription: true,
        status: subscription.status,
        expiryDate: subscription.expiryDate,
        trialEndDate: subscription.trialEndDate,
        startDate: subscription.startDate,
        planName: subscription.planName,
        price: subscription.price,
        paymentMethod: subscription.paymentMethod || null,
        orderStatus: subscription.orderStatus || null,
        paymentStatus: subscription.paymentStatus || null,
        remainingDays,
        paidAt: subscription.paidAt || null,
      },
      'Subscription status retrieved.'
    )
  );
}

// ==============================
// GET PAYMENT HISTORY
// ==============================
export async function getPaymentHistory(req, res) {
  const userId = req.user._id;

  const payments = await SubscriptionPayment.find({ userId })
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        payments,
        total: payments.length,
      },
      'Payment history retrieved.'
    )
  );
}

// ==============================
// RAZORPAY WEBHOOK
// Server-to-server callback from Razorpay
// No auth middleware — verified via webhook signature
// ==============================
export async function razorpayWebhook(req, res) {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  // If webhook secret is not configured, skip signature verification
  // (useful for testing, but in production ALWAYS set this)
  if (webhookSecret) {
    const receivedSignature = req.headers['x-razorpay-signature'];

    if (!receivedSignature) {
      console.error('[WEBHOOK] Missing x-razorpay-signature header');
      return res.status(400).json({ status: 'error', message: 'Missing signature' });
    }

    // Razorpay signs the raw request bytes, not the re-serialized parsed
    // object — req.rawBody is captured by the verify() hook on express.json()
    // in app.js. Falls back to JSON.stringify only if rawBody is unavailable.
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

  // Deduplicate retried webhook deliveries. Razorpay resends the identical
  // payload bytes on retry, so a hash of the raw body reliably identifies the
  // same delivery. The unique index makes this safe under concurrent
  // duplicate deliveries — a duplicate insert simply fails and we short-circuit.
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

  try {
    if (event === 'payment.captured') {
      const payment = payload.payment.entity;
      const orderId = payment.order_id;

      if (!orderId) {
        console.log('[WEBHOOK] payment.captured — no order_id, skipping');
        return res.status(200).json({ status: 'ok' });
      }

      // Find the subscription payment record
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

      // Also update subscription if not already active
      const subscription = await Subscription.findOne({ razorpayOrderId: orderId });

      if (subscription && subscription.status !== 'active') {
        const now = new Date();
        const { startDate, expiryDate } = createPaidWindow(now);

        subscription.status = 'active';
        subscription.startDate = startDate;
        subscription.expiryDate = expiryDate;
        subscription.razorpayPaymentId = payment.id;
        subscription.paymentStatus = 'captured';
        subscription.orderStatus = 'paid';
        subscription.paymentMethod = payment.method;
        subscription.paidAt = now;

        if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
          subscription.paymentHistory.push(paymentRecord._id);
        }

        await subscription.save();

        // Update user
        const user = await User.findById(subscription.userId);
        if (user) {
          await syncUserSubscriptionState(user, subscription);
        }

        console.log(`[WEBHOOK] Subscription activated for user: ${subscription.userId}`);
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

        // Update subscription order status
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
      // Informational only: this integration relies on Razorpay's default
      // auto-capture, so payment.captured (order flow) / subscription.charged
      // (recurring flow) are what actually grant access. No state change here
      // avoids treating an authorized-but-not-yet-captured payment as paid.
      const payment = payload.payment?.entity;
      console.log(`[WEBHOOK] payment.authorized — payment ${payment?.id} authorized, awaiting capture`);
    }

    // Razorpay Subscriptions API events (recurring auto-debit flow).
    // Dynamic import avoids a static circular import with
    // subscriptionRecurring.controller.js, which itself imports shared
    // helpers/constants from this file.
    if (event.startsWith('subscription.')) {
      const recurring = await import('./subscriptionRecurring.controller.js');

      if (event === 'subscription.authenticated') {
        await recurring.handleSubscriptionAuthenticated(payload);
      } else if (event === 'subscription.activated') {
        await recurring.handleSubscriptionActivated(payload);
      } else if (event === 'subscription.pending') {
        await recurring.handleSubscriptionPending(payload);
      } else if (event === 'subscription.charged') {
        await recurring.handleSubscriptionCharged(payload);
      } else if (event === 'subscription.halted') {
        await recurring.handleSubscriptionHalted(payload);
      } else if (event === 'subscription.cancelled') {
        await recurring.handleSubscriptionCancelled(payload);
      } else if (event === 'subscription.completed') {
        await recurring.handleSubscriptionCompleted(payload);
      } else if (event === 'subscription.updated') {
        await recurring.handleSubscriptionUpdated(payload);
      }
    }
  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error.message);
  }

  // Always return 200 to Razorpay to prevent retries
  return res.status(200).json({ status: 'ok' });
}
