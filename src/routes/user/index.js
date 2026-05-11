import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import authRoute from './auth.routes.js';
import subscriptionRoute from './subscription.routes.js';
import contentRoutes from './contentRoutes.js';
import winnersRoutes from './winners.routes.js';
import archiveRoutes from './archive.routes.js';
import notificationRoutes from './notification.routes.js';
import User from '../../models/User.model.js';


const router = Router();


// controller
export const saveFcmToken = async (req, res) => {
    try {
        const userId = req.user._id;
        const { fcmToken } = req.body;

        if (!fcmToken) {
            return res.status(400).json({
                success: false,
                message: "FCM token is required",
            });
        }

        await User.findByIdAndUpdate(userId, { fcmToken });

        res.json({
            success: true,
            message: "FCM token saved successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Something went wrong",
            error: error.message,
        });
    }
};


router.post("/save-fcm-token", authenticateToken, saveFcmToken);

router.use('/auth', authRoute);
router.use('/subscription', subscriptionRoute);
router.use('/content', contentRoutes);
router.use('/winners', winnersRoutes);
router.use('/archive', archiveRoutes);
router.use('/notifications', notificationRoutes);

export default router;
