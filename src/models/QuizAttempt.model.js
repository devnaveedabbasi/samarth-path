// models/QuizAttempt.model.js
import mongoose from 'mongoose';

const quizAttemptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  contentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content',
    required: true
  },
  selectedOptionId: {
    type: String,
    required: true
  },
  isCorrect: {
    type: Boolean,
    required: true
  },
  timeTakenSeconds: {
    type: Number,
    default: 0
  },
  weekNumber: {
    type: Number,
    required: true // ISO week number
  },
  year: {
    type: Number,
    required: true
  },
  dayNumber: {
    type: Number,
    required: true // Day of week or day of month
  }
}, {
  timestamps: true
});

// Index for weekly/daily score tracking
quizAttemptSchema.index({ userId: 1, weekNumber: 1, year: 1 });
quizAttemptSchema.index({ userId: 1, contentId: 1 }, { unique: true }); // One attempt per user per quiz

const QuizAttempt = mongoose.models.QuizAttempt || mongoose.model('QuizAttempt', quizAttemptSchema);
export default QuizAttempt;