import cron from 'node-cron';
import moment from 'moment-timezone';
import Content from '../models/Content.model.js';
import WinnerService from '../services/winner.service.js';
import NotificationService from '../services/notification.service.js';
import Subscription from '../models/Subscription.model.js';
import User from '../models/User.model.js';
import { TIMEZONE } from '../utils/date.util.js';

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

    // Har content apne khud ke unlocksAt field ke against check hota hai —
    // type-level default (CONTENT_UNLOCK_TIMES) sirf create-time ka fallback
    // value hai, admin ke custom unlocksAt ko yahan bhi honor karna zaroori hai.
    const contentsToUnlock = await Content.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      unlocksAt: currentTime,
      isActive: false,
      isNotified: false,
      isDeleted: { $ne: true }
    });

    if (!contentsToUnlock.length) return;

    console.log(`[CRON] ${currentTime} IST — unlocking ${contentsToUnlock.length} item(s)`);

    for (const contentDoc of contentsToUnlock) {
      try {
        const content = await Content.findOneAndUpdate(
          { _id: contentDoc._id, isActive: false, isNotified: false },
          { $set: { isActive: true, isNotified: true } },
          { new: true }
        );

        if (content) {
          const title =
            content.textContent?.title ||
            content.quizContent?.title ||
            content.videoContent?.title ||
            'Untitled';

          console.log(`[CRON]  Unlocked ${content.contentType}: "${title}"`);

          await NotificationService.sendContentPublishedNotification(content, content.createdBy);
        }
      } catch (error) {
        console.error(`[CRON]  Failed to unlock ${contentDoc.contentType} (${contentDoc._id}):`, error.message);
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
 * Har Sunday 12:00 AM (IST) — previous week ke winners announce karta hai
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
 * Har Sunday 2:00 AM (IST) — 30 din purani notifications delete karta hai
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
 * Cron: Trial Expiry Check (every minute for testing)
 * - Marks expired trial subscriptions as 'expired'
 * - Updates user.isSubscribed = false
 * - Sends push notification when trial expires
 */
cron.schedule('* * * * *', async () => {
  console.log('[CRON] 🔄 Running Trial Subscription Expiry Check...');

  try {
    const now = new Date();

    // Find expired trial subscriptions
    const expiredTrials = await Subscription.find({
      trialEndDate: { $lte: now },
      status: 'trial'
    });

    if (!expiredTrials.length) {
      console.log('[CRON] ✅ No expired trial subscriptions found');
      return;
    }

    console.log(`[CRON] ⚠️ Found ${expiredTrials.length} expired trial subscriptions`);

    for (const sub of expiredTrials) {
      try {
        // 🔥 CRITICAL: Check if this is a recurring subscription with Razorpay
        // If it has razorpaySubscriptionId, the charge should have happened via webhook
        // If not, mark as expired
        if (sub.razorpaySubscriptionId) {
          // Check if subscription was already charged (should be 'active' by now)
          const updatedSub = await Subscription.findById(sub._id);

          if (updatedSub.status === 'active') {
            console.log(`[CRON] ✅ Subscription ${sub._id} already active (webhook processed), skipping`);
            continue;
          }

          // If still trial and trialEndDate passed, mark as expired
          // This is a fallback in case webhook didn't fire
          sub.status = 'expired';
          sub.trialNotificationSent = true;
          await sub.save();

          await User.findByIdAndUpdate(sub.userId, {
            isSubscribed: false,
            isTrial: false
          });

          console.log(`[CRON] ❌ Recurring trial expired (webhook missed) for user: ${sub.userId}`);
        } else {
          // Regular (non-recurring) trial subscription
          sub.status = 'expired';
          await sub.save();

          await User.findByIdAndUpdate(sub.userId, {
            isSubscribed: false,
            isTrial: false
          });

          console.log(`[CRON] ❌ Regular trial expired for user: ${sub.userId}`);
        }

        // Send expiry notification
        try {
          await NotificationService.createNotification(sub.userId, {
            type: 'subscription',
            title: '⏰ Trial Period Expired',
            body: sub.razorpaySubscriptionId
              ? 'Your trial has ended. We attempted to auto-charge ₹199 but it failed. Please update your payment method.'
              : 'Your 3-day free trial has ended. Subscribe now for ₹199/month to continue using the app.',
            status: 'warning',
            data: {
              subscriptionId: sub._id.toString(),
              action: 'subscribe',
              planPrice: 199,
              razorpaySubscriptionId: sub.razorpaySubscriptionId || null,
            },
            relatedEntityId: sub._id,
            relatedEntityType: 'subscription',
          });
        } catch (notifErr) {
          console.error(`[CRON] Failed to send trial expiry notification for user ${sub.userId}:`, notifErr.message);
        }

      } catch (error) {
        console.error(`[CRON] Error processing trial ${sub._id}:`, error.message);
      }
    }

    console.log(`[CRON] Total trial subscriptions expired: ${expiredTrials.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Trial subscription expiry:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

/**
 * 🔥 UPDATED Cron: Paid Subscription Expiry Check (every minute for testing)
 * - Marks expired active (paid) subscriptions as 'expired'
 * - Updates user.isSubscribed = false
 * - Sends renewal notification
 */
cron.schedule('* * * * *', async () => {
  console.log('[CRON] 🔄 Running Paid Subscription Expiry Check...');

  try {
    const now = new Date();

    const expiredPaid = await Subscription.find({
      status: 'active',
      expiryDate: { $lte: now }
    });

    if (!expiredPaid.length) {
      console.log('[CRON] ✅ No expired paid subscriptions found');
      return;
    }

    console.log(`[CRON] ⚠️ Found ${expiredPaid.length} expired paid subscriptions`);

    for (const sub of expiredPaid) {
      try {
        // Check if this is a recurring subscription
        if (sub.razorpaySubscriptionId) {
          // If it's a recurring subscription with active status in Razorpay
          // Don't mark as expired yet - let Razorpay handle it
          const razorpayStatus = sub.razorpaySubscriptionStatus;

          if (razorpayStatus === 'active' || razorpayStatus === 'authenticated') {
            console.log(`[CRON] ⏳ Recurring subscription ${sub._id} still active in Razorpay, skipping expiry`);
            continue;
          }
        }

        // Mark as expired
        sub.status = 'expired';
        await sub.save();

        await User.findByIdAndUpdate(sub.userId, {
          isSubscribed: false,
          isTrial: false
        });

        // Send renewal notification
        try {
          await NotificationService.createNotification(sub.userId, {
            type: 'subscription',
            title: '📋 Subscription Expired',
            body: sub.razorpaySubscriptionId
              ? 'Your subscription has expired. We will attempt to auto-renew on your next billing date.'
              : 'Your monthly subscription has expired. Renew now for ₹199/month to continue accessing all content.',
            status: 'warning',
            data: {
              subscriptionId: sub._id.toString(),
              action: 'renew',
              planPrice: 199,
              razorpaySubscriptionId: sub.razorpaySubscriptionId || null,
            },
            relatedEntityId: sub._id,
            relatedEntityType: 'subscription',
          });
        } catch (notifErr) {
          console.error(`[CRON] Failed to send paid expiry notification for user ${sub.userId}:`, notifErr.message);
        }

        console.log(`[CRON] ❌ Expired paid subscription for user: ${sub.userId}`);
      } catch (error) {
        console.error(`[CRON] Error processing paid expiry ${sub._id}:`, error.message);
      }
    }

    console.log(`[CRON] Total paid subscriptions expired: ${expiredPaid.length}`);

  } catch (error) {
    console.error('[CRON ERROR] Paid subscription expiry:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

/**
 * 🔥 UPDATED Cron: Trial Ending Warning Notification (every hour)
 * - Find trial subscriptions ending within the next 24 hours
 * - Send warning notification if not already sent
 * - "Aapka trial kal khatam ho raha hai, subscribe karein!"
 */
cron.schedule('0 * * * *', async () => {
  console.log('[CRON] 🔄 Running Trial Ending Warning Check...');

  try {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Find trial subscriptions expiring within next 24 hours
    const endingSoonTrials = await Subscription.find({
      status: 'trial',
      trialEndDate: { $gte: now, $lte: in24Hours },
      trialNotificationSent: { $ne: true }
    });

    if (!endingSoonTrials.length) {
      console.log('[CRON] ✅ No trials ending soon');
      return;
    }

    console.log(`[CRON] ⚠️ Found ${endingSoonTrials.length} trials ending soon`);

    for (const sub of endingSoonTrials) {
      try {
        // Calculate hours remaining
        const hoursRemaining = Math.ceil((sub.trialEndDate - now) / (60 * 60 * 1000));
        const isRecurring = !!sub.razorpaySubscriptionId;

        await NotificationService.createNotification(sub.userId, {
          type: 'subscription',
          title: '⚠️ Trial Ending Soon!',
          body: isRecurring
            ? `Your trial ends in ${hoursRemaining} hours. We'll auto-charge ₹${199} to your saved payment method.`
            : `Your trial ends in ${hoursRemaining} hours. Subscribe now for ₹199/month to keep full access!`,
          status: 'warning',
          data: {
            subscriptionId: sub._id.toString(),
            action: isRecurring ? 'manage' : 'subscribe',
            planPrice: 199,
            trialEndDate: sub.trialEndDate.toISOString(),
            hoursRemaining,
            isRecurring,
          },
          relatedEntityId: sub._id,
          relatedEntityType: 'subscription',
        });

        // Mark notification as sent
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

// 🔥 NEW Cron: Sync Razorpay Subscription Status (every 5 minutes)
// - Fetches latest status from Razorpay for all active subscriptions
// - Updates local status to match Razorpay
// - Handles cases where webhook might have been missed
cron.schedule('*/5 * * * *', async () => {
  console.log('[CRON] 🔄 Syncing Razorpay subscription status...');

  try {
    // Import Razorpay and helper functions
    const { getRazorpayInstance } = await import('../controllers/user/subscriptionRecurring.controller.js');
    const razorpay = getRazorpayInstance();

    // Find all subscriptions with Razorpay IDs that are not in terminal state
    const activeSubs = await Subscription.find({
      razorpaySubscriptionId: { $ne: null },
      razorpaySubscriptionStatus: {
        $nin: ['cancelled', 'completed', 'expired', 'halted']
      }
    });

    if (!activeSubs.length) {
      console.log('[CRON] ✅ No active Razorpay subscriptions to sync');
      return;
    }

    console.log(`[CRON] ⚠️ Syncing ${activeSubs.length} Razorpay subscriptions`);

    let syncedCount = 0;

    for (const sub of activeSubs) {
      try {
        // Fetch latest from Razorpay
        const rzpSub = await razorpay.subscriptions.fetch(sub.razorpaySubscriptionId);

        if (rzpSub.status !== sub.razorpaySubscriptionStatus) {
          // Status mismatch - update local
          sub.razorpaySubscriptionStatus = rzpSub.status;

          // If Razorpay says cancelled/completed, update local accordingly
          if (rzpSub.status === 'cancelled' || rzpSub.status === 'completed') {
            if (!sub.cancelledAt) {
              sub.cancelledAt = new Date();
            }
          }

          // Update next billing date
          if (rzpSub.current_end) {
            sub.nextBillingDate = new Date(rzpSub.current_end * 1000);
          }

          await sub.save();
          syncedCount++;

          console.log(`[CRON] Sync: ${sub._id} -> ${rzpSub.status}`);
        }
      } catch (error) {
        console.error(`[CRON] Failed to sync subscription ${sub._id}:`, error.message);
      }
    }

    console.log(`[CRON] ✅ Synced ${syncedCount} subscriptions`);

  } catch (error) {
    console.error('[CRON ERROR] Razorpay status sync:', error.message);
  }
}, {
  scheduled: true,
  timezone: TIMEZONE
});

console.log('[CRON] 🚀 All scheduled jobs initialized');
console.log('[CRON] 📋 Jobs running:');
console.log('  - Content Unlock: Every minute');
console.log('  - Weekly Winners: Sunday 12:00 AM');
console.log('  - Notifications Cleanup: Sunday 2:00 AM');
console.log('  - Trial Expiry: Every minute');
console.log('  - Paid Expiry: Every minute');
console.log('  - Trial Warning: Every hour');
console.log('  - Razorpay Sync: Every 5 minutes');


console.log('[CRON]  All scheduled jobs initialized');