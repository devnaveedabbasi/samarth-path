// controllers/admin/prize.controller.js
import Prize from '../../models/Prize.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { uploadOnS3 } from '../../utils/s3.js';

// Our week runs Monday → Sunday (weekly winner is selected/announced once the
// week is complete — see admin/winner.controller.js#selectWeeklyWinner).
// Same Monday-start + ISO week-number logic already used by
// admin/winner.controller.js#getWeeklyQuizAttempters, so a weekly prize always
// lines up with the week the winner-selection screens are looking at.
function getCurrentWeekInfo() {
  const today = new Date();

  const startOfWeek = new Date(today);
  const day = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
  endOfWeek.setHours(23, 59, 59, 999);

  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNumber = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

  return { weekNumber, year: today.getFullYear(), startOfWeek, endOfWeek };
}

// Tells the admin which week is currently in progress, so the "Create Weekly
// Prize" step always targets the right week without manual entry.
export async function getCurrentWeek(req, res) {
  const weekInfo = getCurrentWeekInfo();

  const existing = await Prize.findOne({
    prizeType: 'weekly',
    weekNumber: weekInfo.weekNumber,
    year: weekInfo.year,
    isDeleted: { $ne: true }
  });

  res.status(200).json(
    new ApiResponse(200, { ...weekInfo, prizeAlreadyExists: !!existing }, 'Current week retrieved successfully.')
  );
}

// Weekly prizes are created ahead of time here (not tied to a specific quiz).
// weekNumber/year are never taken from the client — always the current
// Monday–Sunday week, computed server-side.
// Daily prizes are created via the quiz flow — see
// admin/dailyContent.controller.js#createDailyPrizeForQuiz.
export async function createWeeklyPrize(req, res) {
  const adminId = req.user._id;
  const { title, description } = req.body;

  if (!title) {
    throw new ApiError(400, 'Title is required.');
  }

  const { weekNumber, year } = getCurrentWeekInfo();

  const existing = await Prize.findOne({
    prizeType: 'weekly',
    weekNumber,
    year,
    isDeleted: { $ne: true }
  });

  if (existing) {
    throw new ApiError(400, `A weekly prize for the current week (Week ${weekNumber}, ${year}) already exists.`);
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
      prizeType: 'weekly',
      weekNumber,
      year,
      createdBy: adminId
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new ApiError(400, `A weekly prize for the current week (Week ${weekNumber}, ${year}) already exists.`);
    }
    throw error;
  }

  res.status(201).json(
    new ApiResponse(201, prize, 'Weekly prize created successfully.')
  );
}

export async function getDailyPrizes(req, res) {
  const { page = 1, limit = 10, search } = req.query;

  const query = { prizeType: 'daily', isDeleted: { $ne: true } };
  if (search) query.title = { $regex: search, $options: 'i' };

  const prizes = await Prize.find(query)
    .populate('quizId', 'quizContent.title date')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Prize.countDocuments(query);

  res.status(200).json(
    new ApiResponse(200, {
      prizes,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      totalPrizes: total
    }, 'Daily prizes retrieved successfully.')
  );
}

export async function getWeeklyPrizes(req, res) {
  const { page = 1, limit = 10, search } = req.query;

  const query = { prizeType: 'weekly', isDeleted: { $ne: true } };
  if (search) query.title = { $regex: search, $options: 'i' };

  const prizes = await Prize.find(query)
    .sort({ year: -1, weekNumber: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Prize.countDocuments(query);

  res.status(200).json(
    new ApiResponse(200, {
      prizes,
      totalPages: Math.ceil(total / limit),
      currentPage: Number(page),
      totalPrizes: total
    }, 'Weekly prizes retrieved successfully.')
  );
}

// Title/description/image are editable. weekNumber/year (weekly) and quizId
// (daily) are set once at creation and never change afterwards — they anchor
// the prize to a specific week/quiz, so editing them here would let a prize
// silently drift onto a different week/quiz than the one shown when it was created.
export async function updatePrize(req, res) {
  const { prizeId } = req.params;
  const { title, description } = req.body;

  const prize = await Prize.findOne({ _id: prizeId, isDeleted: { $ne: true } });
  if (!prize) {
    throw new ApiError(404, 'Prize not found.');
  }

  if (title !== undefined) prize.title = title;
  if (description !== undefined) prize.description = description;

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
    prize.imageUrl = uploaded.secure_url;
  }

  await prize.save();

  res.status(200).json(
    new ApiResponse(200, prize, 'Prize updated successfully.')
  );
}

export async function deletePrize(req, res) {
  const { prizeId } = req.params;

  const prize = await Prize.findOneAndUpdate(
    { _id: prizeId, isDeleted: { $ne: true } },
    { $set: { isDeleted: true } },
    { new: true }
  );

  if (!prize) {
    throw new ApiError(404, 'Prize not found or already deleted.');
  }

  res.status(200).json(
    new ApiResponse(200, null, 'Prize deleted successfully.')
  );
}
