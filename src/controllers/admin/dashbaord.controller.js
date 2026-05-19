import User from '../../models/User.model.js';
import Content from '../../models/Content.model.js';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import Winner from '../../models/Winner.model.js';
import Subscription from '../../models/Subscription.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

export const getAdminDashboard = async (req, res) => {
  try {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // ─── All queries run in parallel ────────────────────────────
    const [
      totalUsers,
      totalContent,
      totalQuizAttempts,
      totalWinners,
      revenueStats,
      contentTypeStats,
      topWinners,
      topSubscribers,
    ] = await Promise.all([

      // 1. Total approved users
      User.countDocuments({ role: 'user', isDeleted: { $ne: true } }),

      // 2. Total active content
      Content.countDocuments({ isDeleted: false, isActive: true }),

      // 3. Total quiz attempts
      QuizAttempt.countDocuments(),

      // 4. Total winner documents
      Winner.countDocuments(),

      // 5. Monthly revenue for last 12 months
      Subscription.aggregate([
        {
          $match: {
            status: { $in: ['active', 'trial'] },
            startDate: { $gte: twelveMonthsAgo },
          },
        },
        {
          $group: {
            _id: {
              year: { $year: '$startDate' },
              month: { $month: '$startDate' },
            },
            revenue: { $sum: '$price' },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),

      // 6. Content breakdown by type
      Content.aggregate([
        { $match: { isDeleted: false, isActive: true } },
        {
          $group: {
            _id: '$contentType',
            count: { $sum: 1 },
          },
        },
      ]),

      // 7. Top 3 winners (most recent week, highest score)
      Winner.aggregate([
        { $sort: { year: -1, weekNumber: -1, rank: 1 } },
        {
          $group: {
            _id: { year: '$year', weekNumber: '$weekNumber', cycleType: '$cycleType' },
            winners: { $push: '$$ROOT' },
            weekNumber: { $first: '$weekNumber' },
            year: { $first: '$year' },
          },
        },
        { $sort: { year: -1, weekNumber: -1 } },
        { $limit: 1 },
        { $unwind: '$winners' },
        { $match: { 'winners.rank': { $in: [1, 2, 3] } } },
        { $replaceRoot: { newRoot: '$winners' } },
        { $sort: { rank: 1 } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            rank: 1,
            score: 1,
            weekNumber: 1,
            year: 1,
            cycleType: 1,
            userId: 1,
            userName: '$user.name',
            profilePicture: '$user.profilePicture',
          },
        },
      ]),

      // 8. Top 3 subscribers by most recent subscription start
      Subscription.aggregate([
        { $match: { status: { $in: ['active', 'trial'] } } },
        { $sort: { startDate: -1 } },
        { $limit: 3 },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            planName: 1,
            price: 1,
            status: 1,
            startDate: 1,
            expiryDate: 1,
            paymentMethod: 1,
            userId: 1,
            userName: '$user.name',
            profilePicture: '$user.profilePicture',
            userEmail: '$user.email',
          },
        },
      ]),
    ]);

    // ─── Format monthly revenue ──────────────────────────────────
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Build a full 12-month map (fill gaps with 0)
    const revenueMap = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      revenueMap[key] = {
        month: monthNames[d.getMonth()],
        year: d.getFullYear(),
        revenue: 0,
      };
    }
    revenueStats.forEach(({ _id, revenue }) => {
      const key = `${_id.year}-${_id.month}`;
      if (revenueMap[key]) {
        revenueMap[key].revenue = revenue;
      }
    });
    const monthlyRevenue = Object.values(revenueMap);
    const totalRevenue = monthlyRevenue.reduce((sum, m) => sum + m.revenue, 0);

    // ─── Format content type stats ───────────────────────────────
    const contentBreakdown = { text: 0, quiz: 0, video: 0 };
    contentTypeStats.forEach(({ _id, count }) => {
      if (_id in contentBreakdown) contentBreakdown[_id] = count;
    });

    // ─── Build response ──────────────────────────────────────────
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          summary: {
            totalUsers,
            totalContent,
            totalQuizAttempts,
            totalWinners,
            totalRevenue,
          },
          revenueStats: {
            monthly: monthlyRevenue,
            total: totalRevenue,
          },
          contentStats: {
            breakdown: contentBreakdown,
          },
          topWinners,
          topSubscribers,
        },
        'Admin dashboard data fetched successfully.'
      )
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch admin dashboard data', error.message);
  }
};
