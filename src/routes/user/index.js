import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import authRoute from './auth.routes.js';
import subscriptionRoute from './subscription.routes.js';
import contentRoutes from './contentRoutes.js';
const router = Router();

router.use('/auth', authRoute);
router.use('/subscription', subscriptionRoute);
router.use('/content', contentRoutes);

export default router;
