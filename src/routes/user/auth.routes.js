import { Router } from 'express';
import * as userAuth from '../../controllers/user/auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { upload } from '../../middleware/multer.middleware.js';

const router = Router();

router.post('/register', asyncHandler(userAuth.register));
router.post('/verify-phone', asyncHandler(userAuth.verifyPhone));
router.post('/verify-email', asyncHandler(userAuth.verifyPhone)); 
router.post('/resend-otp', asyncHandler(userAuth.resendOtp));
router.post('/login', asyncHandler(userAuth.login));
router.post('/forgot-password', asyncHandler(userAuth.forgotPassword));
router.post('/verify-reset-otp', asyncHandler(userAuth.verifyResetOtp));
router.post('/set-new-password', asyncHandler(userAuth.setNewPassword));
router.post('/change-password', authenticateToken, requireRole('user'), asyncHandler(userAuth.changePassword));

router.put('/update-profile', authenticateToken, requireRole('user'),upload.single('profilePicture'), asyncHandler(userAuth.updateProfile));
router.get('/me', authenticateToken, requireRole('user'), asyncHandler(userAuth.me));

export default router;
