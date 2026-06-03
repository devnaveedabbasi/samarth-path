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

/**
 * Cron: Trial Expiry Check (every 10 minutes)
 * - Marks expired trial subscriptions as 'expired'
 * - Updates user.isSubscribed = false
 * - Sends push notification when trial expires
 */
cron.schedule('*/10 * * * *', async () => {
  console.log('[CRON] Running Trial Subscription Expiry Check...');

  try {
    const now = new Date();

    const expiredTrials = await Subscription.find({
      trialEndDate: { $lte: now },
      status: 'trial'
    });

    if (!expiredTrials.length) {
      console.log('[CRON] No expired trial subscriptions found');
      return;
    }

    for (const sub of expiredTrials) {
      sub.status = 'expired';
      await sub.save();

      await User.findByIdAndUpdate(sub.userId, {
        isSubscribed: false
      });

      // Send expiry notification
      try {
        await NotificationService.createNotification(sub.userId, {
          type: 'subscription',
          title: '⏰ Trial Period Expired',
          body: 'Your 3-day free trial has ended. Subscribe now for ₹199/month to continue using the app.',
          status: 'warning',
          data: {
            subscriptionId: sub._id.toString(),
            action: 'subscribe',
            planPrice: 199,
          },
          relatedEntityId: sub._id,
          relatedEntityType: 'subscription',
        });
      } catch (notifErr) {
        console.error(`[CRON] Failed to send trial expiry notification for user ${sub.userId}:`, notifErr.message);
      }

      console.log(`[CRON] Expired trial subscription for user: ${sub.userId}`);
    }

    console.log(`[CRON] Total trial subscriptions expired: ${expiredTrials.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Trial subscription expiry:', error.message);
  }
});

/**
 * Cron: Paid Subscription Expiry Check (every 10 minutes)
 * - Marks expired active (paid) subscriptions as 'expired'
 * - Updates user.isSubscribed = false
 * - Sends renewal notification
 */
cron.schedule('*/10 * * * *', async () => {
  console.log('[CRON] Running Paid Subscription Expiry Check...');

  try {
    const now = new Date();

    const expiredPaid = await Subscription.find({
      status: 'active',
      expiryDate: { $lte: now }
    });

    if (!expiredPaid.length) {
      console.log('[CRON] No expired paid subscriptions found');
      return;
    }

    for (const sub of expiredPaid) {
      sub.status = 'expired';
      await sub.save();

      await User.findByIdAndUpdate(sub.userId, {
        isSubscribed: false
      });

      // Send renewal notification
      try {
        await NotificationService.createNotification(sub.userId, {
          type: 'subscription',
          title: '📋 Subscription Expired',
          body: 'Your monthly subscription has expired. Renew now for ₹199/month to continue accessing all content.',
          status: 'warning',
          data: {
            subscriptionId: sub._id.toString(),
            action: 'renew',
            planPrice: 199,
          },
          relatedEntityId: sub._id,
          relatedEntityType: 'subscription',
        });
      } catch (notifErr) {
        console.error(`[CRON] Failed to send paid expiry notification for user ${sub.userId}:`, notifErr.message);
      }

      console.log(`[CRON] Expired paid subscription for user: ${sub.userId}`);
    }

    console.log(`[CRON] Total paid subscriptions expired: ${expiredPaid.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Paid subscription expiry:', error.message);
  }
});

/**
 * Cron: Trial Ending Warning Notification (every hour)
 * - Find trial subscriptions ending within the next 24 hours
 * - Send warning notification if not already sent
 * - "Aapka trial kal khatam ho raha hai, subscribe karein!"
 */
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] Running Trial Ending Warning Check...');

  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find trial subscriptions expiring within next 24 hours
    // that haven't been notified yet
    const endingSoonTrials = await Subscription.find({
      status: 'trial',
      trialEndDate: { $gte: now, $lte: in24Hours },
      trialNotificationSent: { $ne: true }
    });

    if (!endingSoonTrials.length) {
      console.log('[CRON] No trials ending soon');
      return;
    }

    for (const sub of endingSoonTrials) {
      try {
        await NotificationService.createNotification(sub.userId, {
          type: 'subscription',
          title: '⚠️ Trial Ending Soon!',
          body: 'Your 3-day free trial ends today. Subscribe now for ₹199/month to keep full access to all content!',
          status: 'warning',
          data: {
            subscriptionId: sub._id.toString(),
            action: 'subscribe',
            planPrice: 199,
            trialEndDate: sub.trialEndDate.toISOString(),
          },
          relatedEntityId: sub._id,
          relatedEntityType: 'subscription',
        });

        // Mark notification as sent so we don't send it again
        sub.trialNotificationSent = true;
        await sub.save();

        console.log(`[CRON] Trial ending warning sent to user: ${sub.userId}`);
      } catch (notifErr) {
        console.error(`[CRON] Failed to send trial warning for user ${sub.userId}:`, notifErr.message);
      }
    }

    console.log(`[CRON] Trial ending warnings sent: ${endingSoonTrials.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Trial ending warning:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

console.log('[CRON]  All scheduled jobs initialized');