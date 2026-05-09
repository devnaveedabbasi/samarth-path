import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import Subscription from '../../models/Subscription.model.js';
import { sendOtpSms } from '../../utils/smsService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { uploadOnS3 } from '../../utils/s3.js';

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
// const OTP_TTL_MS = 1 * 60 * 1000; // 1 minute

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const phoneRegex = /^(?:\+92|92|0)?3\d{9}$|^(?:\+91|91|0)?[6-9]\d{9}$/;
function publicUserDoc(user) {
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.password;
  delete u.phoneOTP;
  delete u.emailOTP;
  delete u.resetOTP;
  return u;
}

async function setPhoneOtp(user, otpPlain) {
  user.phoneOTP = otpPlain;
  user.otpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.lastOTPSent = new Date();
  user.otpAttempts = 0;
  await user.save();
}
function normalizePhone(phone) {
  return phone.replace(/^\+91|^91|^0/, "");
}
export function isValidIndianPhone(phone) {
  const cleaned = normalizePhone(phone);
  return /^(?:91|0)?[6-9]\d{9}$/.test(cleaned);
}
export async function register(req, res) {
  const name = String(req.body.name || '').trim();
  let phone = String(req.body.phone || '').trim(); 
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !phone || !email || !password) {
    throw new ApiError(400, 'Name, phone, email, and password are required.');
  }
  if (!isValidIndianPhone(phone)) {
    throw new ApiError(400, 'Invalid phone number format. Must be a valid Indian mobile number.');
  }

  phone = normalizePhone(phone); // ✅ now works fine
  console.log("Normalized phone:", phone);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(400, 'Invalid email format.');
  }

  if (password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  const existingPhone = await User.findOne({ phone }).select('_id');
  if (existingPhone) {
    throw new ApiError(408, 'Phone number already registered.');
  }

  const existingEmail = await User.findOne({ email }).select('_id');
  if (existingEmail) {
    throw new ApiError(408, 'Email already registered.');
  }

  
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const otp = generateNumericOtp(6);

  const user = await User.create({
    name,
    phone,
    email,
    password: hashedPassword,
    role: 'user',
    status: 'pending',
    isPhoneVerified: false,
    isEmailVerified: false, // Assuming we add email verification later if needed
    phoneOTP: otp,
    otpExpiry: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0,
    lastOTPSent: new Date(),
  });

  // Create trial subscription
  const subscription = await Subscription.create({
    userId: user._id,
    status: 'trial',
    expiryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });

  user.subscriptionID = subscription._id;
  await user.save();

  // await sendOtpSms(phone, otp);

  res.status(201).json(
    new ApiResponse(
      201,
      {
        userId: user._id,
        phone: user.phone,
        email: user.email,
        expiresInMinutes: Math.round(OTP_TTL_MS / 60000),
      },
      'Account created. Enter the OTP sent to your phone to verify.'
    )
  );
}

export async function verifyPhone(req, res) {
  const phone = String(req.body.phone || '').trim();
  const otp = String(req.body.otp || '').trim();

  if (!phone || !otp) {
    throw new ApiError(400, 'Phone number and OTP are required.');
  }

  const user = await User.findOne({ phone, role: 'user' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (user.isPhoneVerified) {
    throw new ApiError(407, 'Phone is already verified.');
  }

  if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many failed attempts. Request a new OTP.');
  }

  if (!user.phoneOTP || !user.otpExpiry || user.otpExpiry < new Date()) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid. Request a new OTP.');
  }

  if (user.phoneOTP !== otp) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(401, 'Invalid OTP.');
  }

  user.isPhoneVerified = true;
  user.phoneOTP = undefined;
  user.otpExpiry = undefined;
  user.otpAttempts = 0;
  user.status = 'approved';
  await user.save();

  const token = signToken(user._id, user.role);

  const fresh = await User.findById(user._id);
  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: publicUserDoc(fresh),
      },
      'Phone verified successfully.'
    )
  );
}

export async function resendOtp(req, res) {
  const phone = String(req.body.phone || '').trim();

  if (!phone) {
    throw new ApiError(400, 'Phone number is required.');
  }

  const user = await User.findOne({ phone, role: 'user' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (user.lastOTPSent && Date.now() - user.lastOTPSent.getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - user.lastOTPSent.getTime())) / 1000
    );
    throw new ApiError(429, `Please wait ${waitSec} seconds before requesting another OTP.`);
  }

  const otp = generateNumericOtp(6);
  await setPhoneOtp(user, otp);
  await sendOtpSms(phone, otp);

  res.status(200).json(
    new ApiResponse(
      200,
      { expiresInMinutes: Math.round(OTP_TTL_MS / 60000) },
      'A new OTP has been sent to your phone.'
    )
  );
}

export async function login(req, res) {
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (!phone || !password) {
    throw new ApiError(400, 'Phone number and password are required.');
  }

  const user = await User.findOne({ phone, role: 'user' }).select('+password');

  if (!user) {
    throw new ApiError(401, 'Invalid phone number or password.');
  }

  if (!user.isPhoneVerified) {
    throw new ApiError(403, 'Please verify your phone before logging in.');
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new ApiError(401, 'Invalid phone number or password.');
  }

  const allowedStatuses = ['approved'];
  if (!allowedStatuses.includes(user.status)) {
    throw new ApiError(403, `Account not authorized. Current status: ${user.status}`);
  }

  // Check subscription
  const subscription = await Subscription.findOne({ userId: user._id });
  if (!subscription) {
    throw new ApiError(403, 'Subscription not found. Please contact support.');
  }

  const now = new Date();

  // TODO: Trial expiry handling - currently we allow login but can restrict access to content in other middleware/controllers based on subscription status. If you want to block login itself after trial expires, uncomment the below code and adjust logic as needed.
  // if (subscription.status === 'trial' && subscription.trialEndDate < now) {
  //   subscription.status = 'expired';
  //   await subscription.save();
  //   user.isSubscribed = false;
  //   await user.save();
  //   throw new ApiError(403, 'Trial period expired. Please subscribe to continue.');
  // }
  if (subscription.status === 'active' && subscription.expiryDate < now) {
    subscription.status = 'expired';
    await subscription.save();
    user.isSubscribed = false;
    await user.save();
    throw new ApiError(403, 'Subscription expired. Please renew.');
  }

  // TODO: Depending on your business logic, you might want to allow users with expired subscriptions to log in but restrict access to content. If you want to block login itself for expired subscriptions, uncomment the below code and adjust logic as needed.
  // if (subscription.status !== 'trial' && subscription.status !== 'active') {
  //   throw new ApiError(403, 'Subscription required. Please subscribe.');
  // }

  const token = signToken(user._id, user.role);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          isSubscribed: user.isSubscribed,
          subscriptionStatus: subscription.status,
        },
      },
      'Login successful.'
    )
  );
}

export async function forgotPassword(req, res) {
  const phone = String(req.body.phone || '').trim();

  if (!phone) {
    throw new ApiError(400, 'Phone number is required.');
  }

  const user = await User.findOne({ phone });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const otp = generateNumericOtp(6);

  user.resetOTP = otp;
  user.resetOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.resetOtpAttempts = 0;
  user.lastOTPSent = new Date();

  await user.save();
  await sendOtpSms(phone, otp);

  res.status(200).json(
    new ApiResponse(
      200,
      { expiresInMinutes: Math.round(OTP_TTL_MS / 60000) },
      'Reset OTP sent to your phone.'
    )
  );
}

export async function verifyResetOtp(req, res) {
  const phone = String(req.body.phone || '').trim();
  const otp = String(req.body.otp || '').trim();

  if (!phone || !otp) {
    throw new ApiError(400, 'Phone number and OTP are required.');
  }

  const user = await User.findOne({ phone });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (user.resetOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many attempts. Request new OTP.');
  }

   if (!user.resetOTP || !user.resetOtpExpiry || user.resetOtpExpiry < new Date()) {
    user.resetOtpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid.');
  }

  if (user.resetOTP !== otp) {
    user.resetOtpAttempts += 1;
    await user.save();
    throw new ApiError(400, 'Invalid OTP.');
  }

  user.resetOTP = undefined;
  user.resetOtpExpiry = undefined;
  user.resetOtpAttempts = 0;
  user.resetPasswordVerified = true;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'OTP verified successfully.')
  );
}

export async function setNewPassword(req, res) {
  const phone = String(req.body.phone || '').trim();
  const newPassword = String(req.body.newPassword || '');

  if (!phone || !newPassword) {
    throw new ApiError(400, 'Phone number and new password are required.');
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  const user = await User.findOne({ phone }).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.resetPasswordVerified) {
    throw new ApiError(403, 'Please verify OTP before resetting password.');
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new ApiError(400, 'New password cannot be the same as your current password.');
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

  user.password = hashed;
  user.resetPasswordVerified = false;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'Password reset successfully.')
  );
}

export async function changePassword(req, res) {
  const userId = req.user._id;
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Current and new password are required.');
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, 'New password must be at least 8 characters.');
  }

  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new ApiError(400, 'New password cannot be the same as your current password.');
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

  user.password = hashed;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'Password changed successfully.')
  );
}



export async function updateProfile(req, res) {
  const userId = req.user._id;
  const { name, gender, dateOfBirth } = req.body

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  const updatedFields = {};

  if (typeof name === 'string' && name.trim() && name.trim() !== user.name) {
    user.name = String(name).trim();
    updatedFields.name = user.name;
  }

  if (gender) {
    const allowedGenders = ['male', 'female', 'other'];
    if (!allowedGenders.includes(gender)) {
      throw new ApiError(400, 'Invalid gender value.');
    }
    if (gender !== user.gender) {
      user.gender = gender;
      updatedFields.gender = user.gender;
    }
  }

  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    if (isNaN(dob.getTime())) {
      throw new ApiError(400, 'Invalid dateOfBirth value.');
    }
    const existingDob = user.dateOfBirth ? new Date(user.dateOfBirth) : null;
    if (!existingDob || dob.getTime() !== existingDob.getTime()) {
      user.dateOfBirth = dob;
      updatedFields.dateOfBirth = user.dateOfBirth;
    }
  }

if (req.file) {
  const localPath = req.file.path || req.file.tempFilePath || null;

  if (localPath) {
    const uploadRes = await uploadOnS3(
      localPath,
      req.file.originalname
    );

    if (uploadRes && uploadRes.secure_url) {
      user.profilePicture = uploadRes.secure_url;
      updatedFields.profilePicture = user.profilePicture;
    }
  }
}
  if (Object.keys(updatedFields).length === 0) {
    throw new ApiError(400, 'No fields were updated.');
  }

  await user.save();

  res.status(200).json(
    new ApiResponse(200, updatedFields, 'Profile updated successfully.')
  );
}

export async function logout(req, res) {
  const userId = req.user._id;
  await User.findByIdAndUpdate(userId, { fcmToken: null });

  res.status(200).json(
    new ApiResponse(200, {}, 'Logged out successfully.')
  );
}

export async function me(req, res) {
  const user = await User.findById(req.user._id).populate('subscriptionID');
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const subscription = user.subscriptionID;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        status: user.status,
        profilePicture: user.profilePicture,
        gender: user.gender,
        dateOfBirth: user.dateOfBirth,
        isSubscribed: user.isSubscribed,
        subscription: subscription ? {
          status: subscription.status,
          expiryDate: subscription.expiryDate,
          trialEndDate: subscription.trialEndDate,
          planName: subscription.planName,
          price: subscription.price,
        } : null,
      },
      'User profile retrieved successfully.'
    )
  );
}
