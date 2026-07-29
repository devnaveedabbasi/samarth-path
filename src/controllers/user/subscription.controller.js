
// import Subscription from '../../models/Subscription.model.js';
// import SubscriptionPayment from '../../models/SubscriptionPayment.model.js';
// import User from '../../models/User.model.js';
// import WebhookEvent from '../../models/WebhookEvent.model.js';
// import { ApiError } from '../../utils/errorHandler.js';
// import { ApiResponse } from '../../utils/apiResponse.js';
// import Razorpay from 'razorpay';
// import crypto from 'crypto';


// export const createPaidWindow = (baseDate = new Date()) => {
//   const startDate = new Date(baseDate);
//   const expiryDate = new Date(baseDate.getTime() + SUBSCRIPTION_DAYS * DAY_MS);

//   return { startDate, expiryDate };
// };

// const loadUserSubscription = async (userId) => {
//   return Subscription.findOne({ userId });
// };

// export const syncUserSubscriptionState = async (user, subscription, session) => {
//   user.subscriptionID = subscription._id;
//   if (subscription.status === 'active') {
//     user.isSubscribed = true;
//     user.isTrial = false;
//   } else if (subscription.status === 'trial') {
//     user.isSubscribed = false;
//     user.isTrial = true;
//   } else {
//     user.isSubscribed = false;
//     user.isTrial = false;
//   }
//   await user.save(session ? { session } : undefined);
// };

// // ==============================
// // CREATE SUBSCRIPTION ORDER
// // ==============================
// export async function createSubscriptionOrder(req, res) {
//   try {
//     const userId = req.user._id;

//     const paymentMethod = String(req.body.paymentMethod || 'upi')
//       .trim()
//       .toLowerCase();

//     // ✅ find user
//     const user = await User.findById(userId);

//     if (!user) {
//       throw new ApiError(404, 'User not found.');
//     }

//     // ✅ check active subscription
//     const existingSubscription = await Subscription.findOne({
//       userId,
//       status: 'active',
//       expiryDate: { $gt: new Date() },
//     });

//     if (existingSubscription) {
//       throw new ApiError(
//         400,
//         'You already have an active subscription.',
//         [
//           {
//             expiryDate: existingSubscription.expiryDate,
//             planName: existingSubscription.planName,
//           },
//         ]
//       );
//     }

//     // Determine if this is a trial payment (₹5) or full subscription (₹199)
//     let subscription = await loadUserSubscription(userId);

//     if (!subscription) {
//       throw new ApiError(
//         400,
//         'Subscription record not found. Please contact support.'
//       );
//     }

//     // Agar subscription 'pending' hai, iska matlab abhi tak user ne trial activate nahi kiya
//     const isTrialPayment = subscription.status === 'pending';

//     const amount = isTrialPayment ? TRIAL_AMOUNT_IN_PAISE : PLAN_AMOUNT_IN_PAISE;
//     const planLabel = isTrialPayment ? TRIAL_PLAN_NAME : PLAN_NAME;
//     const planPrice = isTrialPayment ? TRIAL_PRICE : PLAN_PRICE;

//     if (!amount || amount <= 0) {
//       throw new ApiError(500, 'Invalid plan configuration.');
//     }

//     const currency = 'INR';

//     const receipt = `rcpt_${Date.now().toString(36)}_${userId
//       .toString()
//       .slice(-6)}`;

//     // ✅ Razorpay order payload
//     const options = {
//       amount,
//       currency,
//       receipt,
//       notes: {
//         userId: userId.toString(),
//         plan: planLabel,
//         paymentMethod,
//         isTrialPayment: String(isTrialPayment),
//       },
//     };

//     const razorpay = getRazorpayInstance();
//     const order = await razorpay.orders.create(options);

//     // ❌ IMPORTANT FIX:
//     // Only update subscription — DO NOT create payment record here

//     subscription.planName = planLabel;
//     subscription.price = planPrice;
//     subscription.paymentMethod = paymentMethod;

//     subscription.razorpayOrderId = order.id;
//     subscription.orderStatus = 'created';
//     subscription.paymentStatus = 'created';

//     subscription.paymentAmount = order.amount;
//     subscription.paymentCurrency = order.currency;
//     subscription.receipt = order.receipt;
//     subscription.paymentNotes = order.notes;

//     await subscription.save();

//     // link user
//     if (String(user.subscriptionID || '') !== String(subscription._id)) {
//       user.subscriptionID = subscription._id;
//       await user.save();
//     }

//     return res.status(200).json(
//       new ApiResponse(
//         200,
//         {
//           orderId: order.id,
//           amount: order.amount,
//           currency: order.currency,
//           receipt: order.receipt,
//           paymentMethod,
//           planName: planLabel,
//           planPrice: planPrice,
//           isTrialPayment,
//           key: process.env.RAZORPAY_KEY_ID,
//         },
//         'Subscription order created successfully.'
//       )
//     );
//   } catch (error) {
//     console.error('❌ RAZORPAY ORDER ERROR:', error);

//     if (error instanceof ApiError) {
//       throw error;
//     }

//     throw new ApiError(
//       500,
//       error?.error?.description ||
//       error?.message ||
//       'Failed to create payment order'
//     );
//   }
// }

// // ==============================
// // VERIFY PAYMENT
// // ==============================
// export async function verifyPayment(req, res) {
//   const userId = req.user._id;

//   const {
//     razorpay_order_id,
//     razorpay_payment_id,
//     razorpay_signature,
//   } = req.body;

//   if (
//     !razorpay_order_id ||
//     !razorpay_payment_id ||
//     !razorpay_signature
//   ) {
//     throw new ApiError(
//       400,
//       'Payment verification data is required (razorpay_order_id, razorpay_payment_id, razorpay_signature).'
//     );
//   }

//   const user = await User.findById(userId);

//   if (!user) {
//     throw new ApiError(404, 'User not found.');
//   }

//   const subscription = await Subscription.findOne({
//     userId,
//     razorpayOrderId: razorpay_order_id,
//   });

//   if (!subscription) {
//     throw new ApiError(
//       404,
//       'Subscription order not found for this payment.'
//     );
//   }

//   // Idempotency check — if already verified, return success
//   if (
//     subscription.razorpayPaymentId === razorpay_payment_id &&
//     subscription.status === 'active' &&
//     subscription.paymentStatus === 'captured'
//   ) {
//     return res.status(200).json(
//       new ApiResponse(
//         200,
//         {
//           subscriptionId: subscription._id,
//           status: subscription.status,
//           expiryDate: subscription.expiryDate,
//           paymentId: subscription.razorpayPaymentId,
//           planName: subscription.planName,
//           price: subscription.price,
//         },
//         'Payment already verified.'
//       )
//     );
//   }

//   // Verify Razorpay signature
//   const generatedSignature = crypto
//     .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
//     .update(`${razorpay_order_id}|${razorpay_payment_id}`)
//     .digest('hex');

//   if (generatedSignature !== razorpay_signature) {
//     // Update payment record as failed
//     await SubscriptionPayment.findOneAndUpdate(
//       { userId, razorpayOrderId: razorpay_order_id },
//       {
//         $set: {
//           status: 'failed',
//           gatewayStatus: 'signature_mismatch',
//         },
//       }
//     );

//     throw new ApiError(400, 'Payment verification failed. Invalid signature.');
//   }

//   // Fetch payment details from Razorpay to verify amount, currency, status
//   const razorpay = getRazorpayInstance();
//   const payment = await razorpay.payments.fetch(razorpay_payment_id);

//   if (!payment) {
//     throw new ApiError(404, 'Payment not found on Razorpay.');
//   }

//   if (payment.status !== 'captured') {
//     throw new ApiError(
//       400,
//       `Payment is not captured. Current status: ${payment.status}`
//     );
//   }

//   const validAmounts = [TRIAL_AMOUNT_IN_PAISE, PLAN_AMOUNT_IN_PAISE];
//   if (!validAmounts.includes(payment.amount)) {
//     throw new ApiError(
//       400,
//       `Invalid payment amount. Got ₹${payment.amount / 100}.`
//     );
//   }

//   if (payment.currency !== 'INR') {
//     throw new ApiError(
//       400,
//       'Invalid payment currency. Only INR is supported.'
//     );
//   }

//   if (payment.order_id && payment.order_id !== razorpay_order_id) {
//     throw new ApiError(400, 'Payment order mismatch.');
//   }

//   // All checks passed — activate subscription
//   const now = new Date();
//   const isTrialPayment = payment.amount === TRIAL_AMOUNT_IN_PAISE;

//   if (isTrialPayment) {
//     // ₹5 trial payment — keep status 'trial', set trialEndDate
//     const trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
//     subscription.planName = TRIAL_PLAN_NAME;
//     subscription.price = TRIAL_PRICE;
//     subscription.status = 'trial';
//     subscription.trialStartDate = now;
//     subscription.trialEndDate = trialEndDate;
//     user.isTrial = true;
//   } else {
//     // ₹199 full subscription
//     const { startDate, expiryDate } = createPaidWindow(now);
//     subscription.planName = PLAN_NAME;
//     subscription.price = PLAN_PRICE;
//     subscription.status = 'active';
//     subscription.startDate = startDate;
//     subscription.expiryDate = expiryDate;
//     user.isTrial = false;
//   }
//   subscription.paymentMethod = payment.method || subscription.paymentMethod;
//   subscription.paymentRef = razorpay_payment_id;
//   subscription.razorpayOrderId = razorpay_order_id;
//   subscription.razorpayPaymentId = razorpay_payment_id;
//   subscription.razorpaySignature = razorpay_signature;
//   subscription.orderStatus = 'paid';
//   subscription.paymentStatus = payment.status;
//   subscription.paymentAmount = payment.amount;
//   subscription.paymentCurrency = payment.currency;
//   subscription.paidAt = now;
//   subscription.paymentNotes = {
//     ...(subscription.paymentNotes || {}),
//     razorpayPaymentId: razorpay_payment_id,
//     method: payment.method,
//   };

//   // Save/update SubscriptionPayment record
//   const paymentRecord = await SubscriptionPayment.findOneAndUpdate(
//     {
//       userId,
//       razorpayOrderId: razorpay_order_id,
//     },
//     {
//       $setOnInsert: {
//         userId,
//         razorpayOrderId: razorpay_order_id,
//         planName: PLAN_NAME,
//         amount: payment.amount,
//         currency: payment.currency,
//         requestedPaymentMethod: subscription.paymentMethod,
//       },
//       $set: {
//         subscriptionId: subscription._id,
//         razorpayPaymentId: razorpay_payment_id,
//         razorpaySignature: razorpay_signature,
//         actualPaymentMethod: payment.method,
//         gatewayStatus: payment.status,
//         status: 'paid',
//         verifiedAt: now,
//         gatewayResponse: payment,
//       },
//     },
//     {
//       new: true,
//       upsert: true,
//     }
//   );

//   // Add payment to subscription's payment history
//   if (paymentRecord && !subscription.paymentHistory.includes(paymentRecord._id)) {
//     subscription.paymentHistory.push(paymentRecord._id);
//   }

//   await subscription.save();

//   // Sync user state
//   await syncUserSubscriptionState(user, subscription);

//   return res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         subscriptionId: subscription._id,
//         status: subscription.status,
//         startDate: subscription.startDate,
//         expiryDate: subscription.expiryDate,
//         planName: subscription.planName,
//         price: subscription.price,
//         paymentMethod: subscription.paymentMethod,
//         paymentId: subscription.razorpayPaymentId,
//       },
//       'Payment verified and subscription activated for 30 days.'
//     )
//   );
// }

// // ==============================
// // GET SUBSCRIPTION STATUS
// // ==============================
// export async function getSubscriptionStatus(req, res) {
//   const userId = req.user._id;

//   const user = await User.findById(userId).populate('subscriptionID');

//   if (!user) {
//     throw new ApiError(404, 'User not found.');
//   }

//   let subscription = user.subscriptionID;

//   // If subscription ref is missing on user, try to find it directly
//   if (!subscription) {
//     subscription = await loadUserSubscription(userId);

//     if (subscription) {
//       user.subscriptionID = subscription._id;
//       await user.save();
//     }
//   }

//   // No subscription found at all
//   if (!subscription) {
//     return res.status(200).json(
//       new ApiResponse(
//         200,
//         {
//           isSubscribed: false,
//           hasSubscription: false,
//           status: 'none',
//           message: 'No subscription found. Please contact support if this is an error.',
//         },
//         'No subscription found.'
//       )
//     );
//   }

//   const now = new Date();

//   // Auto-expire trial if trialEndDate has passed
//   if (
//     subscription.status === 'trial' &&
//     subscription.trialEndDate &&
//     subscription.trialEndDate < now
//   ) {
//     subscription.status = 'expired';
//     await subscription.save();

//     user.isSubscribed = false;
//     user.isTrial = false;
//     await user.save();
//   }

//   // Auto-expire paid subscription if expiryDate has passed
//   if (
//     subscription.status === 'active' &&
//     subscription.expiryDate &&
//     subscription.expiryDate < now
//   ) {
//     subscription.status = 'expired';
//     await subscription.save();

//     user.isSubscribed = false;
//     user.isTrial = false;
//     await user.save();
//   }

//   // Sync user state
//   await syncUserSubscriptionState(user, subscription);

//   // Calculate remaining days
//   let remainingDays = 0;
//   if (subscription.status === 'trial' && subscription.trialEndDate) {
//     remainingDays = Math.max(0, Math.ceil((subscription.trialEndDate - now) / DAY_MS));
//   } else if (subscription.status === 'active' && subscription.expiryDate) {
//     remainingDays = Math.max(0, Math.ceil((subscription.expiryDate - now) / DAY_MS));
//   }

//   return res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         isSubscribed: user.isSubscribed,
//         isTrial: user.isTrial,
//         hasSubscription: true,
//         status: subscription.status,
//         expiryDate: subscription.expiryDate,
//         trialEndDate: subscription.trialEndDate,
//         startDate: subscription.startDate,
//         planName: subscription.planName,
//         price: subscription.price,
//         paymentMethod: subscription.paymentMethod || null,
//         orderStatus: subscription.orderStatus || null,
//         paymentStatus: subscription.paymentStatus || null,
//         remainingDays,
//         paidAt: subscription.paidAt || null,
//       },
//       'Subscription status retrieved.'
//     )
//   );
// }

// // ==============================
// // GET PAYMENT HISTORY
// // ==============================
// export async function getPaymentHistory(req, res) {
//   const userId = req.user._id;

//   const payments = await SubscriptionPayment.find({ userId })
//     .sort({ createdAt: -1 })
//     .lean();

//   return res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         payments,
//         total: payments.length,
//       },
//       'Payment history retrieved.'
//     )
//   );
// }


