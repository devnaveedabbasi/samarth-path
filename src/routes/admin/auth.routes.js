import express from 'express';
import { adminRegister, adminLogin } from '../../controllers/admin/auth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = express.Router();

// Admin register
router.post('/register', asyncHandler(adminRegister));

// Admin login
router.post('/login', asyncHandler(adminLogin));

export default router;