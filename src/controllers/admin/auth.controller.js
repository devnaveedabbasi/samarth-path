import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import { signToken } from '../../utils/jwt.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

const SALT_ROUNDS = 10;

function publicUserDoc(user) {
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.password;
  delete u.phoneOTP;
  delete u.emailOTP;
  delete u.resetOTP;
  return u;
}

export async function adminRegister(req, res) {
  const secret = req.headers['x-admin-secret'];

  if (!secret || secret !== process.env.ADMIN_REGISTRATION_SECRET) {
    throw new ApiError(403, 'Unauthorized to register admin.');
  }

  // Only one admin is allowed
  const existingAdmin = await User.findOne({ role: 'admin' }).select('_id');

  if (existingAdmin) {
    throw new ApiError(409, 'Admin already exists.');
  }

  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name || !phone || !email || !password) {
    throw new ApiError(
      400,
      'Name, phone, email, and password are required.'
    );
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
    throw new ApiError(409, 'Phone number already registered.');
  }

  const existingEmail = await User.findOne({ email }).select('_id');

  if (existingEmail) {
    throw new ApiError(409, 'Email already registered.');
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await User.create({
    name,
    phone,
    email,
    password: hashedPassword,
    role: 'admin',
    status: 'approved',
    isPhoneVerified: true,
    isEmailVerified: true,
  });

  const token = signToken(user._id, user.role);

  res.status(201).json(
    new ApiResponse(
      201,
      {
        token,
        user: publicUserDoc(user),
      },
      'Admin account created successfully.'
    )
  );
}

export async function adminLogin(req, res) {
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');

  if (!email || !password) {
    throw new ApiError(400, 'email number and password are required.');
  }

  const user = await User.findOne({ email, role: 'admin' }).select('+password');

  if (!user) {
    throw new ApiError(401, 'Invalid email number or password.');
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new ApiError(401, 'Invalid email number or password.');
  }

  const allowedStatuses = ['approved'];
  if (!allowedStatuses.includes(user.status)) {
    throw new ApiError(403, `Account not authorized. Current status: ${user.status}`);
  }

  const token = signToken(user._id, user.role);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: publicUserDoc(user),
      },
      'Admin login successful.'
    )
  );
}

export async function adminLogout(req, res) {
  const userId = req.user._id;
  await User.findByIdAndUpdate(userId, { token: null });

  res.status(200).json(
    new ApiResponse(200, {}, 'Logged out successfully.')
  );
} 