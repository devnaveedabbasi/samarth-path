// models/WebhookEvent.model.js
// Records a hash of each verified Razorpay webhook delivery so retried
// deliveries (Razorpay resends the identical payload on retry) can be
// detected and skipped before any business logic runs. The unique index on
// `hash` makes this safe under concurrent duplicate deliveries — a duplicate
// insert simply fails with a 11000 error, which the caller treats as "already
// processed". Entries expire automatically after 7 days (comfortably longer
// than Razorpay's webhook retry window), so this collection self-cleans.
import mongoose from 'mongoose';

const webhookEventSchema = new mongoose.Schema({
  hash: {
    type: String,
    required: true,
    unique: true,
  },
  event: {
    type: String,
  },
  receivedAt: {
    type: Date,
    default: Date.now,
    expires: '7d',
  },
});

const WebhookEvent =
  mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);

export default WebhookEvent;
