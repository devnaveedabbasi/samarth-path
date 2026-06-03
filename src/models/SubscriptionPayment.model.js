// models/SubscriptionPayment.model.js
import mongoose from 'mongoose';

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
    },
    planName: {
      type: String,
      required: true,
      default: 'Monthly Basic',
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      default: 'INR',
    },
    requestedPaymentMethod: {
      type: String,
      enum: ['upi', 'card'],
      required: true,
    },
    actualPaymentMethod: {
      type: String,
      enum: ['upi', 'card'],
      default: null,
    },
    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    razorpaySignature: {
      type: String,
      default: null,
    },
    gatewayStatus: {
      type: String,
      default: 'created',
    },
    status: {
      type: String,
      enum: ['created', 'pending', 'paid', 'failed', 'verified'],
      default: 'created',
    },
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const SubscriptionPayment =
  mongoose.models.SubscriptionPayment ||
  mongoose.model('SubscriptionPayment', subscriptionPaymentSchema);

export default SubscriptionPayment;