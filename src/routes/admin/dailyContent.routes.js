// routes/admin/dailyContent.routes.js
import { Router } from 'express';
import * as adminDailyContentController from '../../controllers/admin/dailyContent.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// All admin routes require admin role
router.use(authenticateToken);
router.use(requireRole('admin'));

// Content creation endpoints
router.post('/text', asyncHandler(adminDailyContentController.createTextContent));
router.get('/text', asyncHandler(adminDailyContentController.getTextContent));
router.put('/text', asyncHandler(adminDailyContentController.updateTextContent));
router.delete('/text', asyncHandler(adminDailyContentController.deleteTextContent));




router.post('/quiz', asyncHandler(adminDailyContentController.createQuizContent));
router.post('/video', asyncHandler(adminDailyContentController.createVideoContent));

// Content management endpoints
router.get('/list', asyncHandler(adminDailyContentController.getDailyContentList));
router.put('/:contentId', asyncHandler(adminDailyContentController.updateContent));
router.delete('/:contentId', asyncHandler(adminDailyContentController.deleteContent));

// Prize management
router.post('/prize/create', asyncHandler(adminDailyContentController.createPrize));

// Winners calculation
router.post('/winners/calculate', asyncHandler(adminDailyContentController.calculateWeeklyWinners));

// Analytics
router.get('/:contentId/analytics', asyncHandler(adminDailyContentController.getContentAnalytics));

export default router;