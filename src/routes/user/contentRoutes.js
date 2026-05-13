// routes/dailyContent.routes.js
import { Router } from 'express';
import * as dailyContentController from '../../controllers/user/content.controller.js';
import * as quizAndWinnersController from '../../controllers/quizAndWinners.controller.js';
import * as bookmarkAndArchiveController from '../../controllers/bookmarkAndArchive.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole, checkSubscription } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication and active subscription
router.use(authenticateToken);
router.use(requireRole('user'));
router.use(checkSubscription);

router.get('/', asyncHandler(dailyContentController.getContent));


router.post('/quiz/submit', asyncHandler(quizAndWinnersController.submitQuizAnswer));
router.get('/quiz/weekly-score', asyncHandler(quizAndWinnersController.getWeeklyScore));
router.get('/quiz/weekly-winners', asyncHandler(quizAndWinnersController.getWeeklyWinners));

// Like endpoints
router.post('/like', asyncHandler(dailyContentController.likeContent));
router.post('/unlike', asyncHandler(dailyContentController.unlikeContent));

// Comment endpoints
router.post('/comment', asyncHandler(dailyContentController.addComment));
router.get('/comments/:contentId', asyncHandler(dailyContentController.getComments));
router.delete('/comment', asyncHandler(dailyContentController.deleteComment));

// Bookmark endpoints
router.post('/bookmark', asyncHandler(bookmarkAndArchiveController.bookmarkContent));
router.post('/remove-bookmark', asyncHandler(bookmarkAndArchiveController.removeBookmark));
router.get('/bookmarks', asyncHandler(bookmarkAndArchiveController.getBookmarks));


router.get('/archive/by-date', asyncHandler(dailyContentController.getArchiveByDate));
router.get('/:contentId', asyncHandler(dailyContentController.getContentById));

export default router;