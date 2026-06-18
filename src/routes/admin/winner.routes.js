import { Router } from 'express';
import * as winnerController from '../../controllers/admin/winner.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.post('/select/daily/:userId', asyncHandler(winnerController.selectDailyWinners));
router.get('/attempters/daily', asyncHandler(winnerController.getQuizAttempters));
router.get('/daily', asyncHandler(winnerController.getDailyWinners));

router.post('/select/weekly/:userId', asyncHandler(winnerController.selectWeeklyWinner));
router.get('/weekly', asyncHandler(winnerController.getWeeklyWinners));
router.get('/attempters/weekly', asyncHandler(winnerController.getWeeklyQuizAttempters));
export default router;