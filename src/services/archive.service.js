// services/archive.service.js
import ArchivedContent from '../models/ArchivedContent.model.js';
import Content from '../models/Content.model.js';
import { ApiError } from '../utils/errorHandler.js';

/**
 * Archive Service - Content archival by date
 */
export class ArchiveService {
  /**
   * Archive content by date
   */
  static async archiveContent(contentId) {
    try {
      const content = await Content.findById(contentId).lean();
      if (!content) {
        throw new ApiError(404, 'Content not found');
      }

      const title = content.textContent?.title || 
                   content.quizContent?.title || 
                   content.videoContent?.title || 
                   'Untitled Content';

      const description = content.textContent?.description || 
                         content.quizContent?.question || 
                         content.videoContent?.description || 
                         '';

      const archivedContent = await ArchivedContent.findOneAndUpdate(
        { contentId },
        {
          contentId,
          date: content.date,
          contentType: content.contentType,
          title,
          description,
          metadata: {
            likesCount: content.likesCount || 0,
            commentsCount: content.commentsCount || 0,
            bookmarksCount: content.bookmarksCount || 0,
            views: 0
          }
        },
        { upsert: true, new: true }
      );

      return archivedContent;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to archive content', error.message);
    }
  }

  /**
   * Get archived content by date
   */
  static async getArchiveByDate(date) {
    try {
      // Parse the date (expecting format: YYYY-MM-DD)
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);

      if (isNaN(startDate.getTime())) {
        throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
      }

      const archivedContent = await ArchivedContent.find({
        date: {
          $gte: startDate,
          $lte: endDate
        }
      })
        .populate('contentId', 'contentType textContent quizContent videoContent')
        .sort({ date: -1 })
        .lean();

      return archivedContent;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to fetch archived content', error.message);
    }
  }

  /**
   * Get archived content by date range
   */
  static async getArchiveByDateRange(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
      }

      const archivedContent = await ArchivedContent.find({
        date: {
          $gte: start,
          $lte: end
        }
      })
        .populate('contentId', 'contentType textContent quizContent videoContent')
        .sort({ date: -1 })
        .lean();

      return archivedContent;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to fetch archived content', error.message);
    }
  }

  /**
   * Get archived content by type
   */
  static async getArchiveByType(contentType, { page = 1, limit = 10 } = {}) {
    try {
      if (!['text', 'quiz', 'video'].includes(contentType)) {
        throw new ApiError(400, 'Invalid content type');
      }

      const skip = (page - 1) * limit;

      const [data, total] = await Promise.all([
        ArchivedContent.find({ contentType })
          .populate('contentId', 'contentType textContent quizContent videoContent')
          .sort({ date: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ArchivedContent.countDocuments({ contentType })
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to fetch archived content', error.message);
    }
  }

  /**
   * Get all archived content with pagination
   */
  static async getAllArchive({ page = 1, limit = 10, contentType = null } = {}) {
    try {
      const skip = (page - 1) * limit;
      const query = {};

      if (contentType) {
        if (!['text', 'quiz', 'video'].includes(contentType)) {
          throw new ApiError(400, 'Invalid content type');
        }
        query.contentType = contentType;
      }

      const [data, total] = await Promise.all([
        ArchivedContent.find(query)
          .populate('contentId', 'contentType textContent quizContent videoContent')
          .sort({ date: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ArchivedContent.countDocuments(query)
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to fetch archived content', error.message);
    }
  }

  /**
   * Search archived content
   */
  static async searchArchive(searchQuery, { page = 1, limit = 10 } = {}) {
    try {
      const skip = (page - 1) * limit;

      const [data, total] = await Promise.all([
        ArchivedContent.find({
          $or: [
            { title: { $regex: searchQuery, $options: 'i' } },
            { description: { $regex: searchQuery, $options: 'i' } }
          ]
        })
          .populate('contentId', 'contentType textContent quizContent videoContent')
          .sort({ date: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        ArchivedContent.countDocuments({
          $or: [
            { title: { $regex: searchQuery, $options: 'i' } },
            { description: { $regex: searchQuery, $options: 'i' } }
          ]
        })
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, 'Failed to search archived content', error.message);
    }
  }

  /**
   * Get archive statistics
   */
  static async getArchiveStats(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const stats = await ArchivedContent.aggregate([
        {
          $match: {
            date: {
              $gte: start,
              $lte: end
            }
          }
        },
        {
          $group: {
            _id: '$contentType',
            count: { $sum: 1 },
            totalLikes: { $sum: '$metadata.likesCount' },
            totalComments: { $sum: '$metadata.commentsCount' },
            totalBookmarks: { $sum: '$metadata.bookmarksCount' }
          }
        }
      ]);

      return stats;
    } catch (error) {
      throw new ApiError(500, 'Failed to fetch archive statistics', error.message);
    }
  }
}

export default ArchiveService;
