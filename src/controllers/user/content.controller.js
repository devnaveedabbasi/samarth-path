// controllers/content.controller.js
import Content from '../../models/Content.model.js';
import Like from '../../models/Like.model.js';
import Comment from '../../models/Comment.model.js';
import Archive from '../../models/Archive.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import moment from 'moment-timezone';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import mongoose from 'mongoose';

// Helper function to check if content is unlocked based on current time



export async function getContent(req, res) {
  const userId = req.user._id;

  const now = moment().tz("Asia/Karachi");
  const todayEnd = now.clone().endOf('day').toDate();
  const sevenDaysAgoStart = now.clone().subtract(6, 'days').startOf('day').toDate();

  const contentList = await Content.find({
    date: { $gte: sevenDaysAgoStart, $lte: todayEnd },
    isActive: true
  }).sort({ date: -1 }); 

  if (!contentList || contentList.length === 0) {
    throw new ApiError(404, 'No content available for the past 7 days.');
  }

  const enrichedContent = await Promise.all(
    contentList.map(async (content) => {
      const userLike = await Like.findOne({ userId, contentId: content._id });
      const isArchived = await Archive.findOne({ userId, contentId: content._id });

      const itemMoment = moment(content.date).tz("Asia/Karachi");
      let isUnlocked = false;

      // 1. Past dates check
      if (itemMoment.isBefore(now, 'day')) {
        isUnlocked = true;
      } 
      // 2. Today's check (Handling dot/colon in time)
      else if (itemMoment.isSame(now, 'day')) {
        const cleanUnlockTime = content.unlocksAt.replace('.', ':');
        const [hours, minutes] = cleanUnlockTime.split(':');
        const unlockMoment = now.clone().set({ hour: parseInt(hours), minute: parseInt(minutes), second: 0 });
        
        isUnlocked = now.isSameOrAfter(unlockMoment);
      }

      const priority = content.contentType === 'text' ? 1 : content.contentType === 'quiz' ? 2 : 3;

      return {
        _id: content._id,
        date: content.date,
        contentType: content.contentType,
        unlocksAt: content.unlocksAt,
        isUnlocked,
        isLiked: !!userLike,
        isArchived: !!isArchived,
        likesCount: content.likesCount || 0,
        commentsCount: content.commentsCount || 0,
        priority,
        ...(isUnlocked && content.contentType === 'text' && { textContent: content.textContent }),
        ...(isUnlocked && content.contentType === 'quiz' && { quizContent: content.quizContent }),
        ...(isUnlocked && content.contentType === 'video' && { videoContent: content.videoContent })
      };
    })
  );

  // --- THE CRITICAL FIX: Filter out locked content for TODAY ---
  const onlyUnlockedContent = enrichedContent.filter(item => item.isUnlocked === true);

  if (onlyUnlockedContent.length === 0) {
     return res.status(200).json(new ApiResponse(200, [], 'No unlocked content available yet.'));
  }

  const groupedData = onlyUnlockedContent.reduce((acc, item) => {
    const dateKey = moment(item.date).tz("Asia/Karachi").format('YYYY-MM-DD');
    if (!acc[dateKey]) {
      acc[dateKey] = {
        displayDate: moment(item.date).tz("Asia/Karachi").format('dddd, MMM Do'),
        items: []
      };
    }
    acc[dateKey].items.push(item);
    return acc;
  }, {});

  const finalResponse = Object.values(groupedData).map(dayGroup => {
    return {
      day: dayGroup.displayDate,
      content: dayGroup.items.sort((a, b) => a.priority - b.priority)
    };
  });

  res.status(200).json(
    new ApiResponse(200, finalResponse, 'Content retrieved successfully.')
  );
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
    .populate('userId', 'name')
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

export async function archiveContent(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const content = await Content.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  const existingArchive = await Archive.findOne({ userId, contentId });
  if (existingArchive) {
    throw new ApiError(400, 'Content is already archived.');
  }

  const archive = await Archive.create({ userId, contentId });

  res.status(201).json(
    new ApiResponse(
      201,
      { archiveId: archive._id },
      'Content archived successfully.'
    )
  );
}

export async function unarchiveContent(req, res) {
  const userId = req.user._id;
  const { contentId } = req.body;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const archive = await Archive.findOne({ userId, contentId });
  if (!archive) {
    throw new ApiError(404, 'Content is not archived.');
  }

  await Archive.deleteOne({ _id: archive._id });

  res.status(200).json(
    new ApiResponse(
      200,
      {},
      'Content unarchived successfully.'
    )
  );
}

export async function getArchivedContent(req, res) {
  const userId = req.user._id;

  const archivedIds = await Archive.find({ userId }).distinct('contentId');

  const archivedContent = await Content.find({ _id: { $in: archivedIds } })
    .sort({ createdAt: -1 });

  res.status(200).json(
    new ApiResponse(
      200,
      archivedContent,
      'Archived content retrieved successfully.'
    )
  );
}