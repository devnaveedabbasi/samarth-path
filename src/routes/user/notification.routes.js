// routes/user/notification.routes.js
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getNotificationStats,
  sendStatusChangeNotification,
  sendContentPublishedNotification,
  cleanupOldNotifications
} from '../../controllers/notification.controller.js';

const router = Router();

// Protected user routes
router.use(authMiddleware);

router.get('/', asyncHandler(getUserNotifications));
router.get('/stats', asyncHandler(getNotificationStats));
router.patch('/:notificationId/read', asyncHandler(markNotificationAsRead));
router.patch('/read-all', asyncHandler(markAllNotificationsAsRead));
router.delete('/:notificationId', asyncHandler(deleteNotification));

// Admin routes
router.post('/admin/status-change', asyncHandler(sendStatusChangeNotification));
router.post('/admin/content-published', asyncHandler(sendContentPublishedNotification));
router.delete('/admin/cleanup', asyncHandler(cleanupOldNotifications));

export default router;
