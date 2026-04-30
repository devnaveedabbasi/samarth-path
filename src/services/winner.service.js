import moment from 'moment';
import QuizAttempt from '../models/QuizAttempt.model.js';

// import WinnerRecord from '../models/WinnerRecord.model.js'; // Agar model banaya hai

export const announceWeeklyWinners = async () => {
    try {
        console.log("Starting Winner Announcement Process...");
        
        // Pichle hafte ka number (kyunki raat 12 baje naya hafta shuru ho jata hai)
        const lastWeek = moment().subtract(1, 'days').isoWeek();
        const year = moment().year();

        const top10 = await QuizAttempt.aggregate([
            { 
                $match: { 
                    weekNumber: lastWeek, 
                    year: year, 
                    isCorrect: true 
                } 
            },
            { 
                $group: { 
                    _id: "$userId", 
                    totalScore: { $sum: 1 }, 
                    totalTime: { $sum: "$timeTakenSeconds" } 
                }
            },
            { 
                $sort: { 
                    totalScore: -1, // Highest Score
                    totalTime: 1,    // Fastest Time (Tie-breaker)
                    _id: 1           // Extra safety
                } 
            },
            { $limit: 10 }
        ]);

        if (top10.length === 0) {
            console.log("No participants found for week:", lastWeek);
            return;
        }

        // Yahan aap apna WinnerRecord model save karein ya sirf console karein filhal
        console.log(`Winners for Week ${lastWeek}:`, top10);
        
        // Agar aapne notification system banaya hai to yahan call karein
        // sendWinnerNotification(top10);

    } catch (error) {
        console.error("Error in announceWeeklyWinners:", error);
    }
};