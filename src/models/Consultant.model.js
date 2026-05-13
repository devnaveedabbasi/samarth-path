import mongoose from 'mongoose';

const consultantSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    sender: {
      type: String,
      enum: ['user', 'admin'],
      required: true,
      default: 'user'
    },
    message: {
      type: String,
      required: true,
      trim: true
    },
    isDeleted: {
      type: Boolean,
      default: false
    },
    deletedAt: {
      type: Date,
      default: null
    },
    editedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

const Consultant =
  mongoose.models.Consultant ||
  mongoose.model('Consultant', consultantSchema);

export default Consultant;