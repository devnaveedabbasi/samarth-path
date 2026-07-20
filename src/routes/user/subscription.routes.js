// routes/user/subscription.routes.js
import { Router } from 'express';
import * as subscriptionController from '../../controllers/user/subscription.controller.js';
import * as subscriptionRecurringController from '../../controllers/user/subscriptionRecurring.controller.js';
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

// Recurring auto-debit subscription (Razorpay Subscriptions API / UPI AutoPay)
router.post('/recurring/create', asyncHandler(subscriptionRecurringController.createRecurringSubscription));
router.post('/recurring/verify', asyncHandler(subscriptionRecurringController.verifyRecurringSubscription));
router.post('/recurring/cancel', asyncHandler(subscriptionRecurringController.cancelRecurringSubscription));
router.get('/recurring/status', asyncHandler(subscriptionRecurringController.getRecurringSubscriptionStatus));

export default router;