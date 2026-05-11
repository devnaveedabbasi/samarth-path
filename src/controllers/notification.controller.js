// controllers/notification.controller.js
import NotificationService from '../services/notification.service.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';

/**
 * Notification Controller - Notification operations
 */

/**
 * Get user notifications with pagination
 * Query: page=1&limit=20&type=content_published&isRead=false
 */
export async function getUserNotifications(req, res) {
  const userId = req.user._id;
  const { page = 1, limit = 20, type = null, isRead = null } = req.query;

  const result = await NotificationService.getUserNotifications(userId, {
    page: parseInt(page),
    limit: parseInt(limit),
    type,
    isRead: isRead !== null ? isRead === 'true' : null
  });

  res.status(200).json(
    new ApiResponse(
      200,
      result,
      `${result.data.length} notifications retrieved`
    )
  );
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(req, res) {
  const { notificationId } = req.params;

  if (!notificationId) {
    throw new ApiError(400, 'Notification ID is required');
  }

  const notification = await NotificationService.markAsRead(notificationId);

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  res.status(200).json(
    new ApiResponse(
      200,
      notification,
      'Notification marked as read'
    )
  );
}

/**
 * Mark all notifications as read for user
 */
export async function markAllNotificationsAsRead(req, res) {
  const userId = req.user._id;

  const result = await NotificationService.markAllAsRead(userId);

  res.status(200).json(
    new ApiResponse(
      200,
      { modifiedCount: result.modifiedCount },
      `${result.modifiedCount} notifications marked as read`
    )
  );
}

/**
 * Delete a notification
 */
export async function deleteNotification(req, res) {
  const { notificationId } = req.params;

  if (!notificationId) {
    throw new ApiError(400, 'Notification ID is required');
  }

  const notification = await NotificationService.deleteNotification(notificationId);

  if (!notification) {
    throw new ApiError(404, 'Notification not found');
  }

  res.status(200).json(
    new ApiResponse(
      200,
      null,
      'Notification deleted successfully'
    )
  );
}

/**
 * Get notification statistics for user
 */
export async function getNotificationStats(req, res) {
  const userId = req.user._id;

  const { default: Notification } = await import('../models/Notification.model.js');

  const stats = await Notification.aggregate([
    { $match: { userId: req.user._id } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        unread: {
          $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] }
        },
        byType: {
          $push: {
            type: '$type',
            count: 1
          }
        }
      }
    }
  ]);

  const result = stats.length > 0 ? stats[0] : { total: 0, unread: 0, byType: [] };

  res.status(200).json(
    new ApiResponse(
      200,
      result,
      'Notification statistics retrieved'
    )
  );
}

/**
 * Admin: Send status change notification
 */
export async function sendStatusChangeNotification(req, res) {
  const { userId, newStatus } = req.body;
console.log('sendStatusChangeNotification called with:', { userId, newStatus });
  if (!userId || !newStatus) {
    throw new ApiError(400, 'userId and newStatus are required');
  }

  const notification = await NotificationService.sendStatusChangeNotification(userId, newStatus);

  res.status(201).json(
    new ApiResponse(
      201,
      notification,
      `Status change notification sent for ${newStatus}`
    )
  );
}

/**
 * Admin: Send content published notification to all users
 */
/**
 * Internal utility — call directly from other controllers
 */
export async function sendContentPublishedNotification(contentData, adminId) {
  const count = await NotificationService.sendContentPublishedNotification(contentData, adminId);
  return count;
}

/**
 * HTTP handler — called via route
 */
export async function sendContentPublishedNotificationHandler(req, res) {
  const { contentData } = req.body;

  if (!contentData) {
    throw new ApiError(400, 'contentData is required');
  }

  const count = await sendContentPublishedNotification(contentData, req.user._id);

  res.status(201).json(
    new ApiResponse(
      201,
      { notificationsSent: count },
      `Notifications sent to ${count} users`
    )
  );
}

/**
 * Admin: Clean up old notifications
 * Query: daysOld=30
 */
export async function cleanupOldNotifications(req, res) {
  const { daysOld = 30 } = req.query;

  const deletedCount = await NotificationService.deleteOldNotifications(parseInt(daysOld));

  res.status(200).json(
    new ApiResponse(
      200,
      { deletedCount },
      `${deletedCount} old notifications deleted`
    )
  );
}
