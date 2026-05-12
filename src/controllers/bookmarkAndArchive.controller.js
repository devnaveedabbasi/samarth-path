// controllers/bookmarkAndArchive.controller.js
import DailyContent from '../models/Content.model.js';
import Bookmark from '../models/Bookmark.model.js';
import User from '../models/User.model.js';
import Subscription from '../models/Subscription.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import Like from '../models/Like.model.js';

export async function bookmarkContent(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const content = await DailyContent.findById(contentId).lean();
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  const existingBookmark = await Bookmark.findOne({ userId, contentId });
  if (existingBookmark) {
    throw new ApiError(400, 'Content is already bookmarked.');
  }

  const bookmark = await Bookmark.create({ userId, contentId });

  await DailyContent.findByIdAndUpdate(contentId, {
    $inc: { bookmarksCount: 1 }
  });

  let filteredContent = {
    _id: content._id,
    contentType: content.contentType,
    unlocksAt: content.unlocksAt,
    date: content.date,
  };

  if (content.contentType === 'video') {
    filteredContent.videoContent = content.videoContent;
  } else if (content.contentType === 'quiz') {
    filteredContent.quizContent = content.quizContent;
  } else if (content.contentType === 'text') {
    filteredContent.textContent = content.textContent;
  }

  res.status(201).json(
    new ApiResponse(
      201,
      {
        bookmarkId: bookmark._id,
        content: filteredContent
      },
      'Content bookmarked successfully.'
    )
  );
}

export async function removeBookmark(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const bookmark = await Bookmark.findOne({ userId, contentId });
  if (!bookmark) {
    throw new ApiError(404, 'Content is not bookmarked.');
  }

  await Bookmark.deleteOne({ _id: bookmark._id });

  const content = await DailyContent.findById(contentId);
  if (content) {
    content.bookmarksCount = Math.max(0, content.bookmarksCount - 1);
    await content.save();
  }

  res.status(200).json(
    new ApiResponse(200, {}, 'Bookmark removed successfully.')
  );
}

export async function getBookmarks(req, res) {
  const userId = req.user._id;

  const bookmarkedIds = await Bookmark.find({ userId }).distinct('contentId');

  const bookmarkedContent = await DailyContent.find({
    _id: { $in: bookmarkedIds }
  })
    .sort({ createdAt: -1 })
    .lean();
const likedBookmarkedContentIds = await Like.find({ userId, contentId: { $in: bookmarkedIds } }).distinct('contentId');
const likedBookmarkedContentSet = new Set((likedBookmarkedContentIds || []).map(id => id.toString()));
console.log('Liked Bookmarked Content IDs:', likedBookmarkedContentIds);


  const formattedContent = bookmarkedContent.map((content) => {
    let base = {
      _id: content._id,
      contentType: content.contentType,
      unlocksAt: content.unlocksAt,
      isNotified: content.isNotified,
      date: content.date,
      createdBy: content.createdBy,
      isActive: content.isActive,
      likesCount: content.likesCount,
      isLiked: likedBookmarkedContentSet.has(String(content._id)),
      commentsCount: content.commentsCount,
      bookmarksCount: content.bookmarksCount,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
      isBookmarked: true 
    };

    if (content.contentType === 'video') {
      base.videoContent = content.videoContent;
    } else if (content.contentType === 'quiz') {
      const { correctOptionId, ...quiz } = content.quizContent || {};
      base.quizContent = quiz;
    } else {
      base.textContent = content.textContent;
    }

    return base;
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        totalBookmarks: bookmarkedIds.length,
        items: formattedContent
      },
      'Bookmarked content retrieved successfully.'
    )
  );
}
