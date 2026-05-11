// models/ArchivedContent.model.js
import mongoose from 'mongoose';

const archivedContentSchema = new mongoose.Schema({
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  contentType: {
    type: String,
    enum: ['text', 'quiz', 'video'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  archivedAt: {
    type: Date,
    default: Date.now
  },
  metadata: {
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    bookmarksCount: { type: Number, default: 0 },
    views: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

// Indexes for efficient date-based queries
archivedContentSchema.index({ date: -1 });
archivedContentSchema.index({ contentType: 1, date: -1 });
archivedContentSchema.index({ contentId: 1 }, { unique: true });

const ArchivedContent = mongoose.models.ArchivedContent || mongoose.model('ArchivedContent', archivedContentSchema);
export default ArchivedContent;
