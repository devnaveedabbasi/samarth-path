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
    enum: ['trial', 'active', 'expired', 'cancelled'],
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
  paymentRef: {
    type: String // Transaction ID from Razorpay
  },
  trialStartDate: {
    type: Date,
    default: Date.now
  },
  trialEndDate: {
    type: Date,
    default: () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
  }
}, {
  timestamps: true
});

const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);
export default Subscription;