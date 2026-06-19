import QuizAttempt from '../../models/quizAttempt.model.js';
import Winner from '../../models/Winner.model.js';
import User from '../../models/User.model.js';
import mongoose from 'mongoose';
import NotificationService from '../../services/notification.service.js';


export const getQuizAttempters = async (req, res) => {
    try {
        const today = new Date();
        const startOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
        );

        const endOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() + 1
        );

        // Leaderboard aggregation - ONLY users with correct answers
        const leaderboard = await QuizAttempt.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: startOfDay,
                        $lt: endOfDay
                    }
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalQuestions: { $sum: 1 },
                    correctAnswers: {
                        $sum: { $cond: ['$isCorrect', 1, 0] }
                    },
                    totalTime: { $sum: '$timeTakenSeconds' },
                    firstAttemptAt: { $min: '$createdAt' }
                }
            },
            {
                // FILTER: Only keep users with at least 1 correct answer
                $match: {
                    correctAnswers: { $gt: 0 }
                }
            },
            {
                $addFields: {
                    accuracy: {
                        $multiply: [
                            { $divide: ['$correctAnswers', '$totalQuestions'] },
                            100
                        ]
                    }
                }
            },
            {
                $sort: {
                    correctAnswers: -1,
                    accuracy: -1,
                    totalTime: 1,
                    firstAttemptAt: 1
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' }
        ]);

        // Format leaderboard with rank
        const formattedLeaderboard = leaderboard.map((item, index) => ({
            rank: index + 1,
            userId: item._id,
            name: item.user.name,
            email: item.user.email,
            profilePicture: item.user.profilePicture || null,
            stats: {
                totalQuestions: item.totalQuestions,
                correctAnswers: item.correctAnswers,
                accuracy: item.accuracy,
                totalTime: item.totalTime,
                firstAttemptAt: item.firstAttemptAt
            }
        }));

        // ✅ Check if a winner has been officially selected for today
        const officialWinner = await Winner.findOne({
            cycleType: 'daily',
            winnerDate: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        }).populate('userId', 'name email profilePicture');

        let winner = null;
        if (officialWinner) {
            // ✅ Find the winner's stats from the leaderboard
            const winnerStats = leaderboard.find(
                (item) => item._id.toString() === officialWinner.userId._id.toString()
            );

            if (winnerStats) {
                winner = {
                    rank: 1,
                    userId: officialWinner.userId._id,
                    name: officialWinner.userId.name,
                    email: officialWinner.userId.email,
                    profilePicture: officialWinner.userId.profilePicture || null,
                    stats: {
                        totalQuestions: winnerStats.totalQuestions,
                        correctAnswers: winnerStats.correctAnswers,
                        accuracy: winnerStats.accuracy,
                        totalTime: winnerStats.totalTime,
                        firstAttemptAt: winnerStats.firstAttemptAt
                    }
                };
            }
        }
        // If no official winner, winner remains null

        // Get correct attempts
        const correctAttempts = await QuizAttempt.find({
            isCorrect: true,
            createdAt: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        })
            .populate('userId', 'name email')
            .sort({ createdAt: 1 });

        // Format correct attempts
        const formattedAttempts = correctAttempts.map(attempt => ({
            attemptId: attempt._id,
            user: {
                id: attempt.userId._id,
                name: attempt.userId.name,
                email: attempt.userId.email
            },
            quizId: attempt.contentId,
            selectedOption: attempt.selectedOptionId,
            isCorrect: attempt.isCorrect,
            timeTaken: attempt.timeTakenSeconds,
            attemptedAt: attempt.createdAt
        }));

        res.status(200).json({
            success: true,
            data: {
                winner,
                leaderboard: formattedLeaderboard,
                correctAttempts: formattedAttempts,
                totalUsers: formattedLeaderboard.length // ✅ ADD THIS LINE
            }
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const selectDailyWinners = async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate userId
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const today = new Date();
        const startOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate()
        );

        const endOfDay = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate() + 1
        );

        // Check if winner already exists for today
        const existingWinner = await Winner.findOne({
            cycleType: 'daily',
            winnerDate: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        });

        if (existingWinner) {
            return res.status(400).json({
                success: false,
                message: 'Today winner already selected'
            });
        }

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get user's stats for today
        const userStats = await QuizAttempt.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    createdAt: {
                        $gte: startOfDay,
                        $lt: endOfDay
                    }
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalQuestions: { $sum: 1 },
                    correctAnswers: {
                        $sum: { $cond: ['$isCorrect', 1, 0] }
                    },
                    totalTime: { $sum: '$timeTakenSeconds' },
                    firstAttemptAt: { $min: '$createdAt' }
                }
            },
            {
                $addFields: {
                    accuracy: {
                        $multiply: [
                            { $divide: ['$correctAnswers', '$totalQuestions'] },
                            100
                        ]
                    }
                }
            }
        ]);

        // Check if user has any attempts today
        if (userStats.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'User has no quiz attempts today'
            });
        }

        const stats = userStats[0];

        // Helper function to get week number
        const getWeekNumber = (date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
            const week1 = new Date(d.getFullYear(), 0, 4);
            return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        };

        // ✅ Create winner entry with ONLY fields that exist in model
        const winner = await Winner.create({
            userId: userId,
            rank: 1,
            score: stats.correctAnswers,
            cycleType: 'daily',
            winnerDate: new Date(),
            year: today.getFullYear(),
            weekNumber: getWeekNumber(today)
        });

        // 🔔 Send Daily Winner Notification
        try {
            await NotificationService.sendDailyWinnerNotification(
                userId,
                1, // rank
                stats.correctAnswers, // score
                today.getDate(), // day number
                today.getMonth() + 1, // month (0-indexed)
                today.getFullYear() // year
            );
            console.log(`✅ Daily winner notification sent to user: ${userId}`);
        } catch (notificationError) {
            console.error('Error sending daily winner notification:', notificationError);
        }

        // Populate user details for response
        const populatedWinner = await Winner.findById(winner._id)
            .populate('userId', 'name email profilePicture');

        res.status(201).json({
            success: true,
            message: 'Daily winner selected successfully',
            data: {
                winner: {
                    id: populatedWinner._id,
                    userId: populatedWinner.userId._id,
                    name: populatedWinner.userId.name,
                    email: populatedWinner.userId.email,
                    profilePicture: populatedWinner.userId.profilePicture || null,
                    stats: {
                        totalQuestions: stats.totalQuestions,
                        correctAnswers: stats.correctAnswers,
                        accuracy: stats.accuracy,
                        totalTime: stats.totalTime,
                        firstAttemptAt: stats.firstAttemptAt
                    },
                    selectedAt: populatedWinner.winnerDate
                }
            }
        });

    } catch (error) {
        console.error('Error selecting daily winner:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

export const getDailyWinners = async (req, res) => {
    try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const dailyWinner = await Winner.findOne({
            cycleType: 'daily',
            winnerDate: {
                $gte: start,
                $lte: end
            }
        }).populate('userId', 'name email');

        if (!dailyWinner) {
            return res.status(404).json({
                success: false,
                message: 'No daily winner found for today'
            });
        }

        res.status(200).json({
            success: true,
            dailyWinner
        });
    } catch (error) {
        console.error('Error fetching daily winner:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};


export const getWeeklyQuizAttempters = async (req, res) => {
    try {
        const today = new Date();

        // 📅 Week Start = Monday (00:00)
        const startOfWeek = new Date(today);
        const day = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
        startOfWeek.setDate(diff);
        startOfWeek.setHours(0, 0, 0, 0);

        // 📅 Week End = Sunday (23:59)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
        endOfWeek.setHours(23, 59, 59, 999);

        console.log(`📅 Week: ${startOfWeek} to ${endOfWeek}`);

        // Leaderboard aggregation - SIRF is week ke attempts
        const leaderboard = await QuizAttempt.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: startOfWeek,
                        $lte: endOfWeek
                    }
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalQuestions: { $sum: 1 },
                    correctAnswers: {
                        $sum: { $cond: ['$isCorrect', 1, 0] }
                    },
                    totalTime: { $sum: '$timeTakenSeconds' },
                    firstAttemptAt: { $min: '$createdAt' }
                }
            },
            {
                // FILTER: Only keep users with at least 1 correct answer
                $match: {
                    correctAnswers: { $gt: 0 }
                }
            },
            {
                $addFields: {
                    accuracy: {
                        $multiply: [
                            { $divide: ['$correctAnswers', '$totalQuestions'] },
                            100
                        ]
                    }
                }
            },
            {
                $sort: {
                    correctAnswers: -1,
                    accuracy: -1,
                    totalTime: 1,
                    firstAttemptAt: 1
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' }
        ]);

        // Format leaderboard with rank
        const formattedLeaderboard = leaderboard.map((item, index) => ({
            rank: index + 1,
            userId: item._id,
            name: item.user.name,
            email: item.user.email,
            profilePicture: item.user.profilePicture || null,
            stats: {
                totalQuestions: item.totalQuestions,
                correctAnswers: item.correctAnswers,
                accuracy: item.accuracy,
                totalTime: item.totalTime,
                firstAttemptAt: item.firstAttemptAt
            }
        }));

        // ✅ FIX: Check if a winner has been officially selected for this week
        const getWeekNumber = (date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
            const week1 = new Date(d.getFullYear(), 0, 4);
            return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        };

        const weekNumber = getWeekNumber(today);
        const year = today.getFullYear();

        // Check Winner collection for officially selected winner
        const officialWinner = await Winner.findOne({
            cycleType: 'weekly',
            weekNumber: weekNumber,
            year: year
        }).populate('userId', 'name email profilePicture');

        let winner = null;
        if (officialWinner) {
            // If official winner exists, format it
            winner = {
                rank: 1,
                userId: officialWinner.userId._id,
                name: officialWinner.userId.name,
                email: officialWinner.userId.email,
                profilePicture: officialWinner.userId.profilePicture || null,
                stats: {
                    totalQuestions: officialWinner.totalQuestions,
                    correctAnswers: officialWinner.score,
                    accuracy: officialWinner.accuracy,
                    totalTime: officialWinner.totalTime,
                    firstAttemptAt: officialWinner.winnerDate
                }
            };
        }
        // If no official winner, winner remains null

        // Get correct attempts for this week
        const correctAttempts = await QuizAttempt.find({
            isCorrect: true,
            createdAt: {
                $gte: startOfWeek,
                $lte: endOfWeek
            }
        })
            .populate('userId', 'name email')
            .sort({ createdAt: 1 });

        // Format correct attempts
        const formattedAttempts = correctAttempts.map(attempt => ({
            attemptId: attempt._id,
            user: {
                id: attempt.userId._id,
                name: attempt.userId.name,
                email: attempt.userId.email
            },
            quizId: attempt.contentId,
            selectedOption: attempt.selectedOptionId,
            isCorrect: attempt.isCorrect,
            timeTaken: attempt.timeTakenSeconds,
            attemptedAt: attempt.createdAt
        }));

        res.status(200).json({
            success: true,
            data: {
                week: {
                    start: startOfWeek,
                    end: endOfWeek,
                    weekNumber: weekNumber,
                    year: year
                },
                winner, // ✅ Now only shows officially selected winner, or null
                leaderboard: formattedLeaderboard,
                correctAttempts: formattedAttempts,
                totalUsers: formattedLeaderboard.length
            }
        });
    } catch (error) {
        console.error('Error fetching weekly leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};


export const selectWeeklyWinner = async (req, res) => {
    try {
        const { userId } = req.params;

        // Validate userId
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const today = new Date();
        const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

        // ⛔ CHECK: Only allow winner selection on Monday
        if (currentDay !== 1) {
            return res.status(400).json({
                success: false,
                message: 'Weekly winner can only be selected on Monday after the week is complete'
            });
        }

        // Get previous week's start (Monday) and end (Sunday)
        const prevWeekStart = new Date(today);
        prevWeekStart.setDate(today.getDate() - 7); // Previous Monday
        prevWeekStart.setHours(0, 0, 0, 0);

        const prevWeekEnd = new Date(today);
        prevWeekEnd.setDate(today.getDate() - 1); // Previous Sunday
        prevWeekEnd.setHours(23, 59, 59, 999);

        console.log(`📅 Selecting winner for week: ${prevWeekStart} to ${prevWeekEnd}`);

        // Check if winner already exists for previous week
        const existingWinner = await Winner.findOne({
            cycleType: 'weekly',
            winnerDate: {
                $gte: prevWeekStart,
                $lte: prevWeekEnd
            }
        });

        if (existingWinner) {
            return res.status(400).json({
                success: false,
                message: 'Weekly winner already selected for this week'
            });
        }

        // Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get user's stats for previous week
        const userStats = await QuizAttempt.aggregate([
            {
                $match: {
                    userId: new mongoose.Types.ObjectId(userId),
                    createdAt: {
                        $gte: prevWeekStart,
                        $lte: prevWeekEnd
                    }
                }
            },
            {
                $group: {
                    _id: '$userId',
                    totalQuestions: { $sum: 1 },
                    correctAnswers: {
                        $sum: { $cond: ['$isCorrect', 1, 0] }
                    },
                    totalTime: { $sum: '$timeTakenSeconds' },
                    firstAttemptAt: { $min: '$createdAt' }
                }
            },
            {
                $addFields: {
                    accuracy: {
                        $multiply: [
                            { $divide: ['$correctAnswers', '$totalQuestions'] },
                            100
                        ]
                    }
                }
            }
        ]);

        // Check if user has any attempts in previous week
        if (userStats.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'User has no quiz attempts in the previous week'
            });
        }

        const stats = userStats[0];

        // Helper function to get week number
        const getWeekNumber = (date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
            const week1 = new Date(d.getFullYear(), 0, 4);
            return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        };

        // Create winner entry with required fields
        const winner = await Winner.create({
            userId: userId,
            rank: 1,
            score: stats.correctAnswers,
            totalQuestions: stats.totalQuestions,
            accuracy: stats.accuracy,
            totalTime: stats.totalTime,
            cycleType: 'weekly',
            winnerDate: new Date(),
            year: prevWeekStart.getFullYear(),
            weekNumber: getWeekNumber(prevWeekStart),
            dayNumber: prevWeekStart.getDate()
        });

        // 🔔 Send Weekly Winner Notification
        try {
            await NotificationService.sendWeeklyWinnerNotification(
                userId,
                1, // rank
                stats.correctAnswers, // score
                getWeekNumber(prevWeekStart), // week number
                prevWeekStart.getFullYear() // year
            );
            console.log(`✅ Weekly winner notification sent to user: ${userId}`);
        } catch (notificationError) {
            console.error('Error sending weekly winner notification:', notificationError);
            // Don't fail the request if notification fails
        }

        // Populate user details for response
        const populatedWinner = await Winner.findById(winner._id)
            .populate('userId', 'name email profilePicture');

        res.status(201).json({
            success: true,
            message: 'Weekly winner selected successfully',
            data: {
                winner: {
                    id: populatedWinner._id,
                    userId: populatedWinner.userId._id,
                    name: populatedWinner.userId.name,
                    email: populatedWinner.userId.email,
                    profilePicture: populatedWinner.userId.profilePicture || null,
                    stats: {
                        totalQuestions: populatedWinner.totalQuestions,
                        correctAnswers: populatedWinner.score,
                        accuracy: populatedWinner.accuracy,
                        totalTime: populatedWinner.totalTime
                    },
                    selectedAt: populatedWinner.winnerDate,
                    weekNumber: populatedWinner.weekNumber,
                    year: populatedWinner.year,
                    weekRange: {
                        start: prevWeekStart,
                        end: prevWeekEnd
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error selecting weekly winner:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};


export const getWeeklyWinners = async (req, res) => {
    try {
        const { year, weekNumber, all } = req.query;

        // If 'all' is true, return all weekly winners
        if (all === 'true') {
            const query = { cycleType: 'weekly' };

            if (year) query.year = parseInt(year);
            if (weekNumber) query.weekNumber = parseInt(weekNumber);

            const weeklyWinners = await Winner.find(query)
                .populate('userId', 'name email profilePicture')
                .sort({ winnerDate: -1 });

            const formattedWinners = weeklyWinners.map(winner => ({
                id: winner._id,
                userId: winner.userId._id,
                name: winner.userId.name,
                email: winner.userId.email,
                profilePicture: winner.userId.profilePicture || null,
                stats: {
                    correctAnswers: winner.score,
                },
                weekNumber: winner.weekNumber,
                year: winner.year,
                selectedAt: winner.winnerDate
            }));

            return res.status(200).json({
                success: true,
                data: {
                    count: formattedWinners.length,
                    winners: formattedWinners
                }
            });
        }

        // Otherwise, return only current week's winner
        const today = new Date();

        // Get start of current week (Monday)
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay() + 1);
        startOfWeek.setHours(0, 0, 0, 0);

        // Get end of current week (Sunday)
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() - today.getDay() + 7);
        endOfWeek.setHours(23, 59, 59, 999);

        const weeklyWinner = await Winner.findOne({
            cycleType: 'weekly',
            winnerDate: {
                $gte: startOfWeek,
                $lte: endOfWeek
            }
        }).populate('userId', 'name email profilePicture');

        if (!weeklyWinner) {
            return res.status(404).json({
                success: false,
                message: 'No weekly winner found for this week'
            });
        }

        res.status(200).json({
            success: true,
            data: {
                week: {
                    start: startOfWeek,
                    end: endOfWeek,
                    weekNumber: weeklyWinner.weekNumber,
                    year: weeklyWinner.year
                },
                winner: {
                    id: weeklyWinner._id,
                    userId: weeklyWinner.userId._id,
                    name: weeklyWinner.userId.name,
                    email: weeklyWinner.userId.email,
                    profilePicture: weeklyWinner.userId.profilePicture || null,
                    stats: {
                        totalQuestions: weeklyWinner.totalQuestions,
                        correctAnswers: weeklyWinner.score,
                        accuracy: weeklyWinner.accuracy,
                        totalTime: weeklyWinner.totalTime
                    },
                    selectedAt: weeklyWinner.winnerDate
                }
            }
        });
    } catch (error) {
        console.error('Error fetching weekly winner:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};


// ==========================================
// HELPER: Get Week Number
// ==========================================

const getWeekNumber = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
};