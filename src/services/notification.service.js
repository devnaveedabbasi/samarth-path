// services/notification.service.js
import Notification from '../models/Notification.model.js';
import User from '../models/User.model.js';
import sendNotification from '../utils/sendNotification.js';
import { sendVerificationEmail } from '../utils/emailService.js';
import { ApiError } from '../utils/errorHandler.js';
import moment from 'moment-timezone';
import { TIMEZONE } from '../utils/date.util.js';

/**
 * Notification Service - Centralized notification handling
 */
export class NotificationService {
  /**
   * Create and send notification to user
   */
  static async createNotification(userId, {
    type, title, body, status = 'info',
    data = {}, relatedEntityId = null, relatedEntityType = 'none'
  }) {
    try {
      const notification = await Notification.create({
        userId, type, title, body, status, data,
        relatedEntityId, relatedEntityType
      });

      const user = await User.findById(userId).select('fcmToken email');
      if (user?.fcmToken) {
        try {
          await sendNotification({
            token: user.fcmToken,
            title,
            body,
            // ✅ FCM sirf strings accept karta hai
            data: Object.fromEntries(
              Object.entries({ type, status, ...data }).map(([k, v]) => [k, String(v)])
            )
          });
        } catch (err) {
          if (err.errorInfo?.code === 'messaging/registration-token-not-registered') {
            await User.findByIdAndUpdate(userId, { $unset: { fcmToken: 1 } });
            console.log(`[FCM] Removed invalid token for user: ${userId}`);
          } else {
            console.error(`[FCM] Push failed for user ${userId}:`, err.message);
          }
        }
      }

      return notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw new ApiError(500, 'Failed to create notification', error.message);
    }
  }
  /**
   * Send admin status change notification
   * suspend => warning, blocked => error, active => success
   */
  static async sendStatusChangeNotification(userId, newStatus) {
    const statusMap = {
      suspended: { status: 'warning', title: 'Account Suspended', body: 'Your account has been temporarily suspended.' },
      blocked: { status: 'error', title: 'Account Blocked', body: 'Your account has been blocked. Please contact support.' },
      active: { status: 'success', title: 'Account Activated', body: 'Your account has been activated successfully.' },
      approved: { status: 'success', title: 'Account Approved', body: 'Your account has been approved.' },
      pending: { status: 'info', title: 'Pending Review', body: 'Your account is under review.' }
    };

    const notificationData = statusMap[newStatus];
    if (!notificationData) {
      throw new ApiError(400, 'Invalid status');
    }

    return this.createNotification(userId, {
      type: 'status_change',
      title: notificationData.title,
      body: notificationData.body,
      status: notificationData.status,
      data: { newStatus }
    });
  }

  /**
   * Send content published notification to all users
   */
  static async sendContentPublishedNotification(contentData, adminId) {
    try {
      const contentType = contentData.contentType;
      const contentTitle =
        contentData.textContent?.title ||
        contentData.quizContent?.title ||
        contentData.videoContent?.title ||
        'New Content';

      const unlocksAt = contentData.unlocksAt; // "08:00", "14:00", "19:00"

      // Check if unlock time has already arrived or is in the future
      const now = moment().tz(TIMEZONE); const [unlockHour, unlockMin] = unlocksAt.split(':').map(Number);
      const unlockMoment = moment.tz(
        `${moment().format('YYYY-MM-DD')} ${unlocksAt}`,
        `YYYY-MM-DD HH:mm`,
        TIMEZONE
      );
      const isAlreadyUnlocked = now.isSameOrAfter(unlockMoment);

      // Content type readable naam
      const typeLabel = {
        text: 'Post',
        quiz: 'Quiz',
        video: 'Video'
      }[contentType] || 'Content';

      const title = isAlreadyUnlocked
        ? `🔓 ${typeLabel} Now Available!`
        : `📅 New ${typeLabel} Scheduled!`;

      const body = isAlreadyUnlocked
        ? `"${contentTitle}" is now available — watch it now!`
        : `"${contentTitle}" will be published today at ${unlocksAt} PKT.`;

      // Get all approved users
      const users = await User.find({
        status: 'approved',
        isDeleted: { $ne: true },
        [`notificationSettings.${contentType}`]: true
      }).select('_id fcmToken notificationSettings').lean();

      // Har user ka setting print karo
      users.forEach(u => {
        console.log(`User: ${u._id}, ${contentType}: ${u.notificationSettings?.[contentType]}`);
      });

      console.log(`[NOTIFICATION] contentType: ${contentType}, users found: ${users.length}`);

      // Bulk DB notifications
      const notifications = users.map(user => ({
        userId: user._id,
        type: 'content_published',
        title,
        body,
        status: 'info',
        data: {
          contentType,
          contentId: contentData._id.toString(),
          unlocksAt,
          isAlreadyUnlocked
        },
        relatedEntityId: contentData._id,
        relatedEntityType: 'content'
      }));

      await Notification.insertMany(notifications);

      // Send FCM push to users who have FCM tokens
      const fcmTokens = users.map(u => u.fcmToken).filter(Boolean);
      for (const token of fcmTokens) {
        try {
          await sendNotification({
            token,
            title,
            body,
            data: {
              type: 'content_published',
              contentType,
              contentId: contentData._id.toString(),
              unlocksAt,
              isAlreadyUnlocked: String(isAlreadyUnlocked)
            }
          });
        } catch (err) {
          console.error(`[FCM] Token failed: ${token}`, err.message);
        }
      }

      console.log(`[NOTIFICATION] "${title}" sent to ${users.length} users`);
      return notifications.length;
    } catch (error) {
      console.error('Error sending content published notification:', error);
      throw new ApiError(500, 'Failed to send notifications', error.message);
    }
  }

  /**
   * Send DAILY winner notification
   */
  static async sendDailyWinnerNotification(winnerId, rank, score, dayNumber, month, year) {
    try {
      const titles = {
        1: '🏆 You\'re Today\'s Champion!',
        2: '🥈 Runner-up Today!',
        3: '🥉 Third Place Today!'
      };

      const title = titles[rank] || `🎉 Congratulations! Rank #${rank} Today!`;
      const body = `You scored ${score} points today (${dayNumber}/${month}/${year})`;

      await this.createNotification(winnerId, {
        type: 'winner_announcement',
        title,
        body,
        status: 'success',
        data: {
          rank,
          score,
          dayNumber,
          month,
          year,
          cycleType: 'daily'
        }
      });

      // Send email
      const user = await User.findById(winnerId).select('email name');
      if (user?.email) {
        await this.sendWinnerEmail(user.email, user.name, rank, score, 'Daily', null, null, dayNumber, month, year);
      }

      return true;
    } catch (error) {
      console.error('Error sending daily winner notification:', error);
      throw new ApiError(500, 'Failed to send daily winner notification', error.message);
    }
  }

  /**
   * Send WEEKLY winner notification
   */
  static async sendWeeklyWinnerNotification(winnerId, rank, score, weekNumber, year) {
    try {
      const titles = {
        1: '🏆 You\'re the Weekly Champion!',
        2: '🥈 Runner-up Achievement!',
        3: '🥉 Third Place Winner!'
      };

      const title = titles[rank] || `Congratulations! Rank #${rank} This Week!`;
      const body = `You scored ${score} points this week (Week ${weekNumber}, ${year})`;

      await this.createNotification(winnerId, {
        type: 'winner_announcement',
        title,
        body,
        status: 'success',
        data: {
          rank,
          score,
          weekNumber,
          year,
          cycleType: 'weekly'
        }
      });

      // Send email
      const user = await User.findById(winnerId).select('email name');
      if (user?.email) {
        await this.sendWinnerEmail(user.email, user.name, rank, score, 'Weekly', weekNumber, year);
      }

      return true;
    } catch (error) {
      console.error('Error sending weekly winner notification:', error);
      throw new ApiError(500, 'Failed to send weekly winner notification', error.message);
    }
  }

  /**
   * Send PRIZE ASSIGNED notification
   */
  static async sendPrizeAssignedNotification(winnerId, prizeId, prizeTitle, cycleType) {
    try {
      const cycleLabel = cycleType === 'daily' ? 'Daily' : 'Weekly';

      await this.createNotification(winnerId, {
        type: 'custom',
        title: '🎁 A Prize Has Been Assigned to You!',
        body: `You've been awarded "${prizeTitle}" for winning the ${cycleLabel} Quiz Challenge.`,
        status: 'success',
        data: { prizeTitle, cycleType },
        relatedEntityId: prizeId,
        relatedEntityType: 'prize'
      });

      return true;
    } catch (error) {
      console.error('Error sending prize assigned notification:', error);
      throw new ApiError(500, 'Failed to send prize assigned notification', error.message);
    }
  }

  /**
   * Send winner announcement email (supports both daily and weekly)
   */
  static async sendWinnerEmail(email, name, rank, score, cycleType, weekNumber = null, year = null, dayNumber = null, month = null, dayYear = null) {
    const rankEmoji = rank === 1 ? '🏆' : rank === 2 ? '🥈' : '🥉';
    const rankTitle = rank === 1 ? 'CHAMPION' : rank === 2 ? 'RUNNER-UP' : 'THIRD PLACE';
    const rankColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : '#CD7F32';

    let periodText = '';
    if (cycleType === 'Daily') {
      periodText = `Daily Quiz Challenge (${dayNumber}/${month}/${dayYear})`;
    } else {
      periodText = `Weekly Quiz Challenge (Week ${weekNumber}, ${year})`;
    }

    const subject = `${rankEmoji} Congratulations! You're a Samarth Path ${cycleType} Winner - Rank #${rank}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { margin: 0; padding: 0; background-color: #f5f5f5; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 20px; text-align: center; }
          .logo { font-size: 28px; font-weight: bold; margin-bottom: 10px; }
          .emoji { font-size: 48px; display: block; margin: 10px 0; }
          .rank-badge { 
            background-color: ${rankColor}; 
            color: white; 
            padding: 15px; 
            border-radius: 8px; 
            margin: 20px; 
            text-align: center; 
            font-size: 24px; 
            font-weight: bold;
          }
          .content { padding: 30px; line-height: 1.6; color: #333; }
          .greeting { font-size: 20px; font-weight: bold; margin-bottom: 15px; color: #667eea; }
          .stats { background-color: #f9f9f9; border-left: 4px solid #667eea; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .stat-item { display: flex; justify-content: space-between; margin: 10px 0; font-size: 16px; }
          .stat-label { font-weight: 600; color: #555; }
          .stat-value { font-weight: bold; color: #667eea; font-size: 18px; }
          .cta-button { 
            display: inline-block; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; 
            padding: 12px 30px; 
            text-decoration: none; 
            border-radius: 5px; 
            margin: 20px auto; 
            display: block; 
            width: fit-content;
            font-weight: bold;
            cursor: pointer;
          }
          .motivational { 
            background-color: #e8f5e9; 
            border-left: 4px solid #4caf50; 
            padding: 15px; 
            margin: 20px 0; 
            border-radius: 4px;
            color: #2e7d32;
          }
          .footer { 
            background-color: #f5f5f5; 
            padding: 20px; 
            text-align: center; 
            font-size: 12px; 
            color: #888; 
            border-top: 1px solid #ddd;
          }
          .divider { height: 1px; background-color: #ddd; margin: 20px 0; }
          .prize-info { 
            background: linear-gradient(135deg, #ffeaa7 0%, #fdcb6e 100%); 
            color: #333; 
            padding: 15px; 
            border-radius: 5px; 
            margin: 15px 0;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🎓 Samarth Path</div>
            <div class="emoji">${rankEmoji}</div>
            <h1 style="margin: 10px 0; font-size: 28px;">CONGRATULATIONS!</h1>
            <p style="margin: 10px 0; font-size: 16px;">You're a ${cycleType} Quiz Winner</p>
          </div>

          <div class="rank-badge">
            RANK #${rank} - ${rankTitle}
          </div>

          <div class="content">
            <div class="greeting">Hello ${name},</div>
            
            <p>🎉 Amazing news! You've secured <strong>Rank #${rank}</strong> in the Samarth Path ${periodText}!</p>

            <div class="stats">
              <div class="stat-item">
                <span class="stat-label">Your Score:</span>
                <span class="stat-value">${score} Points</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Period:</span>
                <span class="stat-value">${cycleType}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Achievement:</span>
                <span class="stat-value">${rankTitle}</span>
              </div>
            </div>

            <div class="prize-info">
              <strong>🎁 Reward Unlocked!</strong><br>
              <small>Check your account for exclusive prizes and badges</small>
            </div>

            <div class="motivational">
              <strong>💪 Keep it up!</strong> Challenge yourself ${cycleType === 'Daily' ? 'tomorrow' : 'next week'} to climb the leaderboard even higher. Every correct answer brings you closer to becoming the champion!
            </div>

            <div class="divider"></div>

            <p style="font-size: 14px; color: #666;">
              Thank you for being an active member of the Samarth Path community! Your dedication and effort inspire us every day.
            </p>
          </div>

          <div class="footer">
            <p style="margin: 0;">📧 Samarth Path - ${cycleType} Quiz Winners Announcement</p>
            <p style="margin: 5px 0;">This is an automated message. Please don't reply to this email.</p>
            <p style="margin: 10px 0; color: #aaa;">© 2026 Samarth Path. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      await sendVerificationEmail(email, subject, html);
      console.log(`✅ Winner email sent to: ${email} (Rank #${rank})`);
    } catch (error) {
      console.error('Error sending winner email:', error);
    }
  }

  /**
   * Mark notification as read
   */
  static async markAsRead(notificationId) {
    return Notification.findByIdAndUpdate(
      notificationId,
      {
        isRead: true,
        readAt: new Date()
      },
      { new: true }
    );
  }

  /**
   * Mark all notifications as read for user
   */
  static async markAllAsRead(userId) {
    return Notification.updateMany(
      { userId, isRead: false },
      {
        isRead: true,
        readAt: new Date()
      }
    );
  }

  /**
   * Get user notifications with pagination
   */
  static async getUserNotifications(userId, { page = 1, limit = 20, type = null, isRead = null }) {
    const skip = (page - 1) * limit;
    const query = { userId };

    if (type) query.type = type;
    if (isRead !== null) query.isRead = isRead;

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(query);

    return {
      data: notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Delete notification
   */
  static async deleteNotification(notificationId) {
    return Notification.findByIdAndDelete(notificationId);
  }

  /**
   * Delete all old notifications (older than days)
   */
  static async deleteOldNotifications(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Notification.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    return result.deletedCount;
  }
}

export default NotificationService;
