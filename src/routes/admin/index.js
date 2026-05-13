// routes/admin/index.js
import { Router } from 'express';
import dailyContentRoute from './dailyContent.routes.js';
import authRoute from './auth.routes.js';
import userRoute from './user.route.js';
import consultantRoute from './consultant.routes.js';
const router = Router();

router.use('/auth', authRoute);
router.use('/daily-content', dailyContentRoute);
router.use('/consultant', consultantRoute);
router.use('/users', userRoute);
export default router;