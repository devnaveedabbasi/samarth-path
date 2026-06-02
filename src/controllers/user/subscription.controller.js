
import Subscription from '../../models/Subscription.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

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

  console.log('✅ Razorpay Initialized');

  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

// ==============================
// CREATE SUBSCRIPTION ORDER
// ==============================
export async function createSubscriptionOrder(req, res) {
  const userId = req.user._id;
  const paymentMethod = req.body.paymentMethod;

  if (!paymentMethod || !['upi', 'card'].includes(paymentMethod)) {
    throw new ApiError(400, 'Valid payment method is required.');
  }


  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  console.log(' User found:', user);

  // Prevent duplicate active subscription
  const existingSubscription = await Subscription.findOne({
    userId,
    status: 'active',
  });

  if (existingSubscription) {
    throw new ApiError(
      400,
      'User already has an active subscription.'
    );
  }

  const amount = 19900; // ₹199 in paise
  const currency = 'INR';

  const options = {
    amount,
    currency,
    receipt: `rcpt_${Math.floor(Date.now() / 1000)}`, notes: {
      userId: userId.toString(),
      plan: 'Monthly Basic',
    },
  };

  try {
    const razorpay = getRazorpayInstance();

    const order = await razorpay.orders.create(options);

    console.log('✅ Razorpay Order Created:', order.id);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          key: process.env.RAZORPAY_KEY_ID,
        },
        'Subscription order created successfully.'
      )
    );
  }

  catch (error) {
    console.error('❌ FULL RAZORPAY ERROR');

    console.error({
      statusCode: error?.statusCode,
      message: error?.message,
      description: error?.error?.description,
      field: error?.error?.field,
      source: error?.error?.source,
      step: error?.error?.step,
      reason: error?.error?.reason,
      metadata: error?.error?.metadata,
      raw: error,
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
      'Payment verification data is required.'
    );
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  // ==============================
  // VERIFY SIGNATURE
  // ==============================
  const generatedSignature = crypto
    .createHmac(
      'sha256',
      process.env.RAZORPAY_KEY_SECRET
    )
    .update(
      `${razorpay_order_id}|${razorpay_payment_id}`
    )
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    throw new ApiError(400, 'Payment verification failed.');
  }

  const razorpay = getRazorpayInstance();

  // ==============================
  // FETCH PAYMENT FROM RAZORPAY
  // ==============================
  const payment = await razorpay.payments.fetch(
    razorpay_payment_id
  );

  if (!payment) {
    throw new ApiError(404, 'Payment not found.');
  }

  // ==============================
  // VALIDATE PAYMENT
  // ==============================
  if (payment.status !== 'captured') {
    throw new ApiError(
      400,
      'Payment is not captured.'
    );
  }

  if (payment.amount !== 19900) {
    throw new ApiError(
      400,
      'Invalid payment amount.'
    );
  }

  if (payment.currency !== 'INR') {
    throw new ApiError(
      400,
      'Invalid payment currency.'
    );
  }

  // ==============================
  // SUBSCRIPTION DATES
  // ==============================
  const now = new Date();

  const expiryDate = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000
  );

  // ==============================
  // CREATE / UPDATE SUBSCRIPTION
  // ==============================
  let subscription = await Subscription.findOne({
    userId,
  });

  if (!subscription) {
    subscription = new Subscription({
      userId,
      planName: 'Monthly Basic',
      price: 199,
      status: 'active',
      startDate: now,
      expiryDate,
      paymentMethod: payment.method,
      paymentRef: razorpay_payment_id,
    });
  } else {
    subscription.planName = 'Monthly Basic';
    subscription.price = 199;
    subscription.status = 'active';
    subscription.startDate = now;
    subscription.expiryDate = expiryDate;
    subscription.paymentMethod = payment.method;
    subscription.paymentRef = razorpay_payment_id;
  }

  await subscription.save();

  // ==============================
  // UPDATE USER
  // ==============================
  user.isSubscribed = true;
  user.subscriptionID = subscription._id;

  await user.save();

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        subscriptionId: subscription._id,
        status: subscription.status,
        expiryDate: subscription.expiryDate,
      },
      'Payment verified and subscription activated.'
    )
  );
}

// ==============================
// GET SUBSCRIPTION STATUS
// ==============================
export async function getSubscriptionStatus(req, res) {
  const userId = req.user._id;

  const user = await User.findById(userId).populate(
    'subscriptionID'
  );

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  // ==============================
  // CREATE TRIAL
  // ==============================
  if (!user.subscriptionID) {
    const now = new Date();

    const trialEndDate = new Date(
      now.getTime() + 3 * 24 * 60 * 60 * 1000
    );

    const subscription = new Subscription({
      userId,
      status: 'trial',
      trialEndDate,
    });

    await subscription.save();

    user.subscriptionID = subscription._id;

    await user.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          isSubscribed: false,
          status: subscription.status,
          trialEndDate:
            subscription.trialEndDate,
        },
        'Trial subscription activated.'
      )
    );
  }

  const subscription = user.subscriptionID;

  const now = new Date();

  // ==============================
  // HANDLE EXPIRY
  // ==============================
  if (
    subscription.status === 'trial' &&
    subscription.trialEndDate &&
    subscription.trialEndDate < now
  ) {
    subscription.status = 'expired';

    await subscription.save();
  }

  if (
    subscription.status === 'active' &&
    subscription.expiryDate &&
    subscription.expiryDate < now
  ) {
    subscription.status = 'expired';

    user.isSubscribed = false;

    await subscription.save();

    await user.save();
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        isSubscribed: user.isSubscribed,
        status: subscription.status,
        expiryDate: subscription.expiryDate,
        trialEndDate: subscription.trialEndDate,
        planName: subscription.planName,
        price: subscription.price,
      },
      'Subscription status retrieved.'
    )
  );
}

export const testRazorpayOrder = async (req, res) => {
  try {
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const order = await razorpay.orders.create({
      amount: 100, // ₹1
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
    });

    return res.status(200).json({
      success: true,
      order,
    });
  } catch (err) {
    console.log("RAZORPAY TEST ERROR:", err);

    return res.status(500).json({
      success: false,
      error: err,
    });
  }
};