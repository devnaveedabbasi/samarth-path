import { Router } from 'express';
import * as consultantController from '../../controllers/admin/consultant.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);
router.use(requireRole('admin'));

router.post('/', asyncHandler(consultantController.replyConsultation));
router.get('/', asyncHandler(consultantController.getAllConsultations));
router.put('/:consultationId', asyncHandler(consultantController.updateReply));
router.delete('/:consultationId', asyncHandler(consultantController.deleteConsultation));
export default router;