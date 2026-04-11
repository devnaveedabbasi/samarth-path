// models/User.model.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true ,length: 15},
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['user', 'admin'],
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "blocked", "suspended"],
    default: "pending"
  },

  isEmailVerified: { type: Boolean, default: false },
  emailOTP: { type: String },
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },

  resetOTP: String,         
  resetOtpExpiry: Date,
  resetOtpAttempts: { type: Number, default: 0 },
  resetPasswordVerified: { type: Boolean, default: false },
  lastOTPSent: { type: Date },
  profileLastUpdated: { type: Date },

}, {
  timestamps: true,
  toJSON: { virtuals: true }
});



const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;