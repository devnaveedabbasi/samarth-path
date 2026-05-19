import cron from 'node-cron';
import moment from 'moment-timezone';
import Content from '../models/Content.model.js';
import WinnerService from '../services/winner.service.js';
import NotificationService from '../services/notification.service.js';
import Subscription from '../models/Subscription.model.js';
import User from '../models/User.model.js';
import { TIMEZONE, CONTENT_UNLOCK_TIMES } from '../utils/date.util.js';

let isProcessing = false;

/**
 * Cron: Content Unlock Job
 * Runs every minute — unlocks content at scheduled time and sends notifications
 */
cron.schedule('* * * * *', async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const now = moment().tz(TIMEZONE);
    const currentTime = now.format('HH:mm');
    const startOfDay = now.clone().startOf('day').toDate();
    const endOfDay = now.clone().endOf('day').toDate();

    // Sirf woh content types jinka unlock time abhi match karta hai
    const typesToUnlock = Object.entries(CONTENT_UNLOCK_TIMES)
      .filter(([_, time]) => time === currentTime)
      .map(([type]) => type);

    if (!typesToUnlock.length) return;

    console.log(`[CRON] ${currentTime} PKT — unlocking: ${typesToUnlock.join(', ')}`);

    for (const contentType of typesToUnlock) {
      try {
        // isActive: false wala content dhundo aur unlock karo
        const content = await Content.findOneAndUpdate(
          {
            contentType,
            date: { $gte: startOfDay, $lte: endOfDay },
            isActive: false,
            isNotified: false,
            isDeleted: { $ne: true }
          },
          { $set: { isActive: true, isNotified: true } },
          { new: true }
        );

        if (content) {
          const title =
            content.textContent?.title ||
            content.quizContent?.title ||
            content.videoContent?.title ||
            'Untitled';

          console.log(`[CRON]  Unlocked ${contentType}: "${title}"`);

          await NotificationService.sendContentPublishedNotification(content, content.createdBy);
        }
      } catch (error) {
        console.error(`[CRON]  Failed to unlock ${contentType}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[CRON ERROR] Content unlock job:', error.message);
  } finally {
    isProcessing = false;
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

/**
 * Cron: Weekly Winner Announcement
 * Har Sunday 12:00 AM (PKT) — previous week ke winners announce karta hai
 */
cron.schedule('0 0 * * 0', async () => {
  console.log('[CRON] Running Weekly Winner Announcement...');

  try {
    const result = await WinnerService.announceWeeklyWinners();
    console.log('[CRON SUCCESS] Weekly winners announced:', result);
  } catch (error) {
    console.error('[CRON ERROR] Weekly winner announcement:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

/**
 * Cron: Old Notifications Cleanup
 * Har Sunday 2:00 AM (PKT) — 30 din purani notifications delete karta hai
 */
cron.schedule('0 2 * * 0', async () => {
  console.log('[CRON] Running Notifications Cleanup...');

  try {
    const deletedCount = await NotificationService.deleteOldNotifications(30);
    console.log(`[CRON SUCCESS] Deleted ${deletedCount} old notifications`);
  } catch (error) {
    console.error('[CRON ERROR] Notifications cleanup:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});


cron.schedule('*/10 * * * *', async () => {
  console.log('[CRON] Running Subscription Expiry Check...');

  try {
    const now = new Date();

    const expiredSubs = await Subscription.find({
      trialEndDate: { $lte: now },
      status: 'trial'
    });

    if (!expiredSubs.length) {
      console.log('[CRON] No expired subscriptions found');
      return;
    }

    for (const sub of expiredSubs) {
      sub.status = 'expired';
      await sub.save();

      await User.findByIdAndUpdate(sub.userId, {
        isSubscribed: false,
        subscriptionID: null
      });

      console.log(`[CRON] Expired subscription for user: ${sub.userId}`);
    }

    console.log(`[CRON] Total expired: ${expiredSubs.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Subscription expiry:', error.message);
  }
});


console.log('[CRON]  All scheduled jobs initialized');