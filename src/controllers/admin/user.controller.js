import bcrypt from "bcryptjs";
import User from "../../models/User.model.js";
import Subscription from "../../models/Subscription.model.js";
import NotificationService from "../../services/notification.service.js";
import { ApiResponse } from "../../utils/apiResponse.js";
import { ApiError } from "../../utils/errorHandler.js";
import { isValidIndianPhone } from "../user/auth.controller.js";
import { uploadOnS3 } from '../../utils/s3.js';

const SALT_ROUNDS = 10;
const TRIAL_DAYS = 3; // 3-day trial
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PLAN_NAME = "Monthly Basic";
const DEFAULT_PLAN_PRICE = 199;
const DEFAULT_DURATION_DAYS = 30;

// ── GET /users  (with pagination, search, status filter) ──────────────────────
export async function AllUsers(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 10);
  const skip = (page - 1) * limit;
  const search = (req.query.search || "").trim();
  const status = (req.query.status || "").trim();
  const isSubscribedRaw = req.query.isSubscribed;

  // Build filter
  const filter = { role: "user" };
  if (status) filter.status = status;
  if (isSubscribedRaw === "true" || isSubscribedRaw === "false") {
    filter.isSubscribed = isSubscribedRaw === "true";
  }
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .populate("subscriptionID")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        users,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: total,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      "Users retrieved successfully."
    )
  );
}

// ── GET /users/stats ──────────────────────────────────────────────────────────
export async function getUserStats(req, res) {
  const [total, blocked, suspended, subscribed, pending, approved, trial] =
    await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "user", status: "blocked" }),
      User.countDocuments({ role: "user", status: "suspended" }),
      User.countDocuments({ role: "user", isSubscribed: true }),
      User.countDocuments({ role: "user", status: "pending" }),
      User.countDocuments({ role: "user", status: "approved" }),
      User.countDocuments({ role: "user", isTrial: true }),
    ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        cards: {
          totalUsers: total,
          blockedUsers: blocked,
          suspendedUsers: suspended,
          subscribedUsers: subscribed,
          trialUsers: trial,
          pendingUsers: pending,
          approvedUsers: approved,
        },
      },
      "Stats retrieved successfully."
    )
  );
}

// ── GET /users/:userId ────────────────────────────────────────────────────────
export async function getUserById(req, res) {
  const { userId } = req.params;
  const user = await User.findById(userId).populate("subscriptionID");

  if (!user) throw new ApiError(404, "User not found.");

  res.status(200).json(
    new ApiResponse(200, user, "User retrieved successfully.")
  );
}

// ── PUT /users/:userId/status  (status in req.body) ──────────────────────────
export async function updateUserStatus(req, res) {
  const { userId } = req.params;
  const { status } = req.body;

  const ALLOWED = ["pending", "approved", "blocked", "suspended"];
  if (!status || !ALLOWED.includes(status)) {
    throw new ApiError(400, `Invalid status. Allowed: ${ALLOWED.join(", ")}`);
  }

  const user = await User.findOne({ _id: userId, role: "user" });
  if (!user) throw new ApiError(404, "User not found.");

  user.status = status;
  await user.save();

  // Fire-and-forget notification — don't fail the whole request if this errors
  try {
    await NotificationService.sendStatusChangeNotification(userId, status);
  } catch (err) {
    console.error("Notification failed:", err?.message);
  }

  res.status(200).json(
    new ApiResponse(200, user, "User status updated successfully.")
  );
}

// ── DELETE /users/:userId ─────────────────────────────────────────────────────
export async function deleteUser(req, res) {
  const { userId } = req.params;
  const user = await User.findOneAndDelete({ _id: userId, role: "user" });
  if (!user) throw new ApiError(404, "User not found.");

  res.status(200).json(
    new ApiResponse(200, null, "User deleted successfully.")
  );
}

// ── POST /users  (admin creates a user directly, bypassing OTP) ──────────────
export async function createUser(req, res) {
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const phone = String(req.body.phone || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const role = ["user", "admin"].includes(req.body.role) ? req.body.role : "user";

  if (role === "admin") {
    const adminExists = await User.findOne({ role: "admin" }).select("_id");
    if (adminExists) {
      throw new ApiError(409, "Admin already exists.");
    }
  }

  if (!name || !phone || !email || !password) {
    throw new ApiError(400, "Name, phone, email, and password are required.");
  }

  if (!isValidIndianPhone(phone)) {
    throw new ApiError(400, "Invalid phone number format. Must be a valid Indian mobile number.");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ApiError(400, "Invalid email format.");
  }

  if (password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters.");
  }

  const existingPhone = await User.findOne({ phone }).select("_id");
  if (existingPhone) {
    throw new ApiError(408, "Phone number already registered.");
  }

  const existingEmail = await User.findOne({ email }).select("_id");
  if (existingEmail) {
    throw new ApiError(408, "Email already registered.");
  }

  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  // Admin-created users are pre-verified/approved — they don't go through the OTP flow.
  const user = await User.create({
    name,
    phone,
    email,
    address: address || undefined,
    password: hashedPassword,
    role,
    status: "approved",
    isPhoneVerified: true,
    isEmailVerified: true,
  });

  // Same trial subscription every normal registration receives, so the user
  // is stored exactly like one created through public registration.
  const now = new Date();
  const trialEndDate = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  const subscription = await Subscription.create({
    userId: user._id,
    planName: "Trial",
    price: 0,
    status: "trial",
    startDate: now,
    expiryDate: trialEndDate,
    trialStartDate: now,
    trialEndDate,
  });

  user.subscriptionID = subscription._id;
  user.isSubscribed = false;
  await user.save();

  const created = await User.findById(user._id).populate("subscriptionID");

  res.status(201).json(
    new ApiResponse(201, created, "User created successfully.")
  );
}

// ── POST /users/:userId/grant-subscription  (admin activates a subscription, no payment) ──
export async function grantSubscription(req, res) {
  const { userId } = req.params;
  const { planName, price, durationDays, startDate, expiryDate, notes } = req.body;

  const user = await User.findOne({ _id: userId, role: "user" });
  if (!user) throw new ApiError(404, "User not found.");

  const start = startDate ? new Date(startDate) : new Date();
  if (isNaN(start.getTime())) {
    throw new ApiError(400, "Invalid start date.");
  }

  let expiry;
  if (expiryDate) {
    expiry = new Date(expiryDate);
    if (isNaN(expiry.getTime())) {
      throw new ApiError(400, "Invalid expiry date.");
    }
  } else {
    const days = Number(durationDays) > 0 ? Number(durationDays) : DEFAULT_DURATION_DAYS;
    expiry = new Date(start.getTime() + days * DAY_MS);
  }

  if (expiry <= start) {
    throw new ApiError(400, "Expiry date must be after start date.");
  }

  let subscription = await Subscription.findOne({ userId });
  if (!subscription) {
    subscription = new Subscription({ userId, expiryDate: expiry });
  }

  subscription.planName = String(planName || "").trim() || subscription.planName || DEFAULT_PLAN_NAME;
  subscription.price = price !== undefined && price !== null && price !== "" ? Number(price) : (subscription.price ?? DEFAULT_PLAN_PRICE);
  subscription.status = "active";
  subscription.startDate = start;
  subscription.expiryDate = expiry;
  subscription.paymentStatus = "not_applicable";
  subscription.grantedByAdmin = true;
  subscription.grantedBy = req.user._id;
  subscription.adminNotes = notes ? String(notes).trim() : subscription.adminNotes;

  await subscription.save();

  user.subscriptionID = subscription._id;
  user.isSubscribed = true;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, subscription, "Subscription granted successfully.")
  );
}