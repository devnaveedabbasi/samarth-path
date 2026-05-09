// controllers/quizAndWinners.controller.js
import DailyContent from '../models/Content.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import Prize from '../models/Prize.model.js';
import User from '../models/User.model.js';
import Subscription from '../models/Subscription.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

// Helper function to get ISO week number
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

export async function submitQuizAnswer(req, res) {
  const userId = req.user._id;
  const { contentId, selectedOptionId, timeTakenSeconds } = req.body;
  console.log('Quiz submission:', { userId, contentId, selectedOptionId, timeTakenSeconds });
  if (!contentId || !selectedOptionId) {
    throw new ApiError(400, 'Content ID and selected option are required.');
  }

  const content = await DailyContent.findById(contentId);
  if (!content || content.contentType !== 'quiz') {
    throw new ApiError(404, 'Quiz content not found.');
  }

  // Check if user already attempted this quiz
  const existingAttempt = await QuizAttempt.findOne({ userId, contentId });
  if (existingAttempt) {
    throw new ApiError(400, 'You have already submitted an answer for this quiz.');
  }

  const quizContent = content.quizContent;
  const isCorrect = selectedOptionId === quizContent.correctOptionId;

  const now = new Date();
  const weekNumber = getWeekNumber(now);
  const year = now.getFullYear();

  const quiz_attempt = await QuizAttempt.create({
    userId,
    contentId,
    selectedOptionId,
    isCorrect,
    timeTakenSeconds: timeTakenSeconds || 0,
    weekNumber,
    year,
    dayNumber: now.getDate()
  });

  res.status(201).json(
    new ApiResponse(
      201,
      {
        attemptId: quiz_attempt._id,
        isCorrect,
        correctOptionId: quizContent.correctOptionId,
        explanation: quizContent.explanation
      },
      isCorrect ? 'Correct answer!' : 'Incorrect answer.'
    )
  );
}

export async function getWeeklyScore(req, res) {
  const userId = req.user._id;
  const now = new Date();
  const weekNumber = getWeekNumber(now);
  const year = now.getFullYear();

  const attempts = await QuizAttempt.find({
    userId,
    weekNumber,
    year
  });

  const correctCount = attempts.filter(a => a.isCorrect).length;
  const totalCount = attempts.length;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        weekNumber,
        year,
        correctAnswers: correctCount,
        totalAttempts: totalCount,
        score: correctCount,
        streak: totalCount > 0 ? correctCount : 0
      },
      'Weekly score retrieved successfully.'
    )
  );
}

export async function getWeeklyWinners(req, res) {
  const { limit = 10 } = req.query;
  const now = new Date();
  const weekNumber = getWeekNumber(now);
  const year = now.getFullYear();

  // Get prize for this week
  const prize = await Prize.findOne({
    weekNumber,
    year,
    prizeType: 'weekly'
  });

  // Get winners
  const winners = await Winner.find({
    weekNumber,
    year,
    cycleType: 'weekly'
  })
    .populate('userId', 'name')
    .sort({ rank: 1 })
    .limit(parseInt(limit));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        prize: prize ? {
          title: prize.title,
          description: prize.description,
          imageUrl: prize.imageUrl
        } : null,
        winners,
        weekNumber,
        year
      },
      'Weekly winners retrieved successfully.'
    )
  );
}

export async function getPreviousWeekWinners(req, res) {
  const { week, year, limit = 10 } = req.query;
  
  if (!week || !year) {
    throw new ApiError(400, 'Week and year parameters are required.');
  }

  const prize = await Prize.findOne({
    weekNumber: parseInt(week),
    year: parseInt(year),
    prizeType: 'weekly'
  });

  const winners = await Winner.find({
    weekNumber: parseInt(week),
    year: parseInt(year),
    cycleType: 'weekly'
  })
    .populate('userId', 'name')
    .sort({ rank: 1 })
    .limit(parseInt(limit));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        prize: prize ? {
          title: prize.title,
          description: prize.description,
          imageUrl: prize.imageUrl
        } : null,
        winners,
        week,
        year
      },
      'Previous week winners retrieved successfully.'
    )
  );
}

// Admin function to calculate and create winners
export async function calculateWeeklyWinners(req, res) {
  const { weekNumber, year } = req.body;

  if (!weekNumber || !year) {
    throw new ApiError(400, 'Week number and year are required.');
  }

  // Get all quiz attempts for the week, grouped by user
  const attempts = await QuizAttempt.aggregate([
    {
      $match: { weekNumber, year }
    },
    {
      $group: {
        _id: '$userId',
        correctAnswers: {
          $sum: { $cond: ['$isCorrect', 1, 0] }
        },
        totalAttempts: { $sum: 1 }
      }
    },
    {
      $sort: { correctAnswers: -1, totalAttempts: 1 }
    }
  ]);

  // Delete existing winners for this week (in case we're recalculating)
  await Winner.deleteMany({ weekNumber, year, cycleType: 'weekly' });

  // Create winners (top 10 by default, configurable via env or settings)
  const maxWinners = process.env.MAX_WEEKLY_WINNERS || 10;
  const winners = [];

  for (let i = 0; i < Math.min(attempts.length, maxWinners); i++) {
    const attempt = attempts[i];
    const winner = await Winner.create({
      userId: attempt._id,
      rank: i + 1,
      score: attempt.correctAnswers,
      weekNumber,
      year,
      cycleType: 'weekly'
    });
    winners.push(winner);
  }

  res.status(201).json(
    new ApiResponse(
      201,
      winners,
      `${winners.length} winners created for week ${weekNumber}, ${year}.`
    )
  );
}