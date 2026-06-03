// routes/user/subscription.routes.js
import { Router } from 'express';
import * as subscriptionController from '../../controllers/user/subscription.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// Razorpay webhook — NO auth required (Razorpay calls this directly)
// Signature is verified inside the controller
router.post('/webhook', asyncHandler(subscriptionController.razorpayWebhook));

// All routes below require authentication
router.use(authenticateToken);
router.use(requireRole('user'));

router.post('/create-order', asyncHandler(subscriptionController.createSubscriptionOrder));
router.post('/verify-payment', asyncHandler(subscriptionController.verifyPayment));
router.get('/status', asyncHandler(subscriptionController.getSubscriptionStatus));
router.get('/payment-history', asyncHandler(subscriptionController.getPaymentHistory));

export default router;