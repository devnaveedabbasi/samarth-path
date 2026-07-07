// models/Prize.model.js
import mongoose from 'mongoose';

const prizeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  imageUrl: String,
  prizeType: {
    type: String,
    enum: ['daily', 'weekly'],
    required: true
  },
  // Daily prize is tied to the specific quiz (Content doc) it belongs to
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content'
  },
  // Weekly prize is tied to a week/year, not to a specific quiz
  weekNumber: Number,
  year: Number,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// One prize per quiz (daily prizes only)
prizeSchema.index(
  { quizId: 1 },
  { unique: true, partialFilterExpression: { quizId: { $exists: true } } }
);

// One prize per week/year (weekly prizes only)
prizeSchema.index(
  { weekNumber: 1, year: 1, prizeType: 1 },
  { unique: true, partialFilterExpression: { prizeType: 'weekly' } }
);

const Prize = mongoose.models.Prize || mongoose.model('Prize', prizeSchema);
export default Prize;
