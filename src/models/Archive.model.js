// models/Archive.model.js
import mongoose from 'mongoose';

const archiveSchema = new mongoose.Schema({
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
  archivedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false
});

// Ensure one archive per user per content
archiveSchema.index({ userId: 1, contentId: 1 }, { unique: true });

const Archive = mongoose.models.Archive || mongoose.model('Archive', archiveSchema);
export default Archive;