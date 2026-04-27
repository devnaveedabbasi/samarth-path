// models/Like.model.js
import mongoose from 'mongoose';

const likeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DailyContent',
    required: true
  }
}, {
  timestamps: true
});

// Ensure one like per user per content
likeSchema.index({ userId: 1, contentId: 1 }, { unique: true });

const Like = mongoose.models.Like || mongoose.model('Like', likeSchema);
export default Like;