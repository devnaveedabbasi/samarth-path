import express from 'express';
import { adminRegister, adminLogin } from '../../controllers/admin/auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = express.Router();

// Admin register
router.post('/register', asyncHandler(adminRegister));

// Admin login
router.post('/login', asyncHandler(adminLogin));
router.get('/me', authenticateToken, requireRole('admin'), asyncHandler((req, res) => {
    res.json({ message: "Admin authenticated", data: req.user });
}));

export default router;