// models/Prize.model.js
import mongoose from 'mongoose';

const prizeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: String,
  imageUrl: String,
  weekNumber: {
    type: Number,
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  prizeType: {
    type: String,
    enum: ['weekly', 'daily'],
    default: 'weekly'
  }
}, {
  timestamps: true
});

prizeSchema.index({ weekNumber: 1, year: 1, prizeType: 1 }, { unique: true });

const Prize = mongoose.models.Prize || mongoose.model('Prize', prizeSchema);
export default Prize;