// routes/user/winners.routes.js
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  getWinners,
  getUserRanking,
  getLeaderboard,
  getWinnerHistory,
  getWeeklyScore
} from '../../controllers/quizAndWinners.controller.js';

const router = Router();
router.use(authMiddleware);
// Public routes
router.get('/', asyncHandler(getWinners));
router.get('/score',asyncHandler(getWeeklyScore));
router.get('/leaderboard', asyncHandler(getLeaderboard));
router.get('/history', asyncHandler(getWinnerHistory));

// Protected routes
router.get('/my-ranking', asyncHandler(getUserRanking));

export default router;
