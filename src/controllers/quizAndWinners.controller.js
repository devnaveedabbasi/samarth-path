import DailyContent from '../models/Content.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

// ─── Week Info Helper ────────────────────────────────────────
function getWeekInfo(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { weekNumber, year: date.getFullYear() };
}

// ─── Submit Quiz Answer ──────────────────────────────────────
export async function submitQuizAnswer(req, res) {
  const userId = req.user._id;
  const { contentId, selectedOptionId, timeTakenSeconds } = req.body;

  if (!contentId || !selectedOptionId) {
    throw new ApiError(400, 'Content ID and selected option are required.');
  }

  const content = await DailyContent.findById(contentId);
  if (!content || content.contentType !== 'quiz') {
    throw new ApiError(404, 'Quiz content not found.');
  }

  const existingAttempt = await QuizAttempt.findOne({ userId, contentId });
  if (existingAttempt) {
    throw new ApiError(400, 'You have already submitted an answer for this quiz.');
  }

  const quizContent = content.quizContent;

  const selectedOption = quizContent.options.find(
    opt => String(opt.id) === String(selectedOptionId)
  );
  if (!selectedOption) {
    throw new ApiError(400, 'Invalid option selected.');
  }

  const isCorrect = String(selectedOptionId) === String(quizContent.correctOptionId);

  const { weekNumber, year } = getWeekInfo();

  const quiz_attempt = await QuizAttempt.create({
    userId,
    contentId,
    selectedOptionId,
    isCorrect,
    timeTakenSeconds: timeTakenSeconds || 0,
    weekNumber,
    year,
    dayNumber: new Date().getDate()
  });

  res.status(201).json(
    new ApiResponse(
      201,
      {
        attemptId: quiz_attempt._id,
        isCorrect,
        correctOptionId: quizContent.correctOptionId,
        explanation: quizContent.explanation,
        score: isCorrect ? 1 : 0
      },
      isCorrect ? 'Correct answer! ' : 'Incorrect answer. '
    )
  );
}

// ─── Get Weekly Score + User Ranking ────────────────────────
export async function getWeeklyScore(req, res) {
  const userId = req.user._id;
  const { weekNumber, year } = getWeekInfo();

  const userAttempts = await QuizAttempt.find({
    userId,
    weekNumber,
    year,
  }).lean();

  const totalAttempts = userAttempts.length;
  const correctAnswers = userAttempts.filter(a => a.isCorrect).length;
  const wrongAnswers = totalAttempts - correctAnswers;

  // Saare users ka score — ranking ke liye
  const allScores = await QuizAttempt.aggregate([
    {
      $match: { weekNumber, year, isCorrect: true }
    },
    {
      $group: {
        _id: '$userId',
        score: { $sum: 1 },
        firstAttemptTime: { $min: '$createdAt' }
      }
    },
    {
      $sort: { score: -1, firstAttemptTime: 1 }
    }
  ]);

  // Is user ki rank dhundo
  const userRankIndex = allScores.findIndex(
    s => s._id.toString() === userId.toString()
  );
  const userRank = userRankIndex !== -1 ? userRankIndex + 1 : null;

  res.status(200).json(
    new ApiResponse(
      200,
      {
        weekNumber,
        year,
        totalQuestions: totalAttempts,
        correctAnswers,
        wrongAnswers,
        score: `${correctAnswers}/${totalAttempts}`,
        accuracy: totalAttempts > 0
          ? ((correctAnswers / totalAttempts) * 100).toFixed(1) + '%'
          : '0%',
        rank: userRank,                        // is week mein user ki rank
        totalParticipants: allScores.length,   // kitne log participate kar rahe hain
      },
      'Weekly score retrieved successfully.'
    )
  );
}

// ─── Get Winners ─────────────────────────────────────────────

// export async function getWinners(req, res) {
//   const now = new Date();
//   const currentWeek = getWeekInfo(now);

//   const lastWeekDate = new Date(now);
//   lastWeekDate.setDate(lastWeekDate.getDate() - 7);
//   const lastWeek = getWeekInfo(lastWeekDate);

//   // ── Current week — Real-time QuizAttempt data ──
//   const currentWeekAttempts = await QuizAttempt.aggregate([
//     {
//       $match: {
//         weekNumber: currentWeek.weekNumber,
//         year: currentWeek.year,
//         isCorrect: true
//       }
//     },
//     {
//       $group: {
//         _id: '$userId',
//         score: { $sum: 1 },
//         firstAttemptTime: { $min: '$createdAt' }
//       }
//     },
//     { $sort: { score: -1, firstAttemptTime: 1 } },
//     {
//       $lookup: {
//         from: 'users',
//         localField: '_id',
//         foreignField: '_id',
//         as: 'user'
//       }
//     },
//     { $unwind: '$user' },
//     {
//       $project: {
//         userId: '$_id',
//         userName: '$user.name',
//         profilePicture: '$user.profilePicture',
//         score: 1,
//         firstAttemptTime: 1,
//         _id: 0
//       }
//     }
//   ]);

//   const currentWeekAllUsers = currentWeekAttempts.map((user, index) => ({
//     ...user,
//     rank: index + 1,
//     isTopThree: index < 3
//   }));

//   // ── Last week — Winner model (official) + all participants ──
//   const [lastWeekAnnounced, lastWeekAttempts] = await Promise.all([
//     Winner.find({
//       weekNumber: lastWeek.weekNumber,
//       year: lastWeek.year,
//       cycleType: 'weekly'
//     })
//       .populate('userId', 'name profilePicture')
//       .sort({ rank: 1 })
//       .lean(),

//     QuizAttempt.aggregate([
//       {
//         $match: {
//           weekNumber: lastWeek.weekNumber,
//           year: lastWeek.year,
//           isCorrect: true
//         }
//       },
//       {
//         $group: {
//           _id: '$userId',
//           score: { $sum: 1 },
//           firstAttemptTime: { $min: '$createdAt' }
//         }
//       },
//       { $sort: { score: -1, firstAttemptTime: 1 } },
//       {
//         $lookup: {
//           from: 'users',
//           localField: '_id',
//           foreignField: '_id',
//           as: 'user'
//         }
//       },
//       { $unwind: '$user' },
//       {
//         $project: {
//           userId: '$_id',
//           userName: '$user.name',
//           profilePicture: '$user.profilePicture',
//           score: 1,
//           firstAttemptTime: 1,
//           _id: 0
//         }
//       }
//     ])
//   ]);

//   const lastWeekAllUsers = lastWeekAttempts.map((user, index) => ({
//     ...user,
//     rank: index + 1,
//     isTopThree: index < 3
//   }));

//   // ── Last week top3: Use Winner collection if available, else calculate from attempts ──
//   let lastWeekTop3 = [];

//   if (lastWeekAnnounced.length > 0) {
//     // If official winners exist, use them
//     lastWeekTop3 = lastWeekAnnounced.map(w => ({
//       rank: w.rank,
//       score: w.score,
//       userId: w.userId?._id,
//       userName: w.userId?.name,
//       profilePicture: w.userId?.profilePicture,
//       firstAttemptTime: w.createdAt,
//       isTopThree: true
//     }));
//   } else {
//     // Fallback: Calculate top 3 from all participants (same as current week logic)
//     lastWeekTop3 = lastWeekAllUsers.slice(0, 3).map(user => ({
//       ...user,
//       isTopThree: true
//     }));
//   }

//   res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         currentWeek: {
//           week: currentWeek.weekNumber,
//           year: currentWeek.year,
//           isLive: true,
//           note: 'Updates as users attempt quizzes. Final winners announced Sunday.',
//           totalParticipants: currentWeekAllUsers.length,
//           top3: currentWeekAllUsers.slice(0, 3),
//           allParticipants: currentWeekAllUsers
//         },
//         lastWeek: {
//           week: lastWeek.weekNumber,
//           year: lastWeek.year,
//           isLive: false,
//           totalParticipants: lastWeekAllUsers.length,
//           top3: lastWeekTop3,
//           allParticipants: lastWeekAllUsers
//         }
//       },
//       'Weekly winners retrieved successfully.'
//     )
//   );
// }


export async function getWinners(req, res) {
  const now = new Date();
  const { days } = req.query;

  // ── ?days=10 → sirf last10Days ──
  if (days === '10') {
    const last10DaysDate = new Date(now);
    last10DaysDate.setDate(last10DaysDate.getDate() - 10);

    const last10DaysAttempts = await QuizAttempt.aggregate([
      {
        $match: {
          createdAt: { $gte: last10DaysDate, $lte: now },
          isCorrect: true
        }
      },
      {
        $group: {
          _id: '$userId',
          score: { $sum: 1 },
          firstAttemptTime: { $min: '$createdAt' }
        }
      },
      { $sort: { score: -1, firstAttemptTime: 1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $project: {
          userId: '$_id',
          userName: '$user.name',
          profilePicture: '$user.profilePicture',
          score: 1,
          firstAttemptTime: 1,
          _id: 0
        }
      }
    ]);

    const last10DaysUsers = last10DaysAttempts.map((user, index) => ({
      ...user,
      rank: index + 1
    }));

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          last10Days: {
            totalParticipants: last10DaysUsers.length,
            allParticipants: last10DaysUsers
          }
        },
        'Last 10 days winners retrieved successfully.'
      )
    );
  }

  // ── Default: sirf current week ──
  const currentWeek = getWeekInfo(now);

  const currentWeekAttempts = await QuizAttempt.aggregate([
    {
      $match: {
        weekNumber: currentWeek.weekNumber,
        year: currentWeek.year,
        isCorrect: true
      }
    },
    {
      $group: {
        _id: '$userId',
        score: { $sum: 1 },
        firstAttemptTime: { $min: '$createdAt' }
      }
    },
    { $sort: { score: -1, firstAttemptTime: 1 } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    {
      $project: {
        userId: '$_id',
        userName: '$user.name',
        profilePicture: '$user.profilePicture',
        score: 1,
        firstAttemptTime: 1,
        _id: 0
      }
    }
  ]);

  const currentWeekAllUsers = currentWeekAttempts.map((user, index) => ({
    ...user,
    rank: index + 1,
    isTopThree: index < 3
  }));

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        currentWeek: {
          week: currentWeek.weekNumber,
          year: currentWeek.year,
          isLive: true,
          note: 'Updates as users attempt quizzes. Final winners announced Sunday.',
          totalParticipants: currentWeekAllUsers.length,
          top3: currentWeekAllUsers.slice(0, 3),
          allParticipants: currentWeekAllUsers
        }
      },
      'Weekly winners retrieved successfully.'
    )
  );
}


// export async function getWinners(req, res) {
//   const now = new Date();

//   // ── Today boundaries ────────────────────────────────────────
//   const todayStart = new Date(now);
//   todayStart.setHours(0, 0, 0, 0);
//   const todayEnd = new Date(now);
//   todayEnd.setHours(23, 59, 59, 999);

//   // ── Past 10 days (yesterday se 10 din peeche) ───────────────
//   const past10Days = [];
//   for (let i = 1; i <= 10; i++) {
//     const date = new Date(now);
//     date.setDate(date.getDate() - i);
//     const dayStart = new Date(date);
//     dayStart.setHours(0, 0, 0, 0);
//     const dayEnd = new Date(date);
//     dayEnd.setHours(23, 59, 59, 999);
//     past10Days.push({
//       date: date.toISOString().split('T')[0],
//       dayStart,
//       dayEnd
//     });
//   }

//   // ── Helper: ek din ke attempts ──────────────────────────────
//   const getDayAttempts = async (dayStart, dayEnd) => {
//     const attempts = await QuizAttempt.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: dayStart, $lte: dayEnd },
//           isCorrect: true
//         }
//       },
//       {
//         $group: {
//           _id: '$userId',
//           score: { $sum: 1 },
//           firstAttemptTime: { $min: '$createdAt' }
//         }
//       },
//       { $sort: { score: -1, firstAttemptTime: 1 } },
//       {
//         $lookup: {
//           from: 'users',
//           localField: '_id',
//           foreignField: '_id',
//           as: 'user'
//         }
//       },
//       { $unwind: '$user' },
//       {
//         $project: {
//           userId: '$_id',
//           userName: '$user.name',
//           profilePicture: '$user.profilePicture',
//           score: 1,
//           firstAttemptTime: 1,
//           _id: 0
//         }
//       }
//     ]);

//     return attempts.map((user, index) => ({
//       ...user,
//       rank: index + 1,
//       isTopThree: index < 3
//     }));
//   };

//   // ── Today ───────────────────────────────────────────────────
//   const todayAttempts = await getDayAttempts(todayStart, todayEnd);

//   // ── Past 10 days ────────────────────────────────────────────
//   const pastDaysData = await Promise.all(
//     past10Days.map(async ({ date, dayStart, dayEnd }) => {
//       const attempts = await getDayAttempts(dayStart, dayEnd);
//       return {
//         date,
//         totalParticipants: attempts.length,
//         winner: attempts.length > 0 ? attempts[0] : null,
//         allParticipants: attempts
//       };
//     })
//   );

//   res.status(200).json(
//     new ApiResponse(
//       200,
//       {
//         today: {
//           date: now.toISOString().split('T')[0],
//           isLive: true,
//           note: 'Updates as users attempt quizzes. Final winner announced at midnight.',
//           totalParticipants: todayAttempts.length,
//           winner: todayAttempts.length > 0 ? todayAttempts[0] : null,
//           allParticipants: todayAttempts
//         },
//         pastDays: pastDaysData
//       },
//       'Daily winners retrieved successfully.'
//     )
//   );
// }