// services/winner.service.js
import moment from 'moment';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import User from '../models/User.model.js';
import NotificationService from './notification.service.js';
import { ApiError } from '../utils/errorHandler.js';

/**
 * Winner Service - Comprehensive weekly and daily winner management
 */
export class WinnerService {
  /**
   * Calculate current week number
   */
  static getWeekInfo(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { weekNumber, year: date.getFullYear() };
  }

  /**
   * Get top winners for a specific week with enhanced algorithm
   * Tie-breaker: earliest completion time
   */
  static async getWeeklyWinners(weekNumber, year, limit = 3) {
    try {
      // Get all attempts for the week
      const attempts = await QuizAttempt.find({
        weekNumber,
        year,
        isCorrect: true
      })
        .populate('userId', 'name email profilePicture')
        .sort({ createdAt: 1 }) // Earliest first
        .lean();

      if (attempts.length === 0) {
        return [];
      }

      // Group by user and aggregate
      const userScores = {};
      const userFirstAttempt = {}; // Track first attempt time for tie-breaking

      for (const attempt of attempts) {
        const userId = attempt.userId._id.toString();
        if (!userScores[userId]) {
          userScores[userId] = {
            userId: attempt.userId._id,
            userName: attempt.userId.name,
            userEmail: attempt.userId.email,
            profilePicture: attempt.userId.profilePicture,
            score: 0,
            attempts: 0,
            firstAttemptTime: attempt.createdAt
          };
          userFirstAttempt[userId] = attempt.createdAt;
        }
        userScores[userId].score += 1;
        userScores[userId].attempts += 1;
      }

      // Convert to array and sort with tie-breaker
      let winners = Object.values(userScores).sort((a, b) => {
        // Primary: Highest score
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        // Tie-breaker: Earliest completion time
        return new Date(a.firstAttemptTime) - new Date(b.firstAttemptTime);
      });

      // Trim to limit
      winners = winners.slice(0, limit);

      // Add rank
      winners = winners.map((winner, index) => ({
        ...winner,
        rank: index + 1
      }));

      return winners;
    } catch (error) {
      console.error('Error getting weekly winners:', error);
      throw new ApiError(500, 'Failed to fetch weekly winners', error.message);
    }
  }

  /**
   * Get both current and last week winners
   */
  static async getWinners() {
    try {
      const now = new Date();
      const currentWeek = this.getWeekInfo(now);
      
      // Last week
      const lastWeekDate = new Date(now);
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lastWeek = this.getWeekInfo(lastWeekDate);

      const [currentWeekWinners, lastWeekWinners] = await Promise.all([
        this.getWeeklyWinners(currentWeek.weekNumber, currentWeek.year, 3),
        this.getWeeklyWinners(lastWeek.weekNumber, lastWeek.year, 3)
      ]);

      return {
        currentWeek: {
          week: currentWeek.weekNumber,
          year: currentWeek.year,
          winners: currentWeekWinners
        },
        lastWeek: {
          week: lastWeek.weekNumber,
          year: lastWeek.year,
          winners: lastWeekWinners
        }
      };
    } catch (error) {
      console.error('Error in getWinners:', error);
      throw error;
    }
  }

  /**
   * Announce and save weekly winners
   */
  static async announceWeeklyWinners() {
    try {
      console.log('Starting Weekly Winner Announcement Process...');

      // Get last week's winners (since we announce on Sunday for previous week)
      const now = new Date();
      const lastWeekDate = new Date(now);
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lastWeek = this.getWeekInfo(lastWeekDate);

      const winners = await this.getWeeklyWinners(lastWeek.weekNumber, lastWeek.year, 3);

      if (winners.length === 0) {
        console.log(`No winners found for week ${lastWeek.weekNumber}, year ${lastWeek.year}`);
        return { success: true, message: 'No winners found', count: 0 };
      }

      // Save winners to database
      const winnerRecords = [];
      for (const winner of winners) {
        // Check if already exists
        const exists = await Winner.findOne({
          userId: winner.userId,
          weekNumber: lastWeek.weekNumber,
          year: lastWeek.year,
          cycleType: 'weekly'
        });

        if (!exists) {
          winnerRecords.push({
            userId: winner.userId,
            rank: winner.rank,
            score: winner.score,
            weekNumber: lastWeek.weekNumber,
            year: lastWeek.year,
            cycleType: 'weekly'
          });
        }
      }

      if (winnerRecords.length > 0) {
        await Winner.insertMany(winnerRecords);
      }

      // Send notifications to winners
      for (const winner of winners) {
        try {
          await NotificationService.sendWeeklyWinnerNotification(
            winner.userId,
            winner.rank,
            winner.score,
            lastWeek.weekNumber,
            lastWeek.year
          );
        } catch (error) {
          console.error(`Failed to send notification to winner ${winner.userId}:`, error);
        }
      }

      console.log(`✅ Weekly winner announcement completed. ${winners.length} winners announced.`);
      return {
        success: true,
        message: 'Winners announced successfully',
        count: winners.length,
        week: lastWeek.weekNumber,
        year: lastWeek.year
      };
    } catch (error) {
      console.error('Error in announceWeeklyWinners:', error);
      throw new ApiError(500, 'Failed to announce weekly winners', error.message);
    }
  }

  /**
   * Get user's ranking for current week
   */
  static async getUserRanking(userId, weekNumber = null, year = null) {
    try {
      if (!weekNumber || !year) {
        const now = new Date();
        const weekInfo = this.getWeekInfo(now);
        weekNumber = weekInfo.weekNumber;
        year = weekInfo.year;
      }

      // Get user's score
      const userAttempts = await QuizAttempt.find({
        userId,
        weekNumber,
        year,
        isCorrect: true
      }).lean();

      const userScore = userAttempts.length;
      const userFirstAttempt = userAttempts.length > 0 ? userAttempts[0].createdAt : null;

      // Get all users' scores for ranking
      const allScores = await QuizAttempt.aggregate([
        {
          $match: {
            weekNumber,
            year,
            isCorrect: true
          }
        },
        {
          $group: {
            _id: '$userId',
            score: { $sum: 1 },
            firstAttemptTime: { $first: '$createdAt' }
          }
        },
        {
          $sort: {
            score: -1,
            firstAttemptTime: 1
          }
        }
      ]);

      // Find user's rank
      let userRank = 0;
      for (let i = 0; i < allScores.length; i++) {
        if (allScores[i]._id.toString() === userId.toString()) {
          userRank = i + 1;
          break;
        }
      }

      return {
        weekNumber,
        year,
        score: userScore,
        rank: userRank,
        totalParticipants: allScores.length
      };
    } catch (error) {
      console.error('Error getting user ranking:', error);
      throw new ApiError(500, 'Failed to fetch user ranking', error.message);
    }
  }

  /**
   * Get leaderboard for current week
   */
  static async getLeaderboard(weekNumber = null, year = null, limit = 10) {
    try {
      if (!weekNumber || !year) {
        const now = new Date();
        const weekInfo = this.getWeekInfo(now);
        weekNumber = weekInfo.weekNumber;
        year = weekInfo.year;
      }

      const leaderboard = await QuizAttempt.aggregate([
        {
          $match: {
            weekNumber,
            year,
            isCorrect: true
          }
        },
        {
          $group: {
            _id: '$userId',
            score: { $sum: 1 },
            firstAttemptTime: { $first: '$createdAt' }
          }
        },
        {
          $sort: {
            score: -1,
            firstAttemptTime: 1
          }
        },
        {
          $limit: limit
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $project: {
            userId: '$_id',
            name: '$user.name',
            email: '$user.email',
            profilePicture: '$user.profilePicture',
            score: 1,
            firstAttemptTime: 1,
            _id: 0
          }
        }
      ]);

      // Add rank
      const leaderboardWithRank = leaderboard.map((item, index) => ({
        ...item,
        rank: index + 1
      }));

      return {
        weekNumber,
        year,
        leaderboard: leaderboardWithRank
      };
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      throw new ApiError(500, 'Failed to fetch leaderboard', error.message);
    }
  }

  /**
   * Get winner history
   */
  static async getWinnerHistory({ page = 1, limit = 10 } = {}) {
    try {
      const skip = (page - 1) * limit;

      const [winners, total] = await Promise.all([
        Winner.find()
          .populate('userId', 'name email profilePicture')
          .sort({ year: -1, weekNumber: -1, rank: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Winner.countDocuments()
      ]);

      return {
        data: winners,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting winner history:', error);
      throw new ApiError(500, 'Failed to fetch winner history', error.message);
    }
  }
}

export default WinnerService;

// Legacy export for backward compatibility with cron jobs
export const announceWeeklyWinners = async () => {
  return await WinnerService.announceWeeklyWinners();
};