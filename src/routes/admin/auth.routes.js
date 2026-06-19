import express from 'express';
import { adminRegister, adminLogin,adminLogout } from '../../controllers/admin/auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Admin register
router.post('/register', asyncHandler(adminRegister));

// Admin login
router.post('/login', asyncHandler(adminLogin));
router.post('/logout', authenticateToken, requireRole('admin'), asyncHandler(adminLogout));

router.get('/me', authenticateToken, requireRole('admin'), asyncHandler((req, res) => {
    res.json({ message: "Admin authenticated", data: req.user });
}));

export default router;