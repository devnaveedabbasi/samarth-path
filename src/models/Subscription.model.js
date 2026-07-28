// models/Subscription.model.js
import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  planName: {
    type: String,
    required: true,
    default: 'Monthly Basic'
  },
  price: {
    type: Number,
    required: true,
    default: 199
  },
  status: {
    type: String,
    enum: ['trial', 'pending', 'active', 'expired', 'cancelled'],
    default: 'trial'
  },
  startDate: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  paymentMethod: {
    type: String,
  },
  razorpayOrderId: {
    type: String,
    index: true,
    sparse: true
  },

  razorpayPaymentId: {
    type: String,
    unique: true,
    sparse: true,  // ← bas ye add karo
  },
  razorpaySignature: {
    type: String
  },
  orderStatus: {
    type: String,
    enum: ['created', 'paid', 'failed'],
    default: 'created'
  },
  paymentStatus: {
    type: String,
    enum: ['created', 'captured', 'failed', 'refunded', 'not_applicable'],
    default: 'not_applicable'
  },
  paymentAmount: {
    type: Number
  },
  paymentCurrency: {
    type: String,
    default: 'INR'
  },
  paidAt: {
    type: Date
  },
  paymentRef: {
    type: String // Transaction ID from Razorpay
  },
  receipt: {
    type: String
  },
  paymentNotes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  trialStartDate: {
    type: Date
  },
  trialEndDate: {
    type: Date
  },
  trialNotificationSent: {
    type: Boolean,
    default: false
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  // Razorpay Subscriptions API (true auto-debit / UPI AutoPay flow)
  razorpayCustomerId: {
    type: String,
    sparse: true
  },
  razorpaySubscriptionId: {
    type: String,
    index: true,
    sparse: true
  },
  razorpayPlanId: {
    type: String
  },
  razorpaySubscriptionStatus: {
    type: String,
    enum: [
      'created', 'authenticated', 'active', 'pending',
      'halted', 'cancelled', 'completed', 'expired', null
    ],
    default: null
  },
  nextBillingDate: {
    type: Date,
    default: null
  },
  billingCycleCount: {
    type: Number,
    default: 0
  },
  cancelledAt: {
    type: Date,
    default: null
  },
  paymentHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPayment'
  }],
  // Admin-granted subscription tracking (no payment involved)
  grantedByAdmin: {
    type: Boolean,
    default: false
  },
  grantedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  adminNotes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
export default Subscription;