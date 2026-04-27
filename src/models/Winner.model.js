// models/Winner.model.js
import mongoose from 'mongoose';

const winnerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rank: {
    type: Number,
    required: true // 1st, 2nd, 3rd, etc.
  },
  score: {
    type: Number,
    required: true
  },
  weekNumber: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  cycleType: {
    type: String,
    enum: ['weekly', 'daily'],
    default: 'weekly'
  },
  prizeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Prize'
  }
}, {
  timestamps: true
});

// Index for efficient winner queries
winnerSchema.index({ weekNumber: 1, year: 1, cycleType: 1 });
winnerSchema.index({ userId: 1, weekNumber: 1, year: 1, cycleType: 1 }, { unique: true });

const Winner = mongoose.models.Winner || mongoose.model('Winner', winnerSchema);
export default Winner;