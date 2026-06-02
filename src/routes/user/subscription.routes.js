// routes/user/subscription.routes.js
import { Router } from 'express';
import * as subscriptionController from '../../controllers/user/subscription.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication
router.post("/razorpay-test", subscriptionController.testRazorpayOrder);
router.use(authenticateToken);
router.use(requireRole('user'));

router.post('/create-order', asyncHandler(subscriptionController.createSubscriptionOrder));
router.post('/verify-payment', asyncHandler(subscriptionController.verifyPayment));
router.get('/status', asyncHandler(subscriptionController.getSubscriptionStatus));
export default router;