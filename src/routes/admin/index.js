// routes/admin/index.js
import { Router } from 'express';
import dailyContentRoute from './dailyContent.routes.js';
import authRoute from './auth.routes.js';
import userRoute from './user.route.js';
import consultantRoute from './consultant.routes.js';
import winnerRoutes from './winner.routes.js';
import { getAdminDashboard } from '../../controllers/admin/dashbaord.controller.js';
const router = Router();

router.use('/auth', authRoute);
router.use('/daily-content', dailyContentRoute);
router.use('/consultant', consultantRoute);
router.use('/dashboard', getAdminDashboard);
router.use('/users', userRoute);
router.use('/winners', winnerRoutes);
export default router;