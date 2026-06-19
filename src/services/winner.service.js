import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import User from '../models/User.model.js';
import Notification from '../models/Notification.model.js';
import NotificationService from './notification.service.js';
import sendNotification from '../utils/sendNotification.js';
import { ApiError } from '../utils/errorHandler.js';

export class WinnerService {

  // ─── Week Info ───────────────────────────────────────────────
  static getWeekInfo(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { weekNumber, year: date.getFullYear() };
  }

  // ─── Top Winners Calculate ───────────────────────────────────
  static async getWeeklyWinners(weekNumber, year, limit = 3) {
    try {
      const attempts = await QuizAttempt.find({
        weekNumber,
        year,
        isCorrect: true
      })
        .populate('userId', 'name email profilePicture')
        .sort({ createdAt: 1 })
        .lean();

      if (!attempts.length) return [];

      const userScores = {};

      for (const attempt of attempts) {
        if (!attempt.userId) continue;
        const userId = attempt.userId._id.toString();

        if (!userScores[userId]) {
          userScores[userId] = {
            userId: attempt.userId._id,
            userName: attempt.userId.name,
            userEmail: attempt.userId.email,
            profilePicture: attempt.userId.profilePicture,
            score: 0,
            firstAttemptTime: attempt.createdAt
          };
        }
        userScores[userId].score += 1;
      }

      let winners = Object.values(userScores)
        .sort((a, b) => {
          if (a.score !== b.score) return b.score - a.score;
          return new Date(a.firstAttemptTime) - new Date(b.firstAttemptTime);
        })
        .slice(0, limit)
        .map((winner, index) => ({ ...winner, rank: index + 1 }));

      return winners;
    } catch (error) {
      throw new ApiError(500, 'Failed to fetch weekly winners', error.message);
    }
  }

  // ─── Current + Last Week Winners ────────────────────────────
  static async getWinners() {
    try {
      const now = new Date();
      const currentWeek = this.getWeekInfo(now);

      const lastWeekDate = new Date(now);
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lastWeek = this.getWeekInfo(lastWeekDate);

      const currentWeekAttempts = await QuizAttempt.aggregate([
        { $match: { weekNumber: currentWeek.weekNumber, year: currentWeek.year, isCorrect: true } },
        { $group: { _id: '$userId', score: { $sum: 1 }, firstAttemptTime: { $min: '$createdAt' } } },
        { $sort: { score: -1, firstAttemptTime: 1 } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id', userName: '$user.name',
            profilePicture: '$user.profilePicture',
            score: 1, firstAttemptTime: 1, _id: 0
          }
        }
      ]);

      const currentWeekAllUsers = currentWeekAttempts.map((user, index) => ({
        ...user, rank: index + 1, isTopThree: index < 3
      }));

      const [lastWeekAnnounced, lastWeekAttempts] = await Promise.all([
        Winner.find({ weekNumber: lastWeek.weekNumber, year: lastWeek.year, cycleType: 'weekly' })
          .populate('userId', 'name profilePicture')
          .sort({ rank: 1 })
          .lean(),

        QuizAttempt.aggregate([
          { $match: { weekNumber: lastWeek.weekNumber, year: lastWeek.year, isCorrect: true } },
          { $group: { _id: '$userId', score: { $sum: 1 }, firstAttemptTime: { $min: '$createdAt' } } },
          { $sort: { score: -1, firstAttemptTime: 1 } },
          { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
          { $unwind: '$user' },
          {
            $project: {
              userId: '$_id', userName: '$user.name',
              profilePicture: '$user.profilePicture',
              score: 1, firstAttemptTime: 1, _id: 0
            }
          }
        ])
      ]);

      const lastWeekAllUsers = lastWeekAttempts.map((user, index) => ({
        ...user, rank: index + 1, isTopThree: index < 3
      }));

      // Winner collection se official top3
      const lastWeekTop3Announced = lastWeekAnnounced.map(w => ({
        rank: w.rank,
        score: w.score,
        userId: w.userId?._id,
        userName: w.userId?.name,
        profilePicture: w.userId?.profilePicture,
        isTopThree: true
      }));

      // ✅ Fallback: agar Winner collection empty hai toh QuizAttempt data use karo
      const lastWeekTop3 = lastWeekTop3Announced.length > 0
        ? lastWeekTop3Announced
        : lastWeekAllUsers.slice(0, 3).map(u => ({ ...u, isTopThree: true }));

      return {
        currentWeek: {
          week: currentWeek.weekNumber, year: currentWeek.year,
          isLive: true,
          note: 'Updates as users attempt quizzes. Final winners announced Sunday.',
          totalParticipants: currentWeekAllUsers.length,
          top3: currentWeekAllUsers.slice(0, 3),
          allParticipants: currentWeekAllUsers
        },
        lastWeek: {
          week: lastWeek.weekNumber, year: lastWeek.year,
          isLive: false,
          totalParticipants: lastWeekAllUsers.length,
          top3: lastWeekTop3,
          allParticipants: lastWeekAllUsers
        }
      };
    } catch (error) {
      throw error;
    }
  }

  // ─── Announce Weekly Winners (Cron) ─────────────────────────
//   static async announceWeeklyWinners() {
//     try {
//       console.log('[WINNER] Starting Weekly Winner Announcement...');

//       const now = new Date();
//       const lastWeekDate = new Date(now);
//       lastWeekDate.setDate(lastWeekDate.getDate() - 1); // Saturday
//       const lastWeek = this.getWeekInfo(lastWeekDate);
//       const winners = await this.getWeeklyWinners(lastWeek.weekNumber, lastWeek.year, 3);

//       if (!winners.length) {
//         console.log(`[WINNER] No winners for week ${lastWeek.weekNumber}`);
//         return { success: true, message: 'No winners found', count: 0 };
//       }

//       // 1. DB mein save karo
//       const winnerRecords = [];
//       for (const winner of winners) {
//         const exists = await Winner.findOne({
//           userId: winner.userId,
//           weekNumber: lastWeek.weekNumber,
//           year: lastWeek.year,
//           cycleType: 'weekly'
//         });
//         if (!exists) {
//           winnerRecords.push({
//             userId: winner.userId,
//             rank: winner.rank,
//             score: winner.score,
//             weekNumber: lastWeek.weekNumber,
//             year: lastWeek.year,
//             cycleType: 'weekly'
//           });
//         }
//       }

//       if (winnerRecords.length > 0) {
//         await Winner.insertMany(winnerRecords);
//         console.log(`[WINNER] ${winnerRecords.length} winners saved to DB`);
//       }

//       // 2. Saare users ko announcement notification
//       const rank1Winner = winners.find(w => w.rank === 1);

//       const allUsers = await User.find({
//         isDeleted: { $ne: true },
//         status: 'approved'
//       }).select('_id fcmToken').lean();

//       const announcementTitle = '🏆 Weekly Winners Announced!';
//       const announcementBody = rank1Winner
//         ? `${rank1Winner.userName} achieved Rank 1 in Week ${lastWeek.weekNumber} with ${rank1Winner.score} correct answers!`
//         : `Week ${lastWeek.weekNumber} winners have been announced! Check the app for details.`;

//       // Bulk DB notifications
//       const bulkNotifications = allUsers.map(user => ({
//         userId: user._id,
//         type: 'winner_announcement',
//         title: announcementTitle,
//         body: announcementBody,
//         status: 'info',
//         data: {
//           weekNumber: lastWeek.weekNumber,
//           year: lastWeek.year,
//           rank1Name: rank1Winner?.userName || null
//         },
//         relatedEntityType: 'none'
//       }));

//       await Notification.insertMany(bulkNotifications);
//       console.log(`[WINNER] DB notifications created for ${allUsers.length} users`);

//       // FCM push notifications
// const fcmTokens = allUsers.map(u => u.fcmToken).filter(Boolean);
// for (const user of allUsers) {
//   if (!user.fcmToken) continue;
//   try {
//     await sendNotification({
//       token: user.fcmToken,
//       title: announcementTitle,
//       body: announcementBody,
//       data: Object.fromEntries(
//         Object.entries({ type: 'winner_announcement' }).map(([k, v]) => [k, String(v)])
//       )
//     });
//   } catch (err) {
//     if (err.errorInfo?.code === 'messaging/registration-token-not-registered') {
//       await User.findByIdAndUpdate(user._id, { $unset: { fcmToken: 1 } });
//       console.log(`[FCM] Removed invalid token for user: ${user._id}`);
//     } else {
//       console.error(`[FCM] Failed for token ${user.fcmToken}:`, err.message);
//     }
//   }
// }

// console.log(`[WINNER] Push sent to ${fcmTokens.length} devices`);

//       console.log(`[WINNER] Push sent to ${fcmTokens.length} devices`);

//       // 3. Top 3 ko personal notification + email
//       for (const winner of winners) {
//         try {
//           await NotificationService.sendWeeklyWinnerNotification(
//             winner.userId,
//             winner.rank,
//             winner.score,
//             lastWeek.weekNumber,
//             lastWeek.year
//           );
//           console.log(`[WINNER]  Rank ${winner.rank} notified: ${winner.userName}`);
//         } catch (error) {
//           console.error(`[WINNER]  Failed rank ${winner.rank} (${winner.userId}):`, error.message);
//         }
//       }

//       console.log(`[WINNER]  Done. ${winners.length} winners announced for week ${lastWeek.weekNumber}`);
//       return {
//         success: true,
//         message: 'Winners announced successfully',
//         count: winners.length,
//         week: lastWeek.weekNumber,
//         year: lastWeek.year
//       };
//     } catch (error) {
//       console.error('[WINNER] announceWeeklyWinners error:', error);
//       throw new ApiError(500, 'Failed to announce weekly winners', error.message);
//     }
//   }


}

export default WinnerService;