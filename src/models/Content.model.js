// models/Content.model.js
import mongoose from 'mongoose';

const contentSchema = new mongoose.Schema({
  contentType: {
    type: String,
    enum: ['text', 'quiz', 'video'],
    required: true
  },
  unlocksAt: {
    type: String,
    required: true
  },

  isNotified: {
    type: Boolean,
    default: false
  },
  date: {
    type: Date,
    default: () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
  },

  // For Text Content
  textContent: {
    title: String,
    description: String,
    label: String,
    image: String,
  },

  // For Quiz Content
  quizContent: {
    title: String,
    question: String,
    options: [{
      id: String,
      text: String
    }],
    correctOptionId: String,
    timerSeconds: { type: Number, default: 180 },
    explanation: String
  },

  // For Video Content
  videoContent: {
    title: String,
    videoUrl: String,
    durationMinutes: Number,
    thumbnail: String,
    isAutoMute: { type: Boolean, default: true },
    hasListenOnlyMode: { type: Boolean, default: true },
    description: String
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  likesCount: { type: Number, default: 0 },
  commentsCount: { type: Number, default: 0 },
  bookmarksCount: { type: Number, default: 0 }

}, {
  timestamps: true
});

// Compound index to ensure one content per type per date
contentSchema.index({ contentType: 1, date: 1 }, { unique: true });

const Content = mongoose.models.Content || mongoose.model('Content', contentSchema);
export default Content;