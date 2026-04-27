// routes/admin/index.js
import { Router } from 'express';
import dailyContentRoute from './dailyContent.routes.js';
import authRoute from './auth.routes.js';

const router = Router();

router.use('/auth', authRoute);
router.use('/daily-content', dailyContentRoute);

export default router;