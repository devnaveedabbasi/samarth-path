import User from "../../models/User.model.js";
import NotificationService from "../../services/notification.service.js";
import { ApiResponse } from "../../utils/apiResponse.js";
import { ApiError } from "../../utils/errorHandler.js";

// ── GET /users  (with pagination, search, status filter) ──────────────────────
export async function AllUsers(req, res) {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 10);
  const skip   = (page - 1) * limit;
  const search = (req.query.search || "").trim();
  const status = (req.query.status || "").trim();

  // Build filter
  const filter = { role: "user" };
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name:  { $regex: search, $options: "i" } },
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
          currentPage:  page,
          totalPages,
          totalItems:   total,
          itemsPerPage: limit,
          hasNextPage:  page < totalPages,
          hasPrevPage:  page > 1,
        },
      },
      "Users retrieved successfully."
    )
  );
}

// ── GET /users/stats ──────────────────────────────────────────────────────────
export async function getUserStats(req, res) {
  const [total, blocked, suspended, subscribed, pending, approved] =
    await Promise.all([
      User.countDocuments({ role: "user" }),
      User.countDocuments({ role: "user", status: "blocked" }),
      User.countDocuments({ role: "user", status: "suspended" }),
      User.countDocuments({ role: "user", isSubscribed: true }),
      User.countDocuments({ role: "user", status: "pending" }),
      User.countDocuments({ role: "user", status: "approved" }),
    ]);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        cards: {
          totalUsers:      total,
          blockedUsers:    blocked,
          suspendedUsers:  suspended,
          subscribedUsers: subscribed,
          pendingUsers:    pending,
          approvedUsers:   approved,
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