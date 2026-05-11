// routes/admin/user.routes.js
import { Router } from 'express';
import * as userController from '../../controllers/admin/user.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken);
router.use(requireRole('admin'));

router.get('/stats',             asyncHandler(userController.getUserStats));
router.get('/',                  asyncHandler(userController.AllUsers));
router.get('/:userId',           asyncHandler(userController.getUserById));
router.put('/:userId/status',    asyncHandler(userController.updateUserStatus));
router.delete('/:userId',        asyncHandler(userController.deleteUser));

export default router;