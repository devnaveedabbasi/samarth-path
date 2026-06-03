
import Subscription from '../../models/Subscription.model.js';
import SubscriptionPayment from '../../models/SubscriptionPayment.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const PLAN_NAME = 'Monthly Basic';
const PLAN_PRICE = 199;
const PLAN_AMOUNT_IN_PAISE = PLAN_PRICE * 100;
const TRIAL_DAYS = 3;
const SUBSCRIPTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const getRazorpayInstance = () => {
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

const createPaidWindow = (baseDate = new Date()) => {
  const startDate = new Date(baseDate);
  const expiryDate = new Date(baseDate.getTime() + SUBSCRIPTION_DAYS * DAY_MS);

  return { startDate, expiryDate };
};

const loadUserSubscription = async (userId) => {
  return Subscription.findOne({ userId });
};

const syncUserSubscriptionState = async (user, subscription) => {
  user.subscriptionID = subscription._id;
  user.isSubscribed = ['trial', 'active'].includes(subscription.status);
  await user.save();
};

// ==============================
// CREATE SUBSCRIPTION ORDER
// ==============================
export async function createSubscriptionOrder(req, res) {
  const userId = req.user._id;
  const paymentMethod = String(req.body.paymentMethod || '').trim().toLowerCase();

  if (!paymentMethod || !['upi', 'card'].includes(paymentMethod)) {
    throw new ApiError(400, 'Valid payment method is required (upi or card).');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  // Check if user already has an active (paid) subscription that hasn't expired
  const existingSubscription = await Subscription.findOne({
    userId,
    status: 'active',
    expiryDate: { $gt: new Date() },
  });

  if (existingSubscription) {
    throw new ApiError(
      400,
      'You already have an active subscription.',
      [{
        expiryDate: existingSubscription.expiryDate,
        planName: existingSubscription.planName,
      }]
    );
  }

  const amount = PLAN_AMOUNT_IN_PAISE;
  const currency = 'INR';
  const receipt = `rcpt_${Date.now().toString(36)}_${userId.toString().slice(-6)}`;

  const options = {
    amount,
    currency,
    receipt,
    notes: {
      userId: userId.toString(),
      plan: PLAN_NAME,
      paymentMethod,
    },
  };

  try {
    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create(options);

    // Get or create subscription record
    let subscription = await loadUserSubscription(userId);

    if (!subscription) {
      // This shouldn't normally happen as trial is created on registration
      // But handle it gracefully
      throw new ApiError(
        400,
        'Subscription record not found. Please contact support.'
      );
    }

    // Update subscription with order info
    subscription.planName = PLAN_NAME;
    subscription.price = PLAN_PRICE;
    subscription.paymentMethod = paymentMethod;
    subscription.razorpayOrderId = order.id;
    subscription.orderStatus = 'created';
    subscription.paymentStatus = 'created';
    subscription.paymentAmount = order.amount;
    subscription.paymentCurrency = order.currency;
    subscription.receipt = order.receipt;
    subscription.paymentNotes = order.notes;

    await subscription.save();

    // Save SubscriptionPayment record for this order
    const paymentRecord = await SubscriptionPayment.findOneAndUpdate(
      {
        userId,
        razorpayOrderId: order.id,
      },
      {
        $setOnInsert: {
          userId,
          subscriptionId: subscription._id,
          planName: PLAN_NAME,
          amount: order.amount,
          currency: order.currency,
          requestedPaymentMethod: paymentMethod,
          razorpayOrderId: order.id,
          status: 'created',
          gatewayStatus: 'created',
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    // Link user to subscription if not already linked
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
          planName: PLAN_NAME,
          planPrice: PLAN_PRICE,
          key: process.env.RAZORPAY_KEY_ID,
        },
        'Subscription order created successfully.'
      )
    );
  } catch (error) {
    // If it's already an ApiError, re-throw
    if (error instanceof ApiError) {
      throw error;
    }

    console.error('❌ RAZORPAY ORDER ERROR:', {
      statusCode: error?.statusCode,
      message: error?.message,
      description: error?.error?.description,
      field: error?.error?.field,
      source: error?.error?.source,
      step: error?.error?.step,
      reason: error?.error?.reason,
    });

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

  if (payment.amount !== PLAN_AMOUNT_IN_PAISE) {
    throw new ApiError(
      400,
      `Invalid payment amount. Expected ₹${PLAN_PRICE}, got ₹${payment.amount / 100}.`
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
  const { startDate, expiryDate } = createPaidWindow(now);

  subscription.planName = PLAN_NAME;
  subscription.price = PLAN_PRICE;
  subscription.status = 'active';
  subscription.startDate = startDate;
  subscription.expiryDate = expiryDate;
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
    await user.save();
  }

  // Sync user state for active subscriptions
  if (['trial', 'active'].includes(subscription.status)) {
    user.isSubscribed = true; // Both trial and active get app access
    user.subscriptionID = subscription._id;
    await user.save();
  }

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
        isSubscribed: ['trial', 'active'].includes(subscription.status),
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

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (receivedSignature !== expectedSignature) {
      console.error('[WEBHOOK] Signature mismatch');
      return res.status(400).json({ status: 'error', message: 'Invalid signature' });
    }
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log(`[WEBHOOK] Received event: ${event}`);

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
        await User.findByIdAndUpdate(subscription.userId, {
          isSubscribed: true,
          subscriptionID: subscription._id,
        });

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
  } catch (error) {
    console.error('[WEBHOOK] Error processing event:', error.message);
  }

  // Always return 200 to Razorpay to prevent retries
  return res.status(200).json({ status: 'ok' });
}
