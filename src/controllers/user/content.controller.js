// controllers/content.controller.js
import Content from '../../models/Content.model.js';
import Like from '../../models/Like.model.js';
import Comment from '../../models/Comment.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import moment from 'moment-timezone';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import mongoose from 'mongoose';
import Bookmark from '../../models/Bookmark.model.js';
import { getPKTDateRange } from '../../utils/date.util.js';
import { enrichContent } from '../../utils/contentResponse.js';
import User from '../../models/User.model.js';

// Helper function to check if content is unlocked based on current time


export async function getContent(req, res) {
  const userId = req.user._id;
  const { startOfDay, endOfDay } = getPKTDateRange();

  const user=await User.findById(userId);
  if(!user.isSubscribed){
    return res.status(403).json(new ApiResponse(403, null, 'Subscription required to access content. Please subscribe to unlock all features.'));
  }
  const contentList = await Content.find({
    date: { $gte: startOfDay, $lte: endOfDay },
    isActive: true,
    isDeleted: { $ne: true }
  }).sort({ unlocksAt: 1 });

  if (!contentList.length) {
    return res.status(200).json(new ApiResponse(200, [], 'No content for today'));
  }

  const enrichedContent = await Promise.all(
    contentList.map(content => enrichContent(content, userId))
  );

  return res.status(200).json(new ApiResponse(200, enrichedContent, "Today's content"));
}
export async function getContentById(req, res) {
  const userId = req.user._id;
  const { contentId } = req.params;

  if (!contentId) throw new ApiError(400, 'Content ID is required.');

  const content = await Content.findOne({ _id: contentId, isDeleted: { $ne: true } });
  if (!content) throw new ApiError(404, 'Content not found.');

  const [userLike, isBookmarked, quizAttempt, likesCount, commentsCount] = await Promise.all([
    Like.findOne({ userId, contentId: content._id }),
    Bookmark.findOne({ userId, contentId: content._id }),
    QuizAttempt.findOne({ userId, contentId: content._id }),
    Like.countDocuments({ contentId: content._id }),
    Comment.countDocuments({ contentId: content._id }),
  ]);

  const result = {
    _id: content._id,
    contentType: content.contentType,
    unlocksAt: content.unlocksAt,
    date: content.date,
    isActive: content.isActive,
    likesCount,
    commentsCount,
    bookmarksCount: content.bookmarksCount || 0,
    isLiked: !!userLike,
    isBookmarked: !!isBookmarked,
    ...(content.contentType === 'text' && { textContent: content.textContent }),
    ...(content.contentType === 'video' && { videoContent: content.videoContent }),
    ...(content.contentType === 'quiz' && {
      quizContent: content.quizContent,
      quizAttempt: quizAttempt ? {
        selectedOptionId: quizAttempt.selectedOptionId,
        isCorrect: quizAttempt.isCorrect,
        timeTakenSeconds: quizAttempt.timeTakenSeconds,
      } : null,
    }),
  };

  return res.status(200).json(new ApiResponse(200, result, 'Content details retrieved successfully.'));
}

export const submitQuizAnswer = async (req, res) => {
  const { contentId, selectedOptionId, timeTakenSeconds } = req.body;
  const userId = req.user._id;


  if (!mongoose.Types.ObjectId.isValid(contentId)) {
    throw new ApiError(400, "Invalid Quiz ID format.");
  }

  const quiz = await Content.findById(contentId);
  if (!quiz) throw new ApiError(404, "Quiz not found");

  const existingAttempt = await QuizAttempt.findOne({ userId, contentId });
  if (existingAttempt) throw new ApiError(400, "Already attempted.");

  const isCorrect = quiz.quizContent.correctOptionId === selectedOptionId;

  const now = moment();
  const weekNumber = now.isoWeek();
  const year = now.year();
  const dayNumber = now.day();

  const attempt = await QuizAttempt.create({
    userId,
    contentId,
    selectedOptionId,
    isCorrect,
    timeTakenSeconds,
    weekNumber,
    year,
    dayNumber
  });

  res.status(200).json(new ApiResponse(200, {
    isCorrect,
    correctOptionId: quiz.quizContent.correctOptionId,
    explanation: quiz.quizContent.explanation
  }, "Quiz submitted."));
};


export async function likeContent(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const content = await Content.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  const existingLike = await Like.findOne({ userId, contentId });
  if (existingLike) {
    throw new ApiError(400, 'You have already liked this content.');
  }

  const like = await Like.create({ userId, contentId });
  content.likesCount += 1;
  await content.save();

  res.status(201).json(
    new ApiResponse(
      201,
      { likeId: like._id, likesCount: content.likesCount },
      'Content liked successfully.'
    )
  );
}

export async function unlikeContent(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const like = await Like.findOne({ userId, contentId });
  if (!like) {
    throw new ApiError(404, 'You have not liked this content.');
  }

  await Like.deleteOne({ _id: like._id });

  const content = await Content.findById(contentId);
  content.likesCount = Math.max(0, content.likesCount - 1);
  await content.save();

  res.status(200).json(
    new ApiResponse(
      200,
      { likesCount: content.likesCount },
      'Content unliked successfully.'
    )
  );
}

export async function addComment(req, res) {
  const userId = req.user._id;
  const { contentId, text, parentCommentId } = req.body;

  if (!contentId || !text) {
    throw new ApiError(400, 'Content ID and comment text are required.');
  }

  if (text.length > 500) {
    throw new ApiError(400, 'Comment must not exceed 500 characters.');
  }

  const content = await Content.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  const comment = await Comment.create({
    userId,
    contentId,
    text,
    parentCommentId: parentCommentId || null
  });

  content.commentsCount += 1;
  await content.save();

  res.status(201).json(
    new ApiResponse(
      201,
      comment,
      'Comment added successfully.'
    )
  );
}

export async function getComments(req, res) {
  const { contentId } = req.params;
  const { parentCommentId } = req.query;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const query = { contentId };
  if (parentCommentId) {
    query.parentCommentId = parentCommentId;
  } else {
    query.parentCommentId = null; // Only get top-level comments unless querying for replies
  }

  const comments = await Comment.find(query)
    .populate('userId', 'name email profilePicture') 
    .sort({ createdAt: -1 })
    .limit(100);

  res.status(200).json(
    new ApiResponse(
      200,
      comments,
      'Comments retrieved successfully.'
    )
  );
}

export async function deleteComment(req, res) {
  const userId = req.user._id;
  const { commentId } = req.body;

  if (!commentId) {
    throw new ApiError(400, 'Comment ID is required.');
  }

  const comment = await Comment.findById(commentId);
  if (!comment) {
    throw new ApiError(404, 'Comment not found.');
  }

  if (comment.userId.toString() !== userId.toString()) {
    throw new ApiError(403, 'You can only delete your own comments.');
  }

  const content = await Content.findById(comment.contentId);
  if (content) {
    content.commentsCount = Math.max(0, content.commentsCount - 1);
    await content.save();
  }

  await Comment.deleteOne({ _id: commentId });

  res.status(200).json(
    new ApiResponse(
      200,
      {},
      'Comment deleted successfully.'
    )
  );
}




export const getWeeklyScore = async (req, res) => {
  const userId = req.user._id;

  // 1. Moment.js se current week aur year lein
  const now = moment();
  const currentWeek = now.isoWeek();
  const currentYear = now.year();

  // 2. Database mein current week ke sahi jawab dhoondein
  const result = await QuizAttempt.aggregate([
    {
      $match: {
        userId: userId,
        weekNumber: currentWeek,
        year: currentYear,
        isCorrect: true // Sirf sahi answers count karne hain
      }
    },
    {
      $group: {
        _id: null, // Sab ko group karke ek hi total banana hai
        totalPoints: { $sum: 1 } // Har sahi jawab par +1
      }
    }
  ]);

  // 3. Agar koi attempt nahi mila toh result empty array hoga
  const score = result.length > 0 ? result[0].totalPoints : 0;

  res.status(200).json(
    new ApiResponse(200, {
      week: currentWeek,
      year: currentYear,
      totalScore: score
    }, "Weekly score retrieved successfully.")
  );
};

export const getWeeklyWinnersAndPrize = async (req, res) => {
  const now = moment();
  const currentWeek = now.isoWeek();
  const currentYear = now.year();

  // 1. Is hafte ka Prize dhoondein
  const prize = await Prize.findOne({
    weekNumber: currentWeek,
    year: currentYear,
    prizeType: 'weekly'
  });

  // 2. Top 10 Winners ki list (Aggregation Pipeline)
  const winners = await QuizAttempt.aggregate([
    {
      $match: {
        weekNumber: currentWeek,
        year: currentYear,
        isCorrect: true // Sirf sahi jawab wale users
      }
    },
    {
      $group: {
        _id: "$userId",
        totalScore: { $sum: 1 },
        totalTime: { $sum: "$timeTakenSeconds" } // Tie-breaker ke liye total time
      }
    },
    {
      $sort: {
        totalScore: -1, // Pehle zyada score wale
        totalTime: 1    // Phir kam time wale (fastest)
      }
    },
    { $limit: 10 }, // Top 10 users
    {
      $lookup: {
        from: "users", // Users collection se name aur avatar uthane ke liye
        localField: "_id",
        foreignField: "_id",
        as: "userDetails"
      }
    },
    { $unwind: "$userDetails" },
    {
      $project: {
        _id: 1,
        totalScore: 1,
        totalTime: 1,
        name: "$userDetails.name",
        avatar: "$userDetails.avatar"
      }
    }
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      prize: prize || { title: "New Prize Coming Soon!", imageUrl: null },
      winners: winners
    }, "Weekly winners and prize fetched successfully.")
  );
};





export async function getArchiveByDate(req, res) {
  const userId = req.user._id;
  const { date, type = 'all' } = req.query;

  
  const user=await User.findById(userId);
  if(!user.isSubscribed){
    return res.status(403).json(new ApiResponse(403, null, 'Subscription required to access content. Please subscribe to unlock all features.'));
  }
  if (!date) {
    throw new ApiError(400, 'Date parameter is required (format: YYYY-MM-DD)');
  }

  // Date validate karo
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
  }

  // Type validate karo
  const allowed = ['text', 'quiz', 'video'];
  if (type !== 'all' && !allowed.includes(type)) {
    throw new ApiError(400, `Invalid type. Use: ${allowed.join(', ')}, or 'all'`);
  }

  const { startOfDay, endOfDay } = getPKTDateRange(date);

  const query = {
    date: { $gte: startOfDay, $lte: endOfDay },
    isDeleted: { $ne: true },
    ...(type !== 'all' && { contentType: type })
  };

  const contentList = await Content.find(query).sort({ unlocksAt: 1 });

  if (!contentList.length) {
    return res.status(200).json(
      new ApiResponse(200, { date, type, count: 0, data: [] }, `No content found for ${date}`)
    );
  }

  const enrichedContent = await Promise.all(
    contentList.map(content => enrichContent(content, userId))
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      { date, type, count: enrichedContent.length, data: enrichedContent },
      `${enrichedContent.length} content found for ${date}`
    )
  );
}