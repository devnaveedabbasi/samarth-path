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
    winnerDate: Date, // daily winner ke liye

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

// A user can only be crowned WEEKLY winner once per week — weekNumber/year
// are meaningful at week granularity, so this constraint only makes sense
// for cycleType: 'weekly'. Applying it to 'daily' too (as a single shared
// index) would wrongly block the same user from winning on two different
// days within the same week, since weekNumber/year don't change within a week.
winnerSchema.index(
  { userId: 1, weekNumber: 1, year: 1, cycleType: 1 },
  { unique: true, partialFilterExpression: { cycleType: 'weekly' } }
);

const Winner = mongoose.models.Winner || mongoose.model('Winner', winnerSchema);
export default Winner;