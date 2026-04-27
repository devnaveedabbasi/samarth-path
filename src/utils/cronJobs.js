import cron from 'node-cron';
import moment from 'moment-timezone';
import Content from '../models/Content.model.js';

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