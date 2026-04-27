// models/Comment.model.js
import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DailyContent',
    required: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 500
  },
  likesCount: { type: Number, default: 0 },
  repliesCount: { type: Number, default: 0 },
  parentCommentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null // For nested replies
  }
}, {
  timestamps: true
});

const Comment = mongoose.models.Comment || mongoose.model('Comment', commentSchema);
export default Comment;