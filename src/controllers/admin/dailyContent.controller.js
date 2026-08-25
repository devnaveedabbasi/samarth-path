// controllers/admin/Content.controller.js
import Content from '../../models/Content.model.js';
import Prize from '../../models/Prize.model.js';
import Winner from '../../models/Winner.model.js';
import QuizAttempt from '../../models/QuizAttempt.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import moment from 'moment-timezone';
import ExcelJS from 'exceljs';
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import fs from "fs";
import { uploadOnS3 } from '../../utils/s3.js';
import { sendContentPublishedNotification } from '../notification.controller.js';
import { isUnlockTimePassed, TIMEZONE } from '../../utils/date.util.js';


ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const reencodeVideo = (inputPath) => {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(/\.mp4$/i, '_encoded.mp4')

    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-g 30',
        '-keyint_min 30',
        '-sc_threshold 0',
        '-movflags +faststart',
        '-c:a aac'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .run()
  })
}

// ffmpeg.setFfmpegPath(ffmpegPath);

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}



//  TEXT CONTENT

export async function createTextContent(req, res) {
  const adminId = req.user._id;
  const { title, description, label, scheduledDate, unlocksAt } = req.body;

  if (!title || !description || !label) {
    throw new ApiError(400, 'Title, description, and label are required.');
  }

  // Range create karein: Aaj ki subha 00:00 se raat 23:59 tak (India Time)
  const startOfDay = scheduledDate
    ? moment.tz(scheduledDate, TIMEZONE).startOf('day').toDate()
    : moment.tz(TIMEZONE).startOf('day').toDate();

  const endOfDay = moment(startOfDay).endOf('day').toDate();

  // 1. Duplicate Check (Range based taake timezone ka masla na ho)
  const existingText = await Content.findOne({
    date: { $gte: startOfDay, $lte: endOfDay },
    contentType: 'text',
    isDeleted: { $ne: true }
  });

  if (existingText) {
    throw new ApiError(400, `Text content for this date already exists.`);
  }

  const imageUrl = req.file ? req.file.path : null;
  const image = imageUrl ? await uploadOnS3({
    localFilePath: imageUrl,
    mimetype: req.file.mimetype,
    folder: "text-content-images",
    originalname: req.file.originalname,
  }) : null;

  // 2. Create Content
  const resolvedUnlocksAt = unlocksAt || '08:00';
  const initiallyActive = isUnlockTimePassed(startOfDay, resolvedUnlocksAt);

  let content;
  try {
    content = await Content.create({
      contentType: 'text',
      unlocksAt: resolvedUnlocksAt,
      // Forcefully UTC mein 12:00 PM par save karein taake date hamesha wahi rahay
      // Is se date ke piche janay ka chance khatam ho jata hai
      date: moment(startOfDay).add(12, 'hours').toDate(),
      textContent: { title, description, label, image: image ? image.secure_url : null },
      createdBy: adminId,
      // Locked until unlocksAt (today's unlock cron flips it on) unless that
      // time has already passed today, in which case publish it right away.
      isActive: initiallyActive,
      isNotified: initiallyActive
    });
  } catch (error) {
    // Two near-simultaneous requests can both pass the check above before
    // either has inserted — translate the unique-index failure into the
    // same friendly error instead of a raw Mongo error.
    if (error.code === 11000) {
      throw new ApiError(400, `Text content for this date already exists.`);
    }
    throw error;
  }

  if (initiallyActive) {
    await sendContentPublishedNotification(content);
  }

  res.status(201).json(
    new ApiResponse(201, content, 'Text content scheduled successfully.')
  );
}

export async function getTextContent(req, res) {
  const { date, search, status, page = 1, limit = 10 } = req.query;

  let queryFilter = { contentType: 'text', isDeleted: { $ne: true } };

  if (date) { queryFilter.date = date; }
  if (status !== undefined && status !== "") { queryFilter.isActive = status === "true"; }
  if (search) {
    queryFilter.$or = [
      { "textContent.title": { $regex: search, $options: "i" } },
      { "textContent.label": { $regex: search, $options: "i" } }
    ];
  }

  try {
    if (date) {
      const content = await Content.findOne(queryFilter);
      if (!content) return res.status(200).json(new ApiResponse(200, [], 'No text content found for this date.'));
      return res.status(200).json(new ApiResponse(200, content, 'Content retrieved successfully.'));
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const content = await Content.find(queryFilter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const totalItems = await Content.countDocuments(queryFilter);

    if (!content || content.length === 0) {
      return res.status(200).json(new ApiResponse(200, [], 'No text content found.'));
    }

    res.status(200).json(new ApiResponse(200, { content, pagination: { totalItems, currentPage: parseInt(page), totalPages: Math.ceil(totalItems / limit) } }, 'Content retrieved successfully.'));
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
  const { title, description, label, unlocksAt } = req.body;
  const { contentId } = req.params;

  if (!contentId) {
    throw new ApiError(400, "Content ID is required.");
  }

  const content = await Content.findById(contentId);

  if (!content) {
    throw new ApiError(404, "Content not found.");
  }

  const updateData = {};

  if (title) updateData["textContent.title"] = title;
  if (description) updateData["textContent.description"] = description;
  if (label) updateData["textContent.label"] = label;
  if (unlocksAt) updateData.unlocksAt = unlocksAt;


  if (req.file) {
    const upload = await uploadOnS3({
      localFilePath: req.file.path,
      mimetype: req.file.mimetype,
      folder: "text-content-images",
      originalname: req.file.originalname,
    });

    if (!upload) {
      throw new ApiError(500, "Image upload failed.");
    }

    updateData["textContent.image"] = upload.secure_url;
  }


  const updatedContent = await Content.findByIdAndUpdate(
    contentId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedContent) {
    throw new ApiError(404, "Content not found or update failed.");
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      updatedContent,
      "Text content updated successfully."
    )
  );
}

export async function deleteTextContent(req, res) {
  const { contentId } = req.params;
  if (!contentId) throw new ApiError(400, 'Content ID is required.');

  const content = await Content.findOneAndDelete({ _id: contentId, contentType: 'text' });
  if (!content) throw new ApiError(404, 'Content not found.');

  res.status(200).json(new ApiResponse(200, null, 'Text content deleted successfully.'));
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
    contentType: 'quiz',  
    isDeleted: { $ne: true }
  });

  if (existingQuiz) {
    throw new ApiError(400, `Quiz for ${quizDate.toDateString()} already exists.`);
  }

  const initiallyActive = isUnlockTimePassed(quizDate, unlocksAt);

  let content;
  try {
    content = await Content.create({
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
      createdBy: adminId,
      // Locked until unlocksAt (today's unlock cron flips it on) unless that
      // time has already passed today, in which case publish it right away.
      isActive: initiallyActive,
      isNotified: initiallyActive
    });
  } catch (error) {
    // Two near-simultaneous requests (e.g. a fast double-click) can both pass
    // the check above before either has inserted — the unique index is the
    // real guard here, so translate its failure into the same friendly error.
    if (error.code === 11000) {
      throw new ApiError(400, `Quiz for ${quizDate.toDateString()} already exists.`);
    }
    throw error;
  }

  // Send notification to all users about new quiz — only if it's actually visible now
  if (initiallyActive) {
    await sendContentPublishedNotification(content, adminId);
  }

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
  const { page = 1, limit = 10, search } = req.query;

  const query = { contentType: 'quiz', isDeleted: { $ne: true } };
  if (search) { query['quizContent.question'] = { $regex: search, $options: 'i' }; }

  let quizzes = await Content.find(query).sort({ date: -1 }).limit(limit * 1).skip((page - 1) * limit).lean();
  const total = await Content.countDocuments(query);

  if (!quizzes || quizzes.length === 0) {
    return res.status(200).json(new ApiResponse(200, [], 'No quizzes found in records.'));
  }

  const quizIds = quizzes.map(q => q._id);
  const prizes = await Prize.find({ quizId: { $in: quizIds }, isDeleted: { $ne: true } }).lean();
  const prizeMap = {};
  prizes.forEach(p => { prizeMap[p.quizId.toString()] = p; });

  quizzes = quizzes.map(q => ({
    ...q,
    prize: prizeMap[q._id.toString()] || null
  }));

  res.status(200).json(new ApiResponse(200, { quizzes, totalPages: Math.ceil(total / limit), currentPage: page, totalQuizzes: total }, 'Admin quizzes retrieved successfully.'));
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
  if (!contentId) throw new ApiError(400, 'Content ID is required.');

  const deleted = await Content.findOneAndDelete({ _id: contentId, contentType: 'quiz' });
  if (!deleted) throw new ApiError(404, 'Quiz not found.');

  res.status(200).json(new ApiResponse(200, null, 'Quiz deleted successfully.'));
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

// Resolve the Content(quiz) doc for a given calendar date, using the same
// date-normalization convention as createQuizContent (local midnight, no tz lib).
async function resolveQuizContentForDate(dateStr) {
  const target = dateStr ? new Date(dateStr) : new Date();
  target.setHours(0, 0, 0, 0);
  const nextDay = new Date(target);
  nextDay.setDate(nextDay.getDate() + 1);

  return Content.findOne({
    contentType: 'quiz',
    date: { $gte: target, $lt: nextDay },
    isDeleted: { $ne: true }
  });
}

export async function getQuizAttemptsByDate(req, res) {
  const { date, page = 1, limit = 20 } = req.query;
  if (!date) throw new ApiError(400, 'date query param is required (YYYY-MM-DD).');

  const quiz = await resolveQuizContentForDate(date);
  if (!quiz) {
    return res.status(200).json(new ApiResponse(200, {
      quiz: null, attempts: [], totalAttempts: 0, currentPage: 1, totalPages: 0
    }, 'No quiz found for this date.'));
  }

  const filter = { contentId: quiz._id };
  const [attempts, total] = await Promise.all([
    QuizAttempt.find(filter)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit),
    QuizAttempt.countDocuments(filter)
  ]);

  res.status(200).json(new ApiResponse(200, {
    quiz: { _id: quiz._id, quizContent: quiz.quizContent, date: quiz.date },
    attempts, totalAttempts: total, currentPage: parseInt(page),
    totalPages: Math.ceil(total / limit)
  }, 'Attempts retrieved successfully.'));
}

export async function exportQuizAttemptsExcel(req, res) {
  const { date } = req.query;
  if (!date) throw new ApiError(400, 'date query param is required (YYYY-MM-DD).');

  const quiz = await resolveQuizContentForDate(date);
  if (!quiz) throw new ApiError(404, 'No quiz found for this date.');

  const attempts = await QuizAttempt.find({ contentId: quiz._id })
    .populate('userId', 'name email phone')
    .sort({ createdAt: 1 });

  const optionTextById = Object.fromEntries(
    (quiz.quizContent?.options || []).map(o => [o.id, o.text])
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Quiz Attempts');
  sheet.columns = [
    { header: '#', key: 'sno', width: 5 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Selected Option', key: 'selected', width: 30 },
    { header: 'Correct Option', key: 'correct', width: 30 },
    { header: 'Is Correct', key: 'isCorrect', width: 12 },
    { header: 'Time Taken (s)', key: 'time', width: 15 },
    { header: 'Attempted At', key: 'attemptedAt', width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };

  attempts.forEach((a, i) => sheet.addRow({
    sno: i + 1,
    name: a.userId?.name || '',
    email: a.userId?.email || '',
    phone: a.userId?.phone || '',
    selected: optionTextById[a.selectedOptionId] || a.selectedOptionId,
    correct: optionTextById[quiz.quizContent?.correctOptionId] || quiz.quizContent?.correctOptionId,
    isCorrect: a.isCorrect ? 'Yes' : 'No',
    time: a.timeTakenSeconds,
    attemptedAt: a.createdAt ? new Date(a.createdAt).toLocaleString() : '',
  }));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="quiz-attempts-${date}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}


//  DAILY PRIZE (linked to a specific quiz)

export async function createDailyPrizeForQuiz(req, res) {
  const adminId = req.user._id;
  const { contentId } = req.params;
  const { title, description } = req.body;

  if (!title) {
    throw new ApiError(400, 'Prize title is required.');
  }

  const quiz = await Content.findOne({ _id: contentId, contentType: 'quiz' });
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found.');
  }

  const existingPrize = await Prize.findOne({ quizId: contentId, isDeleted: { $ne: true } });
  if (existingPrize) {
    throw new ApiError(400, 'A prize has already been added for this quiz. Use update instead.');
  }

  let imageUrl = null;
  if (req.file) {
    const uploaded = await uploadOnS3({
      localFilePath: req.file.path,
      mimetype: req.file.mimetype,
      folder: 'prize-images',
      originalname: req.file.originalname
    });

    if (!uploaded) {
      throw new ApiError(500, 'Prize image upload failed.');
    }
    imageUrl = uploaded.secure_url;
  }

  let prize;
  try {
    prize = await Prize.create({
      title,
      description,
      imageUrl,
      prizeType: 'daily',
      quizId: quiz._id,
      createdBy: adminId
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(400, 'A prize has already been added for this quiz. Use update instead.');
    }
    throw error;
  }

  res.status(201).json(
    new ApiResponse(201, prize, 'Daily prize added for this quiz successfully.')
  );
}

export async function getDailyPrizeForQuiz(req, res) {
  const { contentId } = req.params;

  const prize = await Prize.findOne({ quizId: contentId, isDeleted: { $ne: true } });

  res.status(200).json(
    new ApiResponse(200, prize || null, prize ? 'Daily prize retrieved successfully.' : 'No prize added for this quiz yet.')
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
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error("ffprobe error:", err);
          return resolve(0);
        }
        resolve(metadata?.format?.duration || 0);
      });
    });
  };

  let durationSeconds = 0;
  try {
    durationSeconds = await getVideoDuration(videoLocalPath);
  } catch (error) {
    console.error("Could not verify video duration, defaulting to 0:", error);
    durationSeconds = 0;
  }

  const videoDate = date ? new Date(date) : new Date();
  videoDate.setUTCHours(0, 0, 0, 0);

  const existingVideo = await Content.findOne({
    date: videoDate,
    contentType: "video",
    isDeleted: { $ne: true }
  });

  if (existingVideo) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    throw new ApiError(400, `Video content for ${videoDate.toDateString()} already exists.`);
  }

  const reencodeVideo = (inputPath) => {
    return new Promise((resolve, reject) => {
      const outputPath = inputPath.replace(/\.mp4$/i, '_encoded.mp4')
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-g 30',
          '-keyint_min 30',
          '-sc_threshold 0',
          '-movflags +faststart',
          '-c:a aac'
        ])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run()
    })
  }

  try {
    // ✅ Pehle encode karo
    const encodedVideoPath = await reencodeVideo(videoLocalPath)

    const videoUpload = await uploadOnS3({
      localFilePath: encodedVideoPath,  // ✅ encoded file upload hogi
      mimetype: req.files?.video?.[0]?.mimetype,
      folder: "videos",
      originalname: req.files?.video?.[0]?.originalname,
    });

    const thumbnailUpload = await uploadOnS3({
      localFilePath: thumbnailLocalPath,
      mimetype: req.files?.image?.[0]?.mimetype,
      folder: "thumbnails",
      originalname: req.files?.image?.[0]?.originalname,
    });

    // ✅ Dono files delete karo — original aur encoded
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(encodedVideoPath)) fs.unlinkSync(encodedVideoPath);

    if (!videoUpload || !thumbnailUpload) {
      throw new ApiError(500, "Failed to upload files to S3.");
    }
    console.log("Video uploaded to S3:", videoUpload);

    await Content.updateOne(
      {
        contentType: "video",
        date: videoDate,
        isDeleted: false
      },
      {
        $set: { isDeleted: true }
      }
    );

    const initiallyActive = isUnlockTimePassed(videoDate, unlocksAt);

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
      // Locked until unlocksAt (today's unlock cron flips it on) unless that
      // time has already passed today, in which case publish it right away.
      isActive: initiallyActive,
      isNotified: initiallyActive
    });

    // Send notification to all users about new video — only if it's actually visible now
    if (initiallyActive) {
      await sendContentPublishedNotification(content, adminId);
    }

    return res.status(201).json(
      new ApiResponse(201, content, "Video content created and uploaded successfully!")
    );

  } catch (error) {
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
    // Two near-simultaneous requests can both pass the pre-emptive soft-delete
    // above before either has inserted — translate the unique-index failure
    // into a friendly error instead of the raw Mongo message.
    if (error.code === 11000) {
      throw new ApiError(400, `Video content for ${videoDate.toDateString()} already exists.`);
    }
    throw new ApiError(500, error?.message || "Internal Server Error during upload.");
  }
}

export async function getAllVideoContent(req, res) {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = { contentType: 'video', isDeleted: { $ne: true } };
  const totalVideos = await Content.countDocuments(filter);
  const videos = await Content.find(filter).sort({ date: -1 }).skip(skip).limit(limit).populate('createdBy', 'name email');
  const totalPages = Math.ceil(totalVideos / limit);

  res.status(200).json(new ApiResponse(200, { videos, pagination: { totalVideos, totalPages, currentPage: page, pageSize: limit, hasNextPage: page < totalPages, hasPrevPage: page > 1 } }, 'Video content fetched successfully with pagination.'));
}


export async function getVideoById(req, res) {
  const { contentId } = req.params;

  if (!contentId) {
    throw new ApiError(400, "Video ID is required.");
  }

  const video = await Content.findOne({
    _id: contentId,
    contentType: 'video'
  }).populate('createdBy', 'name email');

  if (!video) {
    throw new ApiError(404, "Video content not found.");
  }

  res.status(200).json(
    new ApiResponse(200, video, "Video content fetched successfully.")
  );
}


export async function updateVideoContent(req, res) {
  const { contentId: id } = req.params;
  const { title, description, unlocksAt, hasListenOnlyMode } = req.body || {};

  // 1. Content find karo
  const content = await Content.findOne({ _id: id, contentType: "video", isDeleted: { $ne: true } });
  if (!content) {
    throw new ApiError(404, "Video content not found.");
  }

  // 2. Sirf aaj ki content update ho sakti hai
  const now = moment().tz(TIMEZONE);
  const startOfDay = now.clone().startOf('day').toDate();
  const endOfDay = now.clone().endOf('day').toDate();

  const contentDate = new Date(content.date);
  if (contentDate < startOfDay || contentDate > endOfDay) {
    throw new ApiError(400, "Today's video content can only be updated.");
  }

  // 3. File Paths
  const videoLocalPath = req.files?.video?.[0]?.path;
  const thumbnailLocalPath = req.files?.image?.[0]?.path;

  // 4. Duration Validation + Re-encode
  let durationSeconds = content.videoContent.durationSeconds;
  let encodedVideoPath = null;

  if (videoLocalPath) {
    try {
      const getVideoDuration = (filePath) => new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            console.error("ffprobe error:", err);
            return resolve(0);
          }
          resolve(metadata?.format?.duration || 0);
        });
      });

      durationSeconds = await getVideoDuration(videoLocalPath);

      // Ab re-encode karo
      const reencodeVideo = (inputPath) => {
        return new Promise((resolve, reject) => {
          const outputPath = inputPath.replace(/\.mp4$/i, '_encoded.mp4')
          ffmpeg(inputPath)
            .outputOptions([
              '-c:v libx264',
              '-g 30',
              '-keyint_min 30',
              '-sc_threshold 0',
              '-movflags +faststart',
              '-c:a aac'
            ])
            .output(outputPath)
            .on('end', () => resolve(outputPath))
            .on('error', reject)
            .run()
        })
      }

      encodedVideoPath = await reencodeVideo(videoLocalPath);

    } catch (error) {
      if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
      if (encodedVideoPath && fs.existsSync(encodedVideoPath)) fs.unlinkSync(encodedVideoPath);
      if (thumbnailLocalPath && fs.existsSync(thumbnailLocalPath)) fs.unlinkSync(thumbnailLocalPath);
      throw new ApiError(400, error.message || "Could not process video file.");
    }
  }

  // 5. S3 Upload
  let videoUrl = content.videoContent.videoUrl;
  let thumbnailUrl = content.videoContent.thumbnail;

  if (videoLocalPath && encodedVideoPath) {
    const videoUpload = await uploadOnS3({
      localFilePath: encodedVideoPath,
      mimetype: req.files?.video?.[0]?.mimetype,
      folder: "videos",
      originalname: req.files?.video?.[0]?.originalname,
    });

    // Dono files delete karo
    if (fs.existsSync(videoLocalPath)) fs.unlinkSync(videoLocalPath);
    if (fs.existsSync(encodedVideoPath)) fs.unlinkSync(encodedVideoPath);

    if (!videoUpload) throw new ApiError(500, "Failed to upload video to AWS S3.");
    videoUrl = videoUpload.secure_url;
  }

  if (thumbnailLocalPath) {
    const thumbnailUpload = await uploadOnS3({
      localFilePath: thumbnailLocalPath,
      mimetype: req.files?.image?.[0]?.mimetype,
      folder: "thumbnails",
      originalname: req.files?.image?.[0]?.originalname,
    });
    if (!thumbnailUpload) throw new ApiError(500, "Failed to upload thumbnail to AWS S3.");
    thumbnailUrl = thumbnailUpload.secure_url;
  }

  // 6. Update
  const updateData = {
    unlocksAt: unlocksAt || content.unlocksAt,
    "videoContent.title": title || content.videoContent.title,
    "videoContent.description": description || content.videoContent.description,
    "videoContent.videoUrl": videoUrl,
    "videoContent.thumbnail": thumbnailUrl,
    "videoContent.durationSeconds": Math.round(durationSeconds),
    "videoContent.isAutoMute": true,
    "videoContent.hasListenOnlyMode": hasListenOnlyMode !== undefined
      ? (hasListenOnlyMode === "true" || hasListenOnlyMode === true)
      : content.videoContent.hasListenOnlyMode,
  };

  const updatedContent = await Content.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true }
  );

  return res.status(200).json(
    new ApiResponse(200, updatedContent, "Video content updated successfully!")
  );
}

export async function deleteVideoContent(req, res) {
  const { contentId } = req.params;
  if (!contentId) throw new ApiError(400, 'Content ID is required.');

  const deleted = await Content.findOneAndDelete({ _id: contentId, contentType: 'video' });
  if (!deleted) throw new ApiError(404, 'Video content not found.');

  res.status(200).json(new ApiResponse(200, null, 'Video content deleted successfully.'));
}



// export async function getContentList(req, res) {
//   const { date } = req.query;
//   let query = { isActive: true };

//   if (date) {
//     const targetDate = new Date(date);
//     targetDate.setHours(0, 0, 0, 0);
//     const nextDate = new Date(targetDate);
//     nextDate.setDate(nextDate.getDate() + 1);
//     query.date = { $gte: targetDate, $lt: nextDate };
//   }

//   const content = await Content.find(query).sort({ createdAt: -1 }).limit(100);

//   res.status(200).json(
//     new ApiResponse(200, content, 'Daily content list retrieved.')
//   );
// }

// export async function updateContent(req, res) {
//   const { contentId } = req.params;
//   const updateData = req.body;

//   const content = await Content.findById(contentId);
//   if (!content) {
//     throw new ApiError(404, 'Content not found.');
//   }

//   // Prevent changing content type
//   if (updateData.contentType && updateData.contentType !== content.contentType) {
//     throw new ApiError(400, 'Cannot change content type.');
//   }

//   Object.assign(content, updateData);
//   await content.save();

//   res.status(200).json(
//     new ApiResponse(200, content, 'Content updated successfully.')
//   );
// }

// export async function deleteContent(req, res) {
//   const { contentId } = req.params;

//   const content = await Content.findById(contentId);
//   if (!content) {
//     throw new ApiError(404, 'Content not found.');
//   }

//   content.isActive = false;
//   await content.save();

//   res.status(200).json(
//     new ApiResponse(200, {}, 'Content deleted successfully.')
//   );
// }



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