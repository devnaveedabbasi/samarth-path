// controllers/user/subscription.controller.js
import Subscription from '../../models/Subscription.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new ApiError(500, 'Payment gateway not configured.');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

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

  // Check if user already has an active subscription
  if (user.isSubscribed && user.subscriptionID) {
    const existingSub = await Subscription.findById(user.subscriptionID);
    if (existingSub && existingSub.status === 'active') {
      throw new ApiError(400, 'User already has an active subscription.');
    }
  }

  const amount = 19900; 
  const currency = 'INR';

  const options = {
    amount,
    currency,
    receipt: `receipt_${userId}_${Date.now()}`,
    payment_capture: 1,
  };

  try {
    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create(options);

    res.status(200).json(
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
  } catch (error) {
    throw new ApiError(500, 'Failed to create order.');
  }
}

// export async function verifyPayment(req, res) {
//   const userId = req.user._id;
//   const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentMethod } = req.body;

//   if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentMethod) {
//     throw new ApiError(400, 'Payment verification data is required.');
//   }

//   const user = await User.findById(userId);
//   if (!user) {
//     throw new ApiError(404, 'User not found.');
//   }

//   // Verify signature
//   const sign = razorpay_order_id + '|' + razorpay_payment_id;
//   const expectedSign = crypto
//     .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
//     .update(sign.toString())
//     .digest('hex');

//   if (razorpay_signature !== expectedSign) {
//     throw new ApiError(400, 'Payment verification failed.');
//   }

//   // Create or update subscription
//   const now = new Date();
//   const expiryDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

//   let subscription = await Subscription.findOne({ userId });
//   if (!subscription) {
//     subscription = new Subscription({
//       userId,
//       planName: 'Monthly Basic',
//       price: 199,
//       status: 'active',
//       startDate: now,
//       expiryDate,
//       paymentMethod,
//       paymentRef: razorpay_payment_id,
//     });
//   } else {
//     subscription.status = 'active';
//     subscription.startDate = now;
//     subscription.expiryDate = expiryDate;
//     subscription.paymentMethod = paymentMethod;
//     subscription.paymentRef = razorpay_payment_id;
//   }

//   await subscription.save();

//   // Update user
//   user.isSubscribed = true;
//   user.subscriptionID = subscription._id;
//   await user.save();

//   res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         subscriptionId: subscription._id,
//         status: subscription.status,
//         expiryDate: subscription.expiryDate,
//       },
//       'Payment verified and subscription activated.'
//     )
//   );
// }


export async function verifyPayment(req, res) {
  const userId = req.user._id;
  const { paymentMethod } = req.body;

  if (!paymentMethod || !['upi', 'card'].includes(paymentMethod)) {
    throw new ApiError(400, 'Valid payment method is required.');
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  // 30 days subscription
  const now = new Date();
  const expiryDate = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000
  );

  let subscription = await Subscription.findOne({ userId });

  if (!subscription) {
    subscription = new Subscription({
      userId,
      planName: 'Monthly Basic',
      price: 199,
      status: 'active',
      startDate: now,
      expiryDate,
      paymentMethod,
      paymentRef: 'TEST_PAYMENT',
    });
  } else {
    subscription.planName = 'Monthly Basic';
    subscription.price = 199;
    subscription.status = 'active';
    subscription.startDate = now;
    subscription.expiryDate = expiryDate;
    subscription.paymentMethod = paymentMethod;
    subscription.paymentRef = 'TEST_PAYMENT';
  }

  await subscription.save();

  // Update user
  user.isSubscribed = true;
  user.subscriptionID = subscription._id;

  await user.save();

  res.status(200).json(
    new ApiResponse(
      200,
      {
        subscriptionId: subscription._id,
        status: subscription.status,
        expiryDate: subscription.expiryDate,
      },
      'Subscription activated successfully.'
    )
  );
}

export async function getSubscriptionStatus(req, res) {
  const userId = req.user._id;

  const user = await User.findById(userId).populate('subscriptionID');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.isSubscribed || !user.subscriptionID) {
    // Create trial subscription if not exists
    const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    let subscription = await Subscription.findOne({ userId });
    if (!subscription) {
      subscription = new Subscription({
        userId,
        status: 'trial',
        expiryDate: trialEndDate,
      });
      await subscription.save();
      user.subscriptionID = subscription._id;
      await user.save();
    }
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          isSubscribed: false,
          status: subscription.status,
          expiryDate: subscription.expiryDate,
          trialEndDate: subscription.trialEndDate,
        },
        'Subscription status retrieved.'
      )
    );
  }

  const subscription = user.subscriptionID;

  // Check if expired
  const now = new Date();
  if (subscription.status === 'trial' && subscription.trialEndDate < now) {
    subscription.status = 'expired';
    await subscription.save();
  } else if (subscription.status === 'active' && subscription.expiryDate < now) {
    subscription.status = 'expired';
    user.isSubscribed = false;
    await user.save();
    await subscription.save();
  }

  res.status(200).json(
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