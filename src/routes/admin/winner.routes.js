import { Router } from 'express';
import * as winnerController from '../../controllers/admin/winner.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { upload } from '../../middleware/multer.middleware.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.post('/select/daily/:userId', asyncHandler(winnerController.selectDailyWinners));
router.get('/attempters/daily', asyncHandler(winnerController.getQuizAttempters));
router.get('/daily', asyncHandler(winnerController.getDailyWinners));

router.post('/select/weekly/:userId', asyncHandler(winnerController.selectWeeklyWinner));
router.get('/weekly', asyncHandler(winnerController.getWeeklyWinners));
router.get('/attempters/weekly', asyncHandler(winnerController.getWeeklyQuizAttempters));

// Prize management (assign/view a prize for the already-selected winner)
router.post('/daily/prize', upload.single('image'), asyncHandler(winnerController.assignDailyPrize));
router.get('/daily/prize', asyncHandler(winnerController.getDailyPrize));
router.post('/weekly/prize', upload.single('image'), asyncHandler(winnerController.assignWeeklyPrize));
router.get('/weekly/prize', asyncHandler(winnerController.getWeeklyPrize));
router.put('/prize/:prizeId', upload.single('image'), asyncHandler(winnerController.updatePrize));

export default router;