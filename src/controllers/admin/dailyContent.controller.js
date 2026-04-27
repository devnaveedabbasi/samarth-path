// controllers/admin/dailyContent.controller.js
import DailyContent from '../../models/Content.model.js';
import Prize from '../../models/Prize.model.js';
import Winner from '../../models/Winner.model.js';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import moment from 'moment-timezone'; // Ye top par import karein

// Helper function to get ISO week number
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}



// text Content 


export async function createTextContent(req, res) {
  const adminId = req.user._id;
  const { title, description, label, image, scheduledDate, unlocksAt } = req.body;

  if (!title || !description || !label || !image) {
    throw new ApiError(400, 'Title, description, label, and image are required.');
  }

  // Range create karein: Aaj ki subha 00:00 se raat 23:59 tak (Pakistan Time)
  const startOfDay = scheduledDate
    ? moment.tz(scheduledDate, "Asia/Karachi").startOf('day').toDate()
    : moment.tz("Asia/Karachi").startOf('day').toDate();

  const endOfDay = moment(startOfDay).endOf('day').toDate();

  // 1. Duplicate Check (Range based taake timezone ka masla na ho)
  const existingText = await DailyContent.findOne({
    date: { $gte: startOfDay, $lte: endOfDay },
    contentType: 'text'
  });

  if (existingText) {
    throw new ApiError(400, `Text content for this date already exists.`);
  }

  // 2. Create Content
  const content = await DailyContent.create({
    contentType: 'text',
    unlocksAt: unlocksAt || '08:00',
    // Forcefully UTC mein 12:00 PM par save karein taake date hamesha wahi rahay
    // Is se date ke piche janay ka chance khatam ho jata hai
    date: moment(startOfDay).add(12, 'hours').toDate(),
    textContent: { title, description, label, image },
    createdBy: adminId
  });

  res.status(201).json(
    new ApiResponse(201, content, 'Text content scheduled successfully.')
  );
}

export async function getTextContent(req, res) {
  const { date } = req.query;

  let queryFilter = { contentType: 'text' };

  if (date) {
    queryFilter.date = date;
  }

  const content = date
    ? await DailyContent.findOne(queryFilter)
    : await DailyContent.find(queryFilter);

  // 4. Check karein ke data mila ya nahi
  if (!content || (Array.isArray(content) && content.length === 0)) {
    throw new ApiError(404, 'No text content found.');
  }

  res.status(200).json(
    new ApiResponse(200, content, 'Content retrieved successfully.')
  );
}


export async function getTextContent(req, res) {
  const { date } = req.query;

  let queryFilter = { contentType: 'text' };

  if (date) {
    queryFilter.date = date;
  }

  const content = date
    ? await DailyContent.findOne(queryFilter)
    : await DailyContent.find(queryFilter);

  if (!content || (Array.isArray(content) && content.length === 0)) {
    throw new ApiError(404, 'No text content found.');
  }

  res.status(200).json(
    new ApiResponse(200, content, 'Content retrieved successfully.')
  );
}




export async function createQuizContent(req, res) {
  const adminId = req.user._id;
  const { title, question, options, correctOptionId, explanation, timerSeconds = 180 } = req.body;

  if (!title || !question || !options || options.length !== 4 || !correctOptionId) {
    throw new ApiError(400, 'Title, question, 4 options, and correct option ID are required.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if quiz content already exists for today
  const existingQuiz = await DailyContent.findOne({
    date: today,
    contentType: 'quiz'
  });
  if (existingQuiz) {
    throw new ApiError(400, 'Quiz content for today already exists.');
  }

  const content = await DailyContent.create({
    contentType: 'quiz',
    unlocksAt: '14:00',
    date: today,
    quizContent: {
      title,
      question,
      options,
      correctOptionId,
      timerSeconds,
      explanation
    },
    createdBy: adminId
  });

  res.status(201).json(
    new ApiResponse(201, content, 'Quiz content created successfully.')
  );
}

export async function createVideoContent(req, res) {
  const adminId = req.user._id;
  const { title, videoUrl, durationMinutes, thumbnail, description, isAutoMute = true, hasListenOnlyMode = true } = req.body;

  if (!title || !videoUrl || !durationMinutes) {
    throw new ApiError(400, 'Title, video URL, and duration are required.');
  }

  if (durationMinutes > 7) {
    throw new ApiError(400, 'Video duration must not exceed 7 minutes.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if video content already exists for today
  const existingVideo = await DailyContent.findOne({
    date: today,
    contentType: 'video'
  });
  if (existingVideo) {
    throw new ApiError(400, 'Video content for today already exists.');
  }

  const content = await DailyContent.create({
    contentType: 'video',
    unlocksAt: '19:00',
    date: today,
    videoContent: {
      title,
      videoUrl,
      durationMinutes,
      thumbnail,
      description,
      isAutoMute,
      hasListenOnlyMode
    },
    createdBy: adminId
  });

  res.status(201).json(
    new ApiResponse(201, content, 'Video content created successfully.')
  );
}

export async function getDailyContentList(req, res) {
  const { date } = req.query;
  let query = { isActive: true };

  if (date) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    query.date = { $gte: targetDate, $lt: nextDate };
  }

  const content = await DailyContent.find(query).sort({ createdAt: -1 }).limit(100);

  res.status(200).json(
    new ApiResponse(200, content, 'Daily content list retrieved.')
  );
}

export async function updateContent(req, res) {
  const { contentId } = req.params;
  const updateData = req.body;

  const content = await DailyContent.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  // Prevent changing content type
  if (updateData.contentType && updateData.contentType !== content.contentType) {
    throw new ApiError(400, 'Cannot change content type.');
  }

  Object.assign(content, updateData);
  await content.save();

  res.status(200).json(
    new ApiResponse(200, content, 'Content updated successfully.')
  );
}

export async function deleteContent(req, res) {
  const { contentId } = req.params;

  const content = await DailyContent.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  content.isActive = false;
  await content.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'Content deleted successfully.')
  );
}

export async function createPrize(req, res) {
  const { title, description, imageUrl, weekNumber, year, prizeType = 'weekly' } = req.body;

  if (!title || weekNumber === undefined || !year) {
    throw new ApiError(400, 'Title, week number, and year are required.');
  }

  const existingPrize = await Prize.findOne({ weekNumber, year, prizeType });
  if (existingPrize) {
    throw new ApiError(400, `Prize for ${prizeType} period already exists.`);
  }

  const prize = await Prize.create({
    title,
    description,
    imageUrl,
    weekNumber,
    year,
    prizeType
  });

  res.status(201).json(
    new ApiResponse(201, prize, 'Prize created successfully.')
  );
}

export async function calculateWeeklyWinners(req, res) {
  const { weekNumber, year } = req.body;

  if (weekNumber === undefined || !year) {
    throw new ApiError(400, 'Week number and year are required.');
  }

  // Get all quiz attempts for the week, grouped by user
  const attempts = await QuizAttempt.aggregate([
    {
      $match: { weekNumber, year }
    },
    {
      $group: {
        _id: '$userId',
        correctAnswers: {
          $sum: { $cond: ['$isCorrect', 1, 0] }
        },
        totalAttempts: { $sum: 1 }
      }
    },
    {
      $sort: { correctAnswers: -1, _id: 1 }
    }
  ]);

  if (attempts.length === 0) {
    throw new ApiError(404, 'No quiz attempts found for this week.');
  }

  // Delete existing winners for this week
  await Winner.deleteMany({ weekNumber, year, cycleType: 'weekly' });

  // Create winners
  const maxWinners = process.env.MAX_WEEKLY_WINNERS || 10;
  const winners = [];

  for (let i = 0; i < Math.min(attempts.length, maxWinners); i++) {
    const attempt = attempts[i];
    const winner = await Winner.create({
      userId: attempt._id,
      rank: i + 1,
      score: attempt.correctAnswers,
      weekNumber,
      year,
      cycleType: 'weekly'
    });
    winners.push(winner);
  }

  res.status(201).json(
    new ApiResponse(201, winners, `${winners.length} winners calculated for week ${weekNumber}, ${year}.`)
  );
}

export async function getContentAnalytics(req, res) {
  const { contentId } = req.params;

  const content = await DailyContent.findById(contentId);
  if (!content) {
    throw new ApiError(404, 'Content not found.');
  }

  let analytics = {
    contentId: content._id,
    contentType: content.contentType,
    likesCount: content.likesCount,
    commentsCount: content.commentsCount,
    bookmarksCount: content.bookmarksCount
  };

  // Add quiz-specific analytics
  if (content.contentType === 'quiz') {
    const quizAnalytics = await QuizAttempt.aggregate([
      { $match: { contentId: content._id } },
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: 1 },
          correctAnswers: { $sum: { $cond: ['$isCorrect', 1, 0] } },
          averageTimeSeconds: { $avg: '$timeTakenSeconds' }
        }
      }
    ]);

    if (quizAnalytics.length > 0) {
      analytics.quiz = {
        totalAttempts: quizAnalytics[0].totalAttempts,
        correctAnswers: quizAnalytics[0].correctAnswers,
        successRate: ((quizAnalytics[0].correctAnswers / quizAnalytics[0].totalAttempts) * 100).toFixed(2) + '%',
        averageTimeSeconds: quizAnalytics[0].averageTimeSeconds.toFixed(2)
      };
    }
  }

  res.status(200).json(
    new ApiResponse(200, analytics, 'Content analytics retrieved successfully.')
  );
}