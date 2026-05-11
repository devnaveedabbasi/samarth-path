// controllers/quizAndWinners.controller.js
import DailyContent from '../models/Content.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import Prize from '../models/Prize.model.js';
import User from '../models/User.model.js';
import Subscription from '../models/Subscription.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import WinnerService from '../services/winner.service.js';
import NotificationService from '../services/notification.service.js';

/**
 * Quiz Answer Submission Controller
 * Validates and processes quiz attempts with proper error handling
 */
export async function submitQuizAnswer(req, res) {
  const userId = req.user._id;
  const { contentId, selectedOptionId, timeTakenSeconds } = req.body;

  // Validation
  if (!contentId || !selectedOptionId) {
    throw new ApiError(400, 'Content ID and selected option are required.');
  }

  // Fetch content
  const content = await DailyContent.findById(contentId);
  if (!content || content.contentType !== 'quiz') {
    throw new ApiError(404, 'Quiz content not found.');
  }

  // Check duplicate attempts
  const existingAttempt = await QuizAttempt.findOne({ userId, contentId });
  if (existingAttempt) {
    throw new ApiError(400, 'You have already submitted an answer for this quiz.');
  }

  // Check answer correctness
  const quizContent = content.quizContent;
  const isCorrect = selectedOptionId === quizContent.correctOptionId;

  // Calculate week number using service
  const { weekNumber, year } = WinnerService.getWeekInfo();

  // Save attempt
  const quiz_attempt = await QuizAttempt.create({
    userId,
    contentId,
    selectedOptionId,
    isCorrect,
    timeTakenSeconds: timeTakenSeconds || 0,
    weekNumber,
    year,
    dayNumber: new Date().getDate()
  });

  res.status(201).json(
    new ApiResponse(
      201,
      {
        attemptId: quiz_attempt._id,
        isCorrect,
        correctOptionId: quizContent.correctOptionId,
        explanation: quizContent.explanation,
        score: isCorrect ? 1 : 0
      },
      isCorrect ? 'Correct answer! ✅' : 'Incorrect answer. ❌'
    )
  );
}


export async function getWeeklyScore(req, res) {
  const userId = req.user._id;

  const weekInfo = WinnerService.getWeekInfo();

  const attempts = await QuizAttempt.find({
    userId,
    weekNumber: weekInfo.weekNumber,
    year: weekInfo.year,
  }).lean();

  const totalAttempts = attempts.length;

  const correctAnswers = attempts.filter(
    (attempt) => attempt.isCorrect
  ).length;

  const wrongAnswers = totalAttempts - correctAnswers;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        weekNumber: weekInfo.weekNumber,
        year: weekInfo.year,

        totalQuestions: totalAttempts,
        correctAnswers,
        wrongAnswers,

        score: `${correctAnswers}/${totalAttempts}`,

        accuracy:
          totalAttempts > 0
            ? ((correctAnswers / totalAttempts) * 100).toFixed(1) + "%"
            : "0%",
      },
      "Weekly score retrieved successfully."
    )
  );
}

/**
 * Get Weekly Winners (Current + Last Week)
 * Single API endpoint returning top 3 winners from both weeks
 */
export async function getWinners(req, res) {
  const winners = await WinnerService.getWinners();

  res.status(200).json(
    new ApiResponse(
      200,
      winners,
      'Weekly winners retrieved successfully.'
    )
  );
}

/**
 * Get User's Current Week Ranking
 */
export async function getUserRanking(req, res) {
  const userId = req.user._id;
  const ranking = await WinnerService.getUserRanking(userId);

  res.status(200).json(
    new ApiResponse(
      200,
      ranking,
      'User ranking retrieved successfully.'
    )
  );
}

/**
 * Get Weekly Leaderboard
 */
export async function getLeaderboard(req, res) {
  const { weekNumber, year, limit = 10 } = req.query;
  const leaderboard = await WinnerService.getLeaderboard(
    weekNumber ? parseInt(weekNumber) : null,
    year ? parseInt(year) : null,
    parseInt(limit)
  );

  res.status(200).json(
    new ApiResponse(
      200,
      leaderboard,
      'Leaderboard retrieved successfully.'
    )
  );
}

/**
 * Get Winner History (Admin/Public)
 */
export async function getWinnerHistory(req, res) {
  const { page = 1, limit = 10 } = req.query;
  const history = await WinnerService.getWinnerHistory({
    page: parseInt(page),
    limit: parseInt(limit)
  });

  res.status(200).json(
    new ApiResponse(
      200,
      history,
      'Winner history retrieved successfully.'
    )
  );
}