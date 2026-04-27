// models/Bookmark.model.js
import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema({
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
  bookmarkedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Ensure one bookmark per user per content
bookmarkSchema.index({ userId: 1, contentId: 1 }, { unique: true });

const Bookmark = mongoose.models.Bookmark || mongoose.model('Bookmark', bookmarkSchema);
export default Bookmark;