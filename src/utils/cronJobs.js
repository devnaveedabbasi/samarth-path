import cron from 'node-cron';
import moment from 'moment-timezone';
import Content from '../models/Content.model.js';
import { WinnerService } from '../services/winner.service.js';
import NotificationService from '../services/notification.service.js';
import ArchiveService from '../services/archive.service.js';

let isProcessing = false;

/**
 * Cron: Content Unlock Job
 * Runs every minute to check and notify users about newly available content
 */
cron.schedule('* * * * *', async () => {
  console.log('[CRON] Checking for content to unlock...');

  if (isProcessing) return;

  isProcessing = true;
  const now = moment().tz("Asia/Karachi");
  const currentTime = now.format("HH:mm");
  const startOfDay = now.clone().startOf('day').toDate();
  const endOfDay = now.clone().endOf('day').toDate();

  try {
    const pendingContent = await Content.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      unlocksAt: { $lte: currentTime },
      isNotified: false,
      isActive: true
    });

    if (pendingContent.length > 0) {
      for (const content of pendingContent) {
        try {
          console.log(`[SUCCESS] Unlocking ${content.contentType}: ${content.textContent?.title || content.quizContent?.title || content.videoContent?.title}`);

          // Mark as notified
          content.isNotified = true;
          await content.save();

          // Archive content for date-based retrieval
          await ArchiveService.archiveContent(content._id);

          // Send notification to users about new content
          await NotificationService.sendContentPublishedNotification(content, content.createdBy);
        } catch (error) {
          console.error(`[ERROR] Failed to unlock content ${content._id}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("[CRON ERROR] Content unlock:", error);
  } finally {
    isProcessing = false;
  }
}, {
  scheduled: true,
  timezone: "Asia/Karachi"
});

/**
 * Cron: Weekly Winner Announcement
 * Runs every Sunday at 12:00 AM (Karachi Time)
 * Announces winners from the previous week, sends notifications and emails
 */
cron.schedule('0 0 * * 0', async () => {
  console.log('[CRON] Running Weekly Winner Announcement...');

  try {
    const result = await WinnerService.announceWeeklyWinners();
    console.log('[CRON SUCCESS]', result);
  } catch (error) {
    console.error('[CRON ERROR] Weekly winner announcement:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Karachi"
});

/**
 * Cron: Archive Cleanup
 * Runs every Sunday at 2:00 AM (Karachi Time)
 * Cleans up old archive entries (older than 6 months)
 */
cron.schedule('0 2 * * 0', async () => {
  console.log('[CRON] Running Archive Cleanup...');

  try {
    // Delete notifications older than 30 days
    const deletedCount = await NotificationService.deleteOldNotifications(30);
    console.log(`[CRON SUCCESS] Deleted ${deletedCount} old notifications`);
  } catch (error) {
    console.error('[CRON ERROR] Archive cleanup:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Karachi"
});

console.log('[CRON] All scheduled jobs initialized');
