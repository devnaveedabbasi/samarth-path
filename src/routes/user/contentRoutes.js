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

// Archive management endpoints
router.post('/archive', asyncHandler(dailyContentController.archiveContent));
router.post('/unarchive', asyncHandler(dailyContentController.unarchiveContent));

// Quiz endpoints - User can submit answers and view scores
router.post('/quiz/submit', asyncHandler(quizAndWinnersController.submitQuizAnswer));
router.get('/quiz/weekly-score', asyncHandler(quizAndWinnersController.getWeeklyScore));

// Winners endpoints - User can view winners
router.get('/winners/weekly', asyncHandler(quizAndWinnersController.getWeeklyWinners));
router.get('/winners/previous-week', asyncHandler(quizAndWinnersController.getPreviousWeekWinners));

// Archive & Calendar viewing endpoints
router.get('/archive/calendar', asyncHandler(bookmarkAndArchiveController.getArchiveCalendar));
router.get('/archive/date/:date', asyncHandler(bookmarkAndArchiveController.getArchivedContentByDate));

export default router;