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
    type,
    title,
    body,
    status = 'info',
    data = {},
    relatedEntityId = null,
    relatedEntityType = 'none'
  }) {
    try {
      // Save notification to database
      const notification = await Notification.create({
        userId,
        type,
        title,
        body,
        status,
        data,
        relatedEntityId,
        relatedEntityType
      });

      // Get user's FCM token and send push notification
      const user = await User.findById(userId).select('fcmToken email');
      if (user?.fcmToken) {
        await sendNotification({
          token: user.fcmToken,
          title,
          body,
          data: {
            type,
            status,
            ...data
          }
        });
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

    // Check karo — unlock time abhi aaya ya future mein hai
const now = moment().tz(TIMEZONE);    const [unlockHour, unlockMin] = unlocksAt.split(':').map(Number);
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
      ? `🔓 ${typeLabel} Ab Available Hai!`
      : `📅 Naya ${typeLabel} Schedule Hua!`;

    const body = isAlreadyUnlocked
      ? `"${contentTitle}" ab available hai — abhi dekho!`
      : `"${contentTitle}" aaj ${unlocksAt} PKT par publish hoga.`;

    // Saare approved users
    const users = await User.find({
      status: 'approved',
      isDeleted: { $ne: true }
    }).select('_id fcmToken').lean();

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

    // FCM push — sirf woh users jinke paas token hai
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
   * Send weekly winner notification
   */
  static async sendWeeklyWinnerNotification(winnerId, rank, score, weekNumber, year) {
    try {
      const titles = {
        1: '🏆 You\'re the Weekly Champion!',
        2: '🥈 Runner-up Achievement!',
        3: '🥉 Third Place Winner!'
      };

      const title = titles[rank] || `Congratulations! Rank #${rank}`;
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
          year
        }
      });

      // Also send email
      const user = await User.findById(winnerId).select('email name');
      if (user?.email) {
        await this.sendWinnerEmail(user.email, user.name, rank, score, weekNumber);
      }

      return true;
    } catch (error) {
      console.error('Error sending winner notification:', error);
      throw new ApiError(500, 'Failed to send winner notification', error.message);
    }
  }

  /**
   * Send winner announcement email
   */
  static async sendWinnerEmail(email, name, rank, score, weekNumber) {
    const rankEmoji = rank === 1 ? '🏆' : rank === 2 ? '🥈' : '🥉';
    const subject = `${rankEmoji} You're a Weekly Quiz Winner!`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #27ae60; text-align: center;">${rankEmoji} Congratulations ${name}!</h2>
        <p style="font-size: 16px; text-align: center;">You achieved <strong>Rank #${rank}</strong> this week</p>
        
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
          <p style="font-size: 14px; margin: 5px 0;">Total Score</p>
          <h1 style="margin: 10px 0; font-size: 48px;">${score}</h1>
          <p style="font-size: 12px; margin: 5px 0;">Week ${weekNumber}</p>
        </div>

        <p style="text-align: center; font-size: 14px;">Keep up the great work! Challenge yourself next week to rank higher.</p>
        
        <hr style="border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #888;">Thank you for being part of our community!</p>
      </div>
    `;

    try {
      await sendVerificationEmail(email, subject, html);
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
