import { Router } from 'express';
import * as consultantController from '../../controllers/user/consultant.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken);
router.use(requireRole('user'));

router.post('/', asyncHandler(consultantController.submitConsultation));
router.get('/', asyncHandler(consultantController.getMyConsultations));
router.put('/:consultationId', asyncHandler(consultantController.editConsultation));
router.delete('/:consultationId', asyncHandler(consultantController.deleteConsultation));

export default router;