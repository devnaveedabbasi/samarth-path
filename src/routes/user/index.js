import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import authRoute from './auth.routes.js';
const router = Router();

router.use('/auth', authRoute);
router.use(authenticateToken); 

export default router;
