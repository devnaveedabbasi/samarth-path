// models/User.model.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, required: true, unique: true, length: 15 },
  password: { type: String, select: false },
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
  gender: { type: String, enum: ['male', 'female', 'other'] },
  dateOfBirth: { type: Date ,default: null},
  profilePicture: { type: String ,default: null},
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  phoneOTP: { type: String },
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },

  resetOTP: String,         
  resetOtpExpiry: Date,
  resetOtpAttempts: { type: Number, default: 0 },
  resetPasswordVerified: { type: Boolean, default: false },
  lastOTPSent: { type: Date },
  profileLastUpdated: { type: Date },
  fcmToken: {
    type: String,
    default: null,
  },
  token: {
    type: String,
    default: null,
  },

  // Subscription reference
  isSubscribed: { type: Boolean, default: false },
  subscriptionID: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true }
});



const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;