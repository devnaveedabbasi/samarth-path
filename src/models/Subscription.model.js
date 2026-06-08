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
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date,
    required: true
  },
  paymentMethod: {
    type: String,
    enum: ['upi', 'card']
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
    type: Date,
    default: Date.now
  },
  trialEndDate: {
    type: Date,
    default: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
  },
  trialNotificationSent: {
    type: Boolean,
    default: false
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  paymentHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SubscriptionPayment'
  }]
}, {
  timestamps: true
});

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
export default Subscription;