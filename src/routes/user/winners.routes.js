// routes/user/winners.routes.js
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware } from '../../middleware/auth.js';
import {
  getWinners,
  getWeeklyScore
} from '../../controllers/quizAndWinners.controller.js';
import WinnerService from '../../services/winner.service.js';
const router = Router();
router.use(authMiddleware);
// Public routes
router.get('/', asyncHandler(getWinners));
router.get('/score',asyncHandler(getWeeklyScore));

// routes/admin.routes.js mein add karo — temporarily
router.post('/announce-winners', async (req, res) => {
  try {
    const result = await WinnerService.announceWeeklyWinners();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
export default router;
