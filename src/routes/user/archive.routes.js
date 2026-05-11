// routes/user/archive.routes.js
import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getArchiveByDate,
  getArchiveByDateRange,
} from '../../controllers/archive.controller.js';
import { authMiddleware } from '../../middleware/auth.js';

const router = Router();
router.use(authMiddleware);
router.get('/by-date', asyncHandler(getArchiveByDate));
router.get('/by-range', asyncHandler(getArchiveByDateRange));

export default router;
