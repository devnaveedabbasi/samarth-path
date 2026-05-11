// utils/validations.js
import { ApiError } from './errorHandler.js';

/**
 * Validation utilities for consistent input validation
 */

/**
 * Validate quiz submission
 */
export const validateQuizSubmission = (data) => {
  const { contentId, selectedOptionId, timeTakenSeconds } = data;

  if (!contentId || contentId.trim() === '') {
    throw new ApiError(400, 'Content ID is required');
  }

  if (!selectedOptionId || selectedOptionId.trim() === '') {
    throw new ApiError(400, 'Selected option ID is required');
  }

  if (timeTakenSeconds !== undefined) {
    const seconds = parseInt(timeTakenSeconds);
    if (isNaN(seconds) || seconds < 0) {
      throw new ApiError(400, 'Time taken seconds must be a non-negative number');
    }
  }

  return { contentId, selectedOptionId, timeTakenSeconds: parseInt(timeTakenSeconds || 0) };
};

/**
 * Validate date format (YYYY-MM-DD)
 */
export const validateDateFormat = (dateString) => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) {
    throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new ApiError(400, 'Invalid date');
  }

  return date;
};

/**
 * Validate content type
 */
export const validateContentType = (type) => {
  const validTypes = ['text', 'quiz', 'video'];
  if (!validTypes.includes(type)) {
    throw new ApiError(400, `Invalid content type. Must be one of: ${validTypes.join(', ')}`);
  }
  return type;
};

/**
 * Validate user status change
 */
export const validateStatusChange = (status) => {
  const validStatuses = ['pending', 'approved', 'blocked', 'suspended'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
  }
  return status;
};

/**
 * Validate pagination parameters
 */
export const validatePagination = (page, limit) => {
  const pageNum = parseInt(page || 1);
  const limitNum = parseInt(limit || 10);

  if (pageNum < 1) {
    throw new ApiError(400, 'Page must be a positive number');
  }

  if (limitNum < 1 || limitNum > 100) {
    throw new ApiError(400, 'Limit must be between 1 and 100');
  }

  return { page: pageNum, limit: limitNum };
};

/**
 * Validate MongoDB ObjectId
 */
export const validateObjectId = (id, fieldName = 'ID') => {
  const regex = /^[0-9a-fA-F]{24}$/;
  if (!regex.test(id)) {
    throw new ApiError(400, `Invalid ${fieldName} format`);
  }
  return id;
};

/**
 * Validate week and year parameters
 */
export const validateWeekYear = (week, year) => {
  const weekNum = parseInt(week);
  const yearNum = parseInt(year);

  if (isNaN(weekNum) || weekNum < 1 || weekNum > 53) {
    throw new ApiError(400, 'Week must be a number between 1 and 53');
  }

  if (isNaN(yearNum) || yearNum < 2000) {
    throw new ApiError(400, 'Year must be a valid year');
  }

  return { week: weekNum, year: yearNum };
};

/**
 * Validate search query
 */
export const validateSearchQuery = (query) => {
  if (!query || query.trim().length < 2) {
    throw new ApiError(400, 'Search query must be at least 2 characters');
  }

  if (query.length > 100) {
    throw new ApiError(400, 'Search query cannot exceed 100 characters');
  }

  return query.trim();
};

/**
 * Validate date range
 */
export const validateDateRange = (startDate, endDate) => {
  const start = validateDateFormat(startDate);
  const end = validateDateFormat(endDate);

  if (start > end) {
    throw new ApiError(400, 'Start date must be before or equal to end date');
  }

  return { start, end };
};

/**
 * Validate FCM token
 */
export const validateFcmToken = (token) => {
  if (!token || token.trim().length < 10) {
    throw new ApiError(400, 'Invalid FCM token');
  }
  return token.trim();
};

export default {
  validateQuizSubmission,
  validateDateFormat,
  validateContentType,
  validateStatusChange,
  validatePagination,
  validateObjectId,
  validateWeekYear,
  validateSearchQuery,
  validateDateRange,
  validateFcmToken
};
