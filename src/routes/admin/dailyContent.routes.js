// routes/admin/dailyContent.routes.js
import { Router } from 'express';
import * as adminDailyContentController from '../../controllers/admin/dailyContent.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { upload } from '../../middleware/multer.middleware.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

// TEXT ROUTES
router.post('/text', upload.single('image'), asyncHandler(adminDailyContentController.createTextContent));
router.get('/text', asyncHandler(adminDailyContentController.getTextContent));
router.get('/text/:id', asyncHandler(adminDailyContentController.getContentById));
router.put('/text/:contentId', upload.single('image'), asyncHandler(adminDailyContentController.updateTextContent));
router.delete('/text/:contentId', asyncHandler(adminDailyContentController.deleteTextContent));


// QUIZ ROUTES
router.post('/quiz', asyncHandler(adminDailyContentController.createQuizContent));
router.get('/quiz', asyncHandler(adminDailyContentController.getQuizzes));
router.get('/quiz/:contentId', asyncHandler(adminDailyContentController.getQuizById));
router.put('/quiz/:contentId', asyncHandler(adminDailyContentController.updateQuizContent));
router.delete('/quiz/:contentId', asyncHandler(adminDailyContentController.deleteQuizContent));
router.get('/quiz/:contentId/attempts', asyncHandler(adminDailyContentController.getQuizAttempts));


// VIDEO ROUTES
router.post("/video",  upload.fields([{ name: "video", maxCount: 1 }, { name: "image", maxCount: 1 }]), asyncHandler(adminDailyContentController.createVideoContent));
router.get('/video', asyncHandler(adminDailyContentController.getAllVideoContent));
router.get('/video/:contentId', asyncHandler(adminDailyContentController.getVideoById));
router.put('/video/:contentId', upload.fields([{ name: "video", maxCount: 1 }, { name: "image", maxCount: 1 }]), asyncHandler(adminDailyContentController.updateVideoContent));
// router.delete('/video/:contentId', asyncHandler(adminDailyContentController.deleteVideoContent));


// Content management endpoints
// router.get('/list', asyncHandler(adminDailyContentController.getDailyContentList));
// router.put('/:contentId', asyncHandler(adminDailyContentController.updateContent));
// router.delete('/:contentId', asyncHandler(adminDailyContentController.deleteContent));

// Prize management
router.post('/prize/create', asyncHandler(adminDailyContentController.createPrize));
router.post('/winners/calculate', asyncHandler(adminDailyContentController.calculateWeeklyWinners));
router.get('/:contentId/analytics', asyncHandler(adminDailyContentController.getContentAnalytics));

export default router;