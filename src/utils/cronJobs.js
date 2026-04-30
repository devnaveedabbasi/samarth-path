import cron from 'node-cron';
import moment from 'moment-timezone';
import Content from '../models/Content.model.js';
import { announceWeeklyWinners } from '../services/winner.service.js';


let isProcessing = false;

cron.schedule('* * * * *', async () => {

    console.log("cron running");
    
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
        console.log(`[SUCCESS] Unlocking ${content.contentType}: ${content.textContent?.title}`);
        
        content.isNotified = true;
        await content.save();
        
        // TODO: Notify users via WebSocket or Push Notification
      }
    }
  } catch (error) {
    console.error("[CRON ERROR]:", error);
  } finally {
    isProcessing = false; 
  }
}, {
  scheduled: true,
  timezone: "Asia/Karachi"
});


//  WINNER ANNOUNCEMENT CRON - every Sunday at 12:00 AM (Karachi Time)
cron.schedule('0 0 * * 0', async () => {
    console.log("Running Weekly Winner Cron...");
    await announceWeeklyWinners();
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});