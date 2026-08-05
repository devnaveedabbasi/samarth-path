// routes/user/subscription.routes.js
import { Router } from 'express';
import * as subscriptionRecurringController from '../../controllers/user/subscriptionRecurring.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// Razorpay webhook — NO auth required (Razorpay calls this directly)
// Signature is verified inside the controller
// router.post('/webhook', asyncHandler(subscriptionRecurringController.razorpayWebhook));

router.post('/webhook', asyncHandler((req, res) => {
    res.send("webhookworking");
}));
// All routes below require authentication
router.use(authenticateToken);
router.use(requireRole('user'));

// Recurring auto-debit subscription (Razorpay Subscriptions API / UPI AutoPay)
router.post('/recurring/create', asyncHandler(subscriptionRecurringController.createRecurringSubscription));
router.post('/recurring/verify', asyncHandler(subscriptionRecurringController.verifyRecurringSubscription));
router.post('/recurring/cancel', asyncHandler(subscriptionRecurringController.cancelRecurringSubscription));
router.get('/recurring/status', asyncHandler(subscriptionRecurringController.getRecurringSubscriptionStatus));
router.post('/recurring/sync', asyncHandler(subscriptionRecurringController.syncSubscriptionFromRazorpay));

export default router;