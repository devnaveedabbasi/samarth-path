// routes/admin/prize.routes.js
import { Router } from 'express';
import * as prizeController from '../../controllers/admin/prize.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { upload } from '../../middleware/multer.middleware.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

// Weekly prizes are created here directly (Daily prizes are created via the
// quiz flow — see /api/admin/daily-content/quiz/:contentId/prize)
router.get('/current-week', asyncHandler(prizeController.getCurrentWeek));
router.post('/weekly', upload.single('image'), asyncHandler(prizeController.createWeeklyPrize));
router.get('/daily', asyncHandler(prizeController.getDailyPrizes));
router.get('/weekly', asyncHandler(prizeController.getWeeklyPrizes));
router.put('/:prizeId', upload.single('image'), asyncHandler(prizeController.updatePrize));
router.delete('/:prizeId', asyncHandler(prizeController.deletePrize));

export default router;
