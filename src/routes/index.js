import { Router } from 'express';

import userRoute from './user/index.js';
import adminRoute from './admin/index.js';

const router = Router();

router.use('/user', userRoute);
router.use('/admin', adminRoute);

export default router;
