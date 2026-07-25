import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import Subscription from '../../models/Subscription.model.js';
import { sendOtpSms } from '../../utils/smsService.js';
import { sendOtpEmail } from '../../utils/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { uploadOnS3 } from '../../utils/s3.js';

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
// const OTP_TTL_MS = 1 * 60 * 1000; // 1 minute
const TRIAL_DAYS = 5 / (24 * 60); // 5 MINUTES FOR TESTING (was 3 days)
const DAY_MS = 24 * 60 * 60 * 1000;

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const phoneRegex = /^(?:\+92|92|0)?3\d{9}$|^(?:\+91|91|0)?[6-9]\d{9}$/;
function publicUserDoc(user) {
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.password;
  delete u.phoneOTP;
  delete u.emailOTP;
  delete u.resetOTP;
  delete u.tempEmailOTP;
  delete u.tempPhoneOTP;
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
  const address = String(req.body.address || '').trim();
  let phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !phone || !email || !password || !address) {
    console.log('VALIDATION FAILED:', { name, phone, email, password, address });
    throw new ApiError(400, 'Name, phone, email, address, and password are required.');
  }
  console.log('VALIDATION PASSED, creating user...');
  if (!isValidIndianPhone(phone)) {
    throw new ApiError(400, 'Invalid phone number format. Must be a valid Indian mobile number.');
  }


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


  console.log('otp>>>>>>>', otp, address)
  await sendOtpSms(phone, otp);
  const user = await User.create({
    name,
    phone,
    email,
    address,
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

  // Create a pending subscription (requires ₹5 payment to activate trial)
  const now = new Date();
  const subscription = await Subscription.create({
    userId: user._id,
    planName: 'Monthly Basic',
    price: 199,
    status: 'pending',
    startDate: now,
  });

  user.subscriptionID = subscription._id;
  user.isSubscribed = false;   // User is NOT subscribed until they pay ₹5
  user.isTrial = false;        // User is NOT on trial yet
  await user.save();


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
  console.log("Verifying phone:", phone, "with OTP:", otp);
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
  user.token = token;
  await user.save();
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

  // Auto-expire trial if trialEndDate passed
  if (subscription.status === 'trial' && subscription.trialEndDate && subscription.trialEndDate < now) {
    subscription.status = 'expired';
    await subscription.save();
    user.isSubscribed = false;
    await user.save();
  }

  // Auto-expire paid subscription if expiryDate passed
  if (subscription.status === 'active' && subscription.expiryDate && subscription.expiryDate < now) {
    subscription.status = 'expired';
    await subscription.save();
    user.isSubscribed = false;
    await user.save();
  }

  // Sync user subscription state
  user.subscriptionID = subscription._id;
  if (subscription.status === 'active') {
    user.isSubscribed = true;
    user.isTrial = false;
  } else if (subscription.status === 'trial' && user.isTrial) {
    // Only paid trial (₹5 paid) gets app access
    user.isSubscribed = true;
  } else {
    user.isSubscribed = false;
  }
  await user.save();

  // NOTE: We do NOT block login for expired users.
  // The app should check subscriptionStatus and redirect to subscription screen if expired.
  // Content access is blocked by checkSubscription middleware.

  const token = signToken(user._id, user.role);
  user.token = token;
  await user.save();
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
          trialEndDate: subscription.trialEndDate || null,
          expiryDate: subscription.expiryDate || null,
          planName: subscription.planName || null,
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
  const { name, gender, dateOfBirth, address, email, phone } = req.body

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  const updatedFields = {};

  if (typeof name === 'string' && name.trim() && name.trim() !== user.name) {
    user.name = String(name).trim();
    updatedFields.name = user.name;
  }

  if (typeof address === 'string' && address.trim() && address.trim() !== user.address) {
    user.address = String(address).trim();          // ✅ user.address
    updatedFields.address = user.address;           // ✅ 
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
    const today = new Date();

    let age = today.getFullYear() - dob.getFullYear();

    const monthDiff = today.getMonth() - dob.getMonth();

    if (isNaN(dob.getTime())) {
      throw new ApiError(400, 'Invalid dateOfBirth value.');
    }

    if (dob > new Date()) {
      throw new ApiError(400, 'dateOfBirth cannot be in the future.');
    }
    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < dob.getDate())
    ) {
      age--;
    }

    if (age < 18) {
      throw new ApiError(400, 'You must be at least 18 years old.');
    }

    if (dob.getFullYear() < 1900) {
      throw new ApiError(400, 'dateOfBirth year must be 1900 or later.');
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
      const uploadRes = await uploadOnS3({
        localFilePath: localPath,
        mimetype: req.file.mimetype,
        originalname: req.file.originalname,
      });

      if (uploadRes && uploadRes.secure_url) {
        user.profilePicture = uploadRes.secure_url;
        updatedFields.profilePicture = user.profilePicture;
      }
    }
  }

  if (typeof email === 'string' && email.trim().toLowerCase() !== (user.email || '').toLowerCase()) {
    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      throw new ApiError(400, 'Invalid email format.');
    }
    const existingEmail = await User.findOne({ email: cleanEmail, _id: { $ne: userId } });
    if (existingEmail) {
      throw new ApiError(400, 'Email is already registered by another user.');
    }
    const otp = generateNumericOtp(6);
    user.tempEmail = cleanEmail;
    user.tempEmailOTP = otp;
    user.tempEmailOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
    user.tempEmailOtpAttempts = 0;
    
    await sendOtpEmail(cleanEmail, otp);
    updatedFields.emailVerificationPending = true;
  }

  if (phone) {
    const cleanPhone = String(phone).trim();
    if (cleanPhone !== user.phone) {
      if (!isValidIndianPhone(cleanPhone)) {
        throw new ApiError(400, 'Invalid phone number format. Must be a valid Indian mobile number.');
      }
      const existingPhone = await User.findOne({ phone: cleanPhone, _id: { $ne: userId } });
      if (existingPhone) {
        throw new ApiError(400, 'Phone number is already registered by another user.');
      }
      const otp = generateNumericOtp(6);
      user.tempPhone = cleanPhone;
      user.tempPhoneOTP = otp;
      user.tempPhoneOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
      user.tempPhoneOtpAttempts = 0;

      await sendOtpSms(cleanPhone, otp);
      updatedFields.phoneVerificationPending = true;
    }
  }

  if (Object.keys(updatedFields).length === 0) {
    throw new ApiError(400, 'No fields were updated.');
  }

  await user.save();

  res.status(200).json(
    new ApiResponse(200, updatedFields, 'Profile update initiated.')
  );
}

export async function verifyEmailUpdate(req, res) {
  const userId = req.user._id;
  const otp = String(req.body.otp || '').trim();

  if (!otp) {
    throw new ApiError(400, 'OTP is required.');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.tempEmail) {
    throw new ApiError(400, 'No email update request found.');
  }

  if (user.tempEmailOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many failed attempts. Please update profile again to request a new OTP.');
  }

  if (!user.tempEmailOTP || !user.tempEmailOtpExpiry || user.tempEmailOtpExpiry < new Date()) {
    user.tempEmailOtpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid. Please update profile again.');
  }

  if (user.tempEmailOTP !== otp) {
    user.tempEmailOtpAttempts += 1;
    await user.save();
    throw new ApiError(401, 'Invalid OTP.');
  }

  const existingEmail = await User.findOne({ email: user.tempEmail, _id: { $ne: userId } });
  if (existingEmail) {
    throw new ApiError(400, 'Email already registered by another user.');
  }

  user.email = user.tempEmail;
  user.isEmailVerified = true;

  user.tempEmail = undefined;
  user.tempEmailOTP = undefined;
  user.tempEmailOtpExpiry = undefined;
  user.tempEmailOtpAttempts = 0;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, { email: user.email }, 'Email updated successfully.')
  );
}

export async function verifyPhoneUpdate(req, res) {
  const userId = req.user._id;
  const otp = String(req.body.otp || '').trim();

  if (!otp) {
    throw new ApiError(400, 'OTP is required.');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.tempPhone) {
    throw new ApiError(400, 'No phone update request found.');
  }

  if (user.tempPhoneOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many failed attempts. Please update profile again to request a new OTP.');
  }

  if (!user.tempPhoneOTP || !user.tempPhoneOtpExpiry || user.tempPhoneOtpExpiry < new Date()) {
    user.tempPhoneOtpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid. Please update profile again.');
  }

  if (user.tempPhoneOTP !== otp) {
    user.tempPhoneOtpAttempts += 1;
    await user.save();
    throw new ApiError(401, 'Invalid OTP.');
  }

  const existingPhone = await User.findOne({ phone: user.tempPhone, _id: { $ne: userId } });
  if (existingPhone) {
    throw new ApiError(400, 'Phone number already registered by another user.');
  }

  user.phone = user.tempPhone;
  user.isPhoneVerified = true;

  user.tempPhone = undefined;
  user.tempPhoneOTP = undefined;
  user.tempPhoneOtpExpiry = undefined;
  user.tempPhoneOtpAttempts = 0;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, { phone: user.phone }, 'Phone number updated successfully.')
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
  const now = new Date();

  // Auto-expire trial
  if (subscription?.status === 'trial' && subscription?.trialEndDate && subscription.trialEndDate < now) {
    subscription.status = 'expired';
    await subscription.save();
    user.isSubscribed = false;
    user.isTrial = false;
    await user.save();
  }

  // Auto-expire active subscription
  if (subscription?.status === 'active' && subscription?.expiryDate && subscription.expiryDate < now) {
    subscription.status = 'expired';
    await subscription.save();
    user.isSubscribed = false;
    await user.save();
  }

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
        address: user.address,
        isSubscribed: user.isSubscribed,
        isTrial: user.isTrial,
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


export async function updateNotificationSettings(req, res) {
  try {
    const userId = req.user._id;
    const { type, value } = req.body;

    if (!['text', 'video', 'quiz'].includes(type)) {
      throw new ApiError(400, 'Invalid notification type.');
    }

    if (typeof value !== 'boolean') {
      throw new ApiError(400, 'Value must be boolean.');
    }

    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(404, 'User not found.');
    }

    // ensure object exists
    if (!user.notificationSettings) {
      user.notificationSettings = {
        text: true,
        video: true,
        quiz: true,
      };
    }

    user.notificationSettings[type] = value;
    user.markModified('notificationSettings'); // ✅ Bas yahan add karo
    await user.save();

    return res.status(200).json(
      new ApiResponse(
        200,
        user.notificationSettings,
        'Notification settings updated successfully.'
      )
    );

  } catch (error) {
    console.error('NOTIFICATION SETTINGS ERROR:', error);
    throw new ApiError(500, error.message || 'Failed to update settings');
  }
}

export async function getNotificationSettings(req, res) {
  const user = await User.findById(req.user._id);

  return res.status(200).json(
    new ApiResponse(200, user.notificationSettings)
  );
}