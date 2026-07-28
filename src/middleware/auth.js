// middleware/auth.js
import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';

const authMiddleware = async (req, res, next) => {
  try {
    // Check for JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Validate decoded has userId
    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token structure'
      });
    }

    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const allowedStatuses = ['approved'];
    if (!allowedStatuses.includes(user.status)) {
      return res.status(403).json({
        success: false,
        message: `Account not authorized. Current status: ${user.status}`
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please login again.'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`
      });
    }
    next();
  };
};

const checkSubscription = async (req, res, next) => {
  try {
    const user = req.user;

    const Subscription = (
      await import('../models/Subscription.model.js')
    ).default;

    const subscription = await Subscription.findOne({
      userId: user._id
    });

    if (!subscription) {
      return res.status(403).json({
        success: false,
        message: 'Subscription not found. Please contact support.',
        data: {
          subscriptionStatus: 'none',
          requiresSubscription: true,
        }
      });
    }

    const now = new Date();

    // Trial expired
    if (
      subscription.status === 'trial' &&
      subscription.trialEndDate < now
    ) {
      subscription.status = 'expired';

      user.isSubscribed = false;
      user.isTrial = false;

      await subscription.save();
      await user.save();

      return res.status(403).json({
        success: false,
        message:
          'Your 3-day free trial has expired. Subscribe for ₹199/month to continue.',
        data: {
          subscriptionStatus: 'expired',
          trialEndDate: subscription.trialEndDate,
          requiresSubscription: true,
          planPrice: 199,
        }
      });
    }

    // Paid subscription expired
    if (
      subscription.status === 'active' &&
      subscription.expiryDate < now
    ) {
      subscription.status = 'expired';

      user.isSubscribed = false;
      user.isTrial = false;

      await subscription.save();
      await user.save();

      return res.status(403).json({
        success: false,
        message:
          'Your subscription has expired. Renew for ₹199/month to continue.',
        data: {
          subscriptionStatus: 'expired',
          expiryDate: subscription.expiryDate,
          requiresSubscription: true,
          planPrice: 199,
        }
      });
    }

    // Sync user state for active subscriptions
    if (['trial', 'active'].includes(subscription.status)) {
      user.isSubscribed = (subscription.status === 'active');
      user.isTrial = (subscription.status === 'trial');
      user.subscriptionID = subscription._id;
      await user.save();
    }

    // Block expired/cancelled users
    if (
      subscription.status !== 'trial' &&
      subscription.status !== 'active'
    ) {
      user.isSubscribed = false;
      user.isTrial = false;
      await user.save();

      return res.status(403).json({
        success: false,
        message:
          'No active subscription. Subscribe for ₹199/month to access content.',
        data: {
          subscriptionStatus: subscription.status,
          requiresSubscription: true,
          planPrice: 199,
        }
      });
    }

    req.subscription = subscription;

    next();
  } catch (error) {
    console.error(
      'Subscription middleware error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Subscription check failed.'
    });
  }
};

const checkFullAccess = async (req, res, next) => {
  const user = req.user;
  const Subscription = (await import('../models/Subscription.model.js')).default;
  const subscription = await Subscription.findOne({ userId: user._id });

  if (!subscription || subscription.status !== 'active') {
    return res.status(403).json({
      success: false,
      message: 'Full access requires active subscription.'
    });
  }

  next();
};

export { authMiddleware, authorize, checkSubscription, checkFullAccess };