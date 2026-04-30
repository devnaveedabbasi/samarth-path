// controllers/admin/Content.controller.js
import Content from '../../models/Content.model.js';
import Prize from '../../models/Prize.model.js';
import Winner from '../../models/Winner.model.js';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import moment from 'moment-timezone';
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { uploadOnCloudinary } from '../../utils/cloudinary.js';
import fs from "fs";


ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);



// ffmpeg.setFfmpegPath(ffmpegPath);

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}





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
  const existingText = await Content.findOne({
    date: { $gte: startOfDay, $lte: endOfDay },
    contentType: 'text'
  });

  if (existingText) {
    throw new ApiError(400, `Text content for this date already exists.`);
  }

  // 2. Create Content
  const content = await Content.create({
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
  const { date, search, status, page = 1, limit = 10 } = req.query;

  let queryFilter = { contentType: 'text' };

  if (date) {
    queryFilter.date = date;
  }

  if (status !== undefined && status !== "") {
    queryFilter.isActive = status === "true";
  }

  if (search) {
    queryFilter.$or = [
      { "textContent.title": { $regex: search, $options: "i" } },
      { "textContent.label": { $regex: search, $options: "i" } }
    ];
  }

  try {
    if (date) {
      const content = await Content.findOne(queryFilter);

      if (!content) {
        return res.status(200).json(new ApiResponse(200, [], 'No text content found for this date.'));
      }

      return res.status(200).json(
        new ApiResponse(200, content, 'Content retrieved successfully.')
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const content = await Content.find(queryFilter)
      .sort({ createdAt: -1 }) // Latest content pehle
      .skip(skip)
      .limit(parseInt(limit));

    const totalItems = await Content.countDocuments(queryFilter);

    if (!content || content.length === 0) {
      return res.status(200).json(new ApiResponse(200, [], 'No text content found.'));
    }

    // Response mein data aur pagination details dono bhej rahe hain
    res.status(200).json(
      new ApiResponse(
        200,
        {
          content,
          pagination: {
            totalItems,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalItems / limit)
          }
        },
        'Content retrieved successfully.'
      )
    );

  } catch (error) {
    res.status(500).json(new ApiResponse(500, null, error.message));
  }
}

export async function getContentById(req, res) {
  const { id } = req.params;

  try {
    const content = await Content.findById(id);

    if (!content) {
      return res.status(404).json(
        new ApiResponse(404, null, 'Content with this ID not found.')
      );
    }

    return res.status(200).json(
      new ApiResponse(200, content, 'Content retrieved successfully.')
    );

  } catch (error) {
    const statusCode = error.kind === 'ObjectId' ? 400 : 500;
    const message = error.kind === 'ObjectId' ? 'Invalid ID format.' : error.message;

    res.status(statusCode).json(
      new ApiResponse(statusCode, null, message)
    );
  }
}



export async function updateTextContent(req, res) {
  const { title, description, label, image, unlocksAt } = req.body;
  const { contentId } = req.params;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const updateData = {};

  if (title) updateData['textContent.title'] = title;
  if (description) updateData['textContent.description'] = description;
  if (label) updateData['textContent.label'] = label;
  if (image) updateData['textContent.image'] = image;
  if (unlocksAt) updateData.unlocksAt = unlocksAt;

  const updatedContent = await Content.findByIdAndUpdate(
    contentId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedContent) {
    throw new ApiError(404, 'Content not found or update failed.');
  }

  res.status(200).json(
    new ApiResponse(200, updatedContent, 'Text content updated successfully.')
  );
}

export async function deleteTextContent(req, res) {
  const { contentId } = req.params;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const deletedContent = await Content.findByIdAndDelete(contentId);

  if (!deletedContent) {
    throw new ApiError(404, 'Content not found. It might have been already deleted.');
  }

  // 4. Success Response
  res.status(200).json(
    new ApiResponse(200, null, 'Text content deleted successfully.')
  );
}


// QUIZ CONTENT


export async function createQuizContent(req, res) {
  const adminId = req.user._id;
  const {
    title,
    question,
    options,
    correctOptionId,
    explanation,
    timerSeconds = 180,
    date,
    unlocksAt = "14:00"
  } = req.body;

  if (!title || !question || !correctOptionId) {
    throw new ApiError(400, 'Title, question, and correctOptionId are required.');
  }

  if (!Array.isArray(options) || options.length !== 4) {
    throw new ApiError(400, 'A quiz must have exactly 4 options.');
  }

  const isValidOptions = options.every(opt => opt.id && opt.text);
  if (!isValidOptions) {
    throw new ApiError(400, 'Each option must have an "id" and "text".');
  }

  const quizDate = date ? new Date(date) : new Date();
  quizDate.setHours(0, 0, 0, 0);

  const existingQuiz = await Content.findOne({
    date: quizDate,
    contentType: 'quiz'
  });

  if (existingQuiz) {
    throw new ApiError(400, `Quiz for ${quizDate.toDateString()} already exists.`);
  }

  const content = await Content.create({
    contentType: 'quiz',
    unlocksAt,
    date: quizDate,
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
    new ApiResponse(201, content, 'Quiz with 4 options created successfully.')
  );
}

export async function getQuizById(req, res) {
  const { contentId } = req.params;

  // 1. Find the content by ID
  const quiz = await Content.findById(contentId);

  // 2. Check if content exists
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found.');
  }

  // 3. Ensure the content found is a quiz
  if (quiz.contentType !== 'quiz') {
    throw new ApiError(400, 'The requested content is not a quiz.');
  }

  // 4. Return the quiz data
  res.status(200).json(
    new ApiResponse(200, quiz, 'Quiz details fetched successfully.')
  );
}

export async function getQuizzes(req, res) {
  // 1. Pagination aur Filters (Optional but good for Admin)
  const { page = 1, limit = 10, search } = req.query;

  const query = { contentType: 'quiz' };

  if (search) {
    query['quizContent.question'] = { $regex: search, $options: 'i' };
  }

  const quizzes = await Content.find(query)
    .sort({ date: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  // 3. Count total (Pagination ke liye)
  const total = await Content.countDocuments(query);

  // 4. Response handling
  if (!quizzes || quizzes.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, [], 'No quizzes found in records.')
    );
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        quizzes,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        totalQuizzes: total
      },
      'Admin quizzes retrieved successfully.'
    )
  );
}


export async function updateQuizContent(req, res) {
  const { contentId } = req.params;
  const {
    title, question, options, correctOptionId, explanation,
    timerSeconds, date, unlocksAt
  } = req.body;

  // 1. Check karein ke Quiz exist karta hai ya nahi
  const quiz = await Content.findOne({ _id: contentId, contentType: 'quiz' });
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found.');
  }

  // 2. Update Object banayein (Dynamic)
  const updateData = {};

  // Root level fields
  if (date) updateData.date = new Date(date);
  if (unlocksAt) updateData.unlocksAt = unlocksAt;

  // Nested quizContent fields (Dot Notation use karein)
  if (title) updateData['quizContent.title'] = title;
  if (question) updateData['quizContent.question'] = question;
  if (explanation) updateData['quizContent.explanation'] = explanation;
  if (timerSeconds) updateData['quizContent.timerSeconds'] = timerSeconds;
  if (correctOptionId) updateData['quizContent.correctOptionId'] = correctOptionId;

  // 3. Agar options update karne hain toh length check karein
  if (options) {
    if (!Array.isArray(options) || options.length !== 4) {
      throw new ApiError(400, 'Options must be exactly 4.');
    }
    updateData['quizContent.options'] = options;
  }

  // 4. Database update karein
  const updatedQuiz = await Content.findByIdAndUpdate(
    contentId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  res.status(200).json(
    new ApiResponse(200, updatedQuiz, 'Quiz updated successfully.')
  );
}


export async function deleteQuizContent(req, res) {
  const { contentId } = req.params;

  if (!contentId) {
    throw new ApiError(400, 'Content ID is required.');
  }

  const deletedQuiz = await Content.findOneAndDelete({
    _id: contentId,
    contentType: 'quiz'
  });

  if (!deletedQuiz) {
    throw new ApiError(404, 'Quiz not found or already deleted.');
  }


  res.status(200).json(
    new ApiResponse(200, null, 'Quiz and its related data deleted successfully.')
  );
}


export async function getQuizAttempts(req, res) {
  const { contentId, page = 1, limit = 20 } = req.query;

  let queryFilter = {};

  if (contentId) {
    queryFilter.contentId = contentId;
  }

  const attempts = await QuizAttempt.find(queryFilter)
    .populate('userId', 'name email avatar')
    .populate('contentId', 'quizContent.question date')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await QuizAttempt.countDocuments(queryFilter);

  res.status(200).json(
    new ApiResponse(200, {
      attempts,
      totalAttempts: total,
      currentPage: page
    }, 'Attempts retrieved successfully.')
  );
}



/**
 * @description Create Video Content with Video and Thumbnail upload
 * @route POST /api/admin/daily-content/video
 */
export async function createVideoContent(req, res) {
  const adminId = req.user._id;

  const {
    title,
    description,
    unlocksAt = "19:00",
    date,
    hasListenOnlyMode = true
  } = req.body;

  const videoLocalPath = req.files?.video?.[0]?.path;
  const thumbnailLocalPath = req.files?.image?.[0]?.path;

  if (!videoLocalPath) {
    throw new ApiError(400, "Video file is required.");
  }
  if (!thumbnailLocalPath) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath); // Clean up
    throw new ApiError(400, "Thumbnail image is required.");
  }
  if (!title) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    throw new ApiError(400, "Title is required.");
  }

  const getVideoDuration = (filePath) => {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        resolve(metadata.format.duration);
      });
    });
  };

  let durationSeconds;
  try {
    durationSeconds = await getVideoDuration(videoLocalPath);

    if (durationSeconds > 420) {
      if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
      if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
      throw new ApiError(400, "Video duration exceeds 7 minutes limit.");
    }
  } catch (error) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    throw new ApiError(400, "Could not verify video duration.");
  }

  const videoDate = date ? new Date(date) : new Date();
  videoDate.setHours(0, 0, 0, 0);

  const existingVideo = await Content.findOne({
    date: videoDate,
    contentType: "video",
  });

  if (existingVideo) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    throw new ApiError(400, `Video content for ${videoDate.toDateString()} already exists.`);
  }

  try {
    const videoUpload = await uploadOnCloudinary(videoLocalPath);
    const thumbnailUpload = await uploadOnCloudinary(thumbnailLocalPath);

    if (!videoUpload || !thumbnailUpload) {
      throw new ApiError(500, "Failed to upload files to Cloudinary.");
    }

    const content = await Content.create({
      contentType: "video",
      unlocksAt,
      date: videoDate,
      videoContent: {
        title,
        description,
        videoUrl: videoUpload.secure_url,
        thumbnail: thumbnailUpload.secure_url,
        durationSeconds: Math.round(durationSeconds),
        isAutoMute: true,
        hasListenOnlyMode: hasListenOnlyMode === "true" || hasListenOnlyMode === true,
      },
      createdBy: adminId,
    });

    return res.status(201).json(
      new ApiResponse(201, content, "Video content created and uploaded successfully!")
    );

  } catch (error) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    throw new ApiError(500, error?.message || "Internal Server Error during upload.");
  }
}



export async function getAllVideoContent(req, res) {
  // 1. Query parameters se page aur limit nikalna
  const page = parseInt(req.query.page) || 1; // Default page 1
  const limit = parseInt(req.query.limit) || 10; // Ek page par 10 videos
  const skip = (page - 1) * limit;

  // 2. Total videos count karna (Pagination metadata ke liye)
  const totalVideos = await Content.countDocuments({ contentType: 'video' });

  // 3. Videos fetch karna pagination ke saath
  const videos = await Content.find({ contentType: 'video' })
    .sort({ date: -1 }) // Newest first
    .skip(skip)
    .limit(limit)
    .populate('createdBy', 'name email'); // Optional: creator details dikhane ke liye

  // 4. Metadata calculate karna
  const totalPages = Math.ceil(totalVideos / limit);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        videos,
        pagination: {
          totalVideos,
          totalPages,
          currentPage: page,
          pageSize: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      },
      'Video content fetched successfully with pagination.'
    )
  );
}

export async function getContentList(req, res) {
  const { date } = req.query;
  let query = { isActive: true };

  if (date) {
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const nextDate = new Date(targetDate);
    nextDate.setDate(nextDate.getDate() + 1);
    query.date = { $gte: targetDate, $lt: nextDate };
  }

  const content = await Content.find(query).sort({ createdAt: -1 }).limit(100);

  res.status(200).json(
    new ApiResponse(200, content, 'Daily content list retrieved.')
  );
}

export async function updateContent(req, res) {
  const { contentId } = req.params;
  const updateData = req.body;

  const content = await Content.findById(contentId);
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

  const content = await Content.findById(contentId);
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

  const content = await Content.findById(contentId);
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