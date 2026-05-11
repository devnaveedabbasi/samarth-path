// routes/admin/index.js
import { Router } from 'express';
import dailyContentRoute from './dailyContent.routes.js';
import authRoute from './auth.routes.js';
import userRoute from './user.route.js';
const router = Router();

router.use('/auth', authRoute);
router.use('/daily-content', dailyContentRoute);
router.use('/users', userRoute);
export default router;