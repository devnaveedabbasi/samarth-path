import DailyContent from '../models/Content.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Winner from '../models/Winner.model.js';
import Prize from '../models/Prize.model.js';
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

// ─── Helper: day range (local midnight → 23:59:59.999) for a given date ──
function getDayRange(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// ─── Get My Prizes (prizes for quizzes/weeks the logged-in user actually won) ──
export async function getMyPrizes(req, res) {
  const userId = req.user._id;

  const winners = await Winner.find({ userId })
    .sort({ winnerDate: -1, createdAt: -1 })
    .lean();

  const prizes = [];

  for (const winner of winners) {
    let prize = null;
    let quiz = null;

    if (winner.cycleType === 'daily') {
      const { start, end } = getDayRange(winner.winnerDate || winner.createdAt);
      quiz = await DailyContent.findOne({
        contentType: 'quiz',
        isDeleted: { $ne: true },
        date: { $gte: start, $lte: end }
      }).lean();

      if (quiz) {
        prize = await Prize.findOne({ quizId: quiz._id, isDeleted: { $ne: true } }).lean();
      }
    } else {
      prize = await Prize.findOne({
        prizeType: 'weekly',
        weekNumber: winner.weekNumber,
        year: winner.year,
        isDeleted: { $ne: true }
      }).lean();
    }

    if (!prize) continue;

    prizes.push({
      winnerId: winner._id,
      cycleType: winner.cycleType,
      weekNumber: winner.weekNumber,
      year: winner.year,
      winnerDate: winner.winnerDate,
      rank: winner.rank,
      score: winner.score,
      quiz: quiz ? { id: quiz._id, title: quiz.quizContent?.title, date: quiz.date } : undefined,
      prize: {
        id: prize._id,
        title: prize.title,
        description: prize.description,
        imageUrl: prize.imageUrl,
        prizeType: prize.prizeType
      }
    });
  }

  res.status(200).json(
    new ApiResponse(
      200,
      { count: prizes.length, prizes },
      'Your prizes retrieved successfully.'
    )
  );
}

// ─── Get Prize Details (single prize, only if the user actually won it) ──
export async function getPrizeDetails(req, res) {
  const userId = req.user._id;
  const { prizeId } = req.params;

  const prize = await Prize.findOne({ _id: prizeId, isDeleted: { $ne: true } });
  if (!prize) {
    throw new ApiError(404, 'Prize not found.');
  }

  let winner = null;
  let quiz = null;

  if (prize.prizeType === 'daily') {
    quiz = await DailyContent.findById(prize.quizId);
    if (!quiz) {
      throw new ApiError(404, 'Prize not found.');
    }

    const { start, end } = getDayRange(quiz.date);
    winner = await Winner.findOne({
      userId,
      cycleType: 'daily',
      winnerDate: { $gte: start, $lte: end }
    });
  } else {
    winner = await Winner.findOne({
      userId,
      cycleType: 'weekly',
      weekNumber: prize.weekNumber,
      year: prize.year
    });
  }

  if (!winner) {
    throw new ApiError(403, 'You are not authorized to view this prize.');
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        id: prize._id,
        title: prize.title,
        description: prize.description,
        imageUrl: prize.imageUrl,
        prizeType: prize.prizeType,
        assignedAt: prize.createdAt,
        quiz: quiz ? { id: quiz._id, title: quiz.quizContent?.title, date: quiz.date } : undefined,
        winner: {
          winnerId: winner._id,
          cycleType: winner.cycleType,
          weekNumber: winner.weekNumber,
          year: winner.year,
          winnerDate: winner.winnerDate,
          rank: winner.rank,
          score: winner.score
        }
      },
      'Prize details retrieved successfully.'
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
  try {

    const now = new Date();
    const { days, daily, weekly, lastWeek } = req.query;

    const toPrizeObj = (prizeDoc) =>
      prizeDoc
        ? {
            prizeId: prizeDoc._id,
            title: prizeDoc.title,
            description: prizeDoc.description,
            imageUrl: prizeDoc.imageUrl,
            prizeType: prizeDoc.prizeType
          }
        : null;

    // Marks every participant in `participants` who has ANY announced winner
    // record (daily or weekly) inside [periodStart, periodEnd] with the prize
    // they won — not just the single "official" winner of that block's own
    // cycleType, so e.g. a daily winner from earlier in the week still shows
    // up as a winner inside the weekly participants list.
    const markWinnersInParticipants = async (participants, periodStart, periodEnd) => {
      const periodWinners = await Winner.find({
        winnerDate: { $gte: periodStart, $lte: periodEnd }
      }).populate('prizeId', 'title description imageUrl prizeType');

      const winnerMap = new Map();
      periodWinners.forEach((w) => winnerMap.set(w.userId.toString(), w));

      participants.forEach((item) => {
        const w = winnerMap.get(item.userId.toString());
        if (w) {
          item.isWinner = true;
          item.prize = toPrizeObj(w.prizeId);
        }
      });
    };

    // ── DAILY: Current day attempters + ONE winner ──
    if (daily === 'true') {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);

      // Get all attempters for today with sorting
      const dailyAttempters = await QuizAttempt.aggregate([
        {
          $match: {
            createdAt: {
              $gte: startOfDay,
              $lt: endOfDay
            }
          }
        },
        {
          $group: {
            _id: '$userId',
            totalQuestions: { $sum: 1 },
            correctAnswers: {
              $sum: { $cond: ['$isCorrect', 1, 0] }
            },
            totalTime: { $sum: '$timeTakenSeconds' },
            firstAttemptAt: { $min: '$createdAt' }
          }
        },
        {
          $match: {
            correctAnswers: { $gt: 0 }
          }
        },
        {
          $addFields: {
            accuracy: {
              $multiply: [
                { $divide: ['$correctAnswers', '$totalQuestions'] },
                100
              ]
            }
          }
        },
        {
          $sort: {
            correctAnswers: -1,
            accuracy: -1,
            totalTime: 1,
            firstAttemptAt: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            userName: '$user.name',
            email: '$user.email',
            profilePicture: '$user.profilePicture',
            score: '$correctAnswers',
            stats: {
              totalQuestions: 1,
              correctAnswers: 1,
              accuracy: 1,
              totalTime: 1,
              firstAttemptAt: 1
            },
            _id: 0
          }
        }
      ]);

      // Format with rank
      const formattedAttempters = dailyAttempters.map((item, index) => ({
        rank: index + 1,
        ...item
      }));

      // ✅ Get ONLY ONE daily winner (admin selected)
      const dailyWinner = await Winner.findOne({
        cycleType: 'daily',
        winnerDate: {
          $gte: startOfDay,
          $lt: endOfDay
        }
      })
        .populate('userId', 'name email profilePicture')
        .populate('prizeId', 'title description imageUrl prizeType');

      let winner = null;
      if (dailyWinner) {
        // Find winner stats from attempters
        const winnerStats = dailyAttempters.find(
          (item) => item.userId.toString() === dailyWinner.userId._id.toString()
        );

        winner = {
          userId: dailyWinner.userId._id,
          name: dailyWinner.userId.name,
          email: dailyWinner.userId.email,
          profilePicture: dailyWinner.userId.profilePicture || null,
          score: winnerStats?.stats?.correctAnswers ?? dailyWinner.score ?? 0,
          stats: winnerStats?.stats || {
            totalQuestions: 0,
            correctAnswers: dailyWinner.score || 0,
            accuracy: 0,
            totalTime: 0,
            firstAttemptAt: dailyWinner.winnerDate
          },
          selectedAt: dailyWinner.winnerDate,
          rank: dailyWinner.rank || 1,
          prize: dailyWinner.prizeId
            ? {
                prizeId: dailyWinner.prizeId._id,
                title: dailyWinner.prizeId.title,
                description: dailyWinner.prizeId.description,
                imageUrl: dailyWinner.prizeId.imageUrl,
                prizeType: dailyWinner.prizeId.prizeType
              }
            : null
        };
      }

      // ✅ Mark any announced winner (daily or weekly) inside allParticipants, with prize image
      await markWinnersInParticipants(formattedAttempters, startOfDay, endOfDay);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            daily: {
              date: now.toISOString().split('T')[0],
              totalParticipants: formattedAttempters.length,
              winner: winner, // ✅ Only ONE winner (or null)
              allParticipants: formattedAttempters
            }
          },
          'Daily attempters and winner retrieved successfully.'
        )
      );
    }

    // ── WEEKLY: Current week attempters + ONE winner ──
    if (weekly === 'true') {
      const startOfWeek = new Date(now);
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      // Get all attempters for current week with sorting
      const weeklyAttempters = await QuizAttempt.aggregate([
        {
          $match: {
            createdAt: {
              $gte: startOfWeek,
              $lte: endOfWeek
            }
          }
        },
        {
          $group: {
            _id: '$userId',
            totalQuestions: { $sum: 1 },
            correctAnswers: {
              $sum: { $cond: ['$isCorrect', 1, 0] }
            },
            totalTime: { $sum: '$timeTakenSeconds' },
            firstAttemptAt: { $min: '$createdAt' }
          }
        },
        {
          $match: {
            correctAnswers: { $gt: 0 }
          }
        },
        {
          $addFields: {
            accuracy: {
              $multiply: [
                { $divide: ['$correctAnswers', '$totalQuestions'] },
                100
              ]
            }
          }
        },
        {
          $sort: {
            correctAnswers: -1,
            accuracy: -1,
            totalTime: 1,
            firstAttemptAt: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            userName: '$user.name',
            email: '$user.email',
            profilePicture: '$user.profilePicture',
            score: '$correctAnswers',
            stats: {
              totalQuestions: 1,
              correctAnswers: 1,
              accuracy: 1,
              totalTime: 1,
              firstAttemptAt: 1
            },
            _id: 0
          }
        }
      ]);

      // Format with rank
      const formattedAttempters = weeklyAttempters.map((item, index) => ({
        rank: index + 1,
        ...item
      }));

      // Get week number
      const getWeekNumber = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
      };

      const weekNumber = getWeekNumber(now);

      // ✅ Get ONLY ONE weekly winner (admin selected)
      const weeklyWinner = await Winner.findOne({
        cycleType: 'weekly',
        weekNumber: weekNumber,
        year: now.getFullYear()
      })
        .populate('userId', 'name email profilePicture')
        .populate('prizeId', 'title description imageUrl prizeType');

      let winner = null;
      if (weeklyWinner) {
        // Find winner stats from attempters
        const winnerStats = weeklyAttempters.find(
          (item) => item.userId.toString() === weeklyWinner.userId._id.toString()
        );

        winner = {
          userId: weeklyWinner.userId._id,
          name: weeklyWinner.userId.name,
          email: weeklyWinner.userId.email,
          profilePicture: weeklyWinner.userId.profilePicture || null,
          score: winnerStats?.stats?.correctAnswers ?? weeklyWinner.score ?? 0,
          stats: winnerStats?.stats || {
            totalQuestions: 0,
            correctAnswers: weeklyWinner.score || 0,
            accuracy: 0,
            totalTime: 0,
            firstAttemptAt: weeklyWinner.winnerDate
          },
          selectedAt: weeklyWinner.winnerDate,
          rank: weeklyWinner.rank || 1,
          prize: weeklyWinner.prizeId
            ? {
                prizeId: weeklyWinner.prizeId._id,
                title: weeklyWinner.prizeId.title,
                description: weeklyWinner.prizeId.description,
                imageUrl: weeklyWinner.prizeId.imageUrl,
                prizeType: weeklyWinner.prizeId.prizeType
              }
            : null
        };
      }

      // ✅ Mark any announced winner (daily or weekly) inside allParticipants, with prize image
      await markWinnersInParticipants(formattedAttempters, startOfWeek, endOfWeek);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            weekly: {
              week: {
                start: startOfWeek,
                end: endOfWeek,
                weekNumber: weekNumber,
                year: now.getFullYear()
              },
              isLive: true,
              note: 'Updates as users attempt quizzes. Final winner announced on Monday.',
              totalParticipants: formattedAttempters.length,
              winner: winner, // ✅ Only ONE winner (or null)
              allParticipants: formattedAttempters
            }
          },
          'Weekly attempters and winner retrieved successfully.'
        )
      );
    }

    // ── LAST WEEK: All attempters + ONLY ONE winner ──
    if (lastWeek === 'true') {
      const currentDay = now.getDay();

      // Calculate previous week's Monday and Sunday
      let prevWeekStart, prevWeekEnd;

      if (currentDay === 1) {
        prevWeekStart = new Date(now);
        prevWeekStart.setDate(now.getDate() - 7);
        prevWeekStart.setHours(0, 0, 0, 0);

        prevWeekEnd = new Date(now);
        prevWeekEnd.setDate(now.getDate() - 1);
        prevWeekEnd.setHours(23, 59, 59, 999);
      } else {
        prevWeekStart = new Date(now);
        prevWeekStart.setDate(now.getDate() - currentDay - 6);
        prevWeekStart.setHours(0, 0, 0, 0);

        prevWeekEnd = new Date(now);
        prevWeekEnd.setDate(now.getDate() - currentDay);
        prevWeekEnd.setHours(23, 59, 59, 999);
      }

      // Get all attempters for last week with sorting
      const lastWeekAttempters = await QuizAttempt.aggregate([
        {
          $match: {
            createdAt: {
              $gte: prevWeekStart,
              $lte: prevWeekEnd
            }
          }
        },
        {
          $group: {
            _id: '$userId',
            totalQuestions: { $sum: 1 },
            correctAnswers: {
              $sum: { $cond: ['$isCorrect', 1, 0] }
            },
            totalTime: { $sum: '$timeTakenSeconds' },
            firstAttemptAt: { $min: '$createdAt' }
          }
        },
        {
          $match: {
            correctAnswers: { $gt: 0 }
          }
        },
        {
          $addFields: {
            accuracy: {
              $multiply: [
                { $divide: ['$correctAnswers', '$totalQuestions'] },
                100
              ]
            }
          }
        },
        {
          $sort: {
            correctAnswers: -1,
            accuracy: -1,
            totalTime: 1,
            firstAttemptAt: 1
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            userName: '$user.name',
            email: '$user.email',
            profilePicture: '$user.profilePicture',
            score: '$correctAnswers',  
            stats: {
              totalQuestions: 1,
              correctAnswers: 1,
              accuracy: 1,
              totalTime: 1,
              firstAttemptAt: 1
            },
            _id: 0
          }
        }
      ]);

      // Format with rank
      const formattedAttempters = lastWeekAttempters.map((item, index) => ({
        rank: index + 1,
        ...item
      }));

      // Get week number
      const getWeekNumber = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
        const week1 = new Date(d.getFullYear(), 0, 4);
        return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
      };

      // ✅ Get ONLY ONE weekly winner from last week
      const lastWeekWinner = await Winner.findOne({
        cycleType: 'weekly',
        winnerDate: {
          $gte: prevWeekStart,
          $lte: prevWeekEnd
        }
      })
        .populate('userId', 'name email profilePicture')
        .populate('prizeId', 'title description imageUrl prizeType');

      let winner = null;
      if (lastWeekWinner) {
        // Find winner stats from attempters
        const winnerStats = lastWeekAttempters.find(
          (item) => item.userId.toString() === lastWeekWinner.userId._id.toString()
        );

        winner = {
          userId: lastWeekWinner.userId._id,
          name: lastWeekWinner.userId.name,
          email: lastWeekWinner.userId.email,
          profilePicture: lastWeekWinner.userId.profilePicture || null,
          score: winnerStats?.stats?.correctAnswers ?? lastWeekWinner.score ?? 0,
          stats: winnerStats?.stats || {
            totalQuestions: 0,
            correctAnswers: lastWeekWinner.score || 0,
            accuracy: 0,
            totalTime: 0,
            firstAttemptAt: lastWeekWinner.winnerDate
          },
          selectedAt: lastWeekWinner.winnerDate,
          rank: lastWeekWinner.rank || 1,
          prize: lastWeekWinner.prizeId
            ? {
                prizeId: lastWeekWinner.prizeId._id,
                title: lastWeekWinner.prizeId.title,
                description: lastWeekWinner.prizeId.description,
                imageUrl: lastWeekWinner.prizeId.imageUrl,
                prizeType: lastWeekWinner.prizeId.prizeType
              }
            : null
        };
      }

      // ✅ Mark any announced winner (daily or weekly) inside allParticipants, with prize image
      await markWinnersInParticipants(formattedAttempters, prevWeekStart, prevWeekEnd);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            lastWeek: {
              week: {
                start: prevWeekStart,
                end: prevWeekEnd,
                weekNumber: getWeekNumber(prevWeekStart),
                year: prevWeekStart.getFullYear()
              },
              totalParticipants: formattedAttempters.length,
              winner: winner, // ✅ Only ONE winner (or null)
              allParticipants: formattedAttempters
            }
          },
          'Last week attempters and winner retrieved successfully.'
        )
      );
    }

    // ── ?days=10 → Last 10 days top performers ──
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
            correctAnswers: { $sum: 1 },
            totalTime: { $sum: '$timeTakenSeconds' },
            firstAttemptAt: { $min: '$createdAt' }
          }
        },
        {
          $sort: {
            correctAnswers: -1,
            totalTime: 1,
            firstAttemptAt: 1
          }
        },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            userId: '$_id',
            userName: '$user.name',
            email: '$user.email',
            profilePicture: '$user.profilePicture',
            score: '$correctAnswers',
            correctAnswers: 1,
            totalTime: 1,
            firstAttemptAt: 1,
            _id: 0
          }
        }
      ]);

      const last10DaysUsers = last10DaysAttempts.map((user, index) => ({
        rank: index + 1,
        ...user
      }));

      // ✅ Mark whoever was an announced winner (daily or weekly) in the last 10 days, with prize image
      await markWinnersInParticipants(last10DaysUsers, last10DaysDate, now);

      return res.status(200).json(
        new ApiResponse(
          200,
          {
            last10Days: {
              period: {
                start: last10DaysDate,
                end: now
              },
              totalParticipants: last10DaysUsers.length,
              allParticipants: last10DaysUsers
            }
          },
          'Last 10 days top performers retrieved successfully.'
        )
      );
    }

    // ── Default: Current week leaderboard (fallback) ──
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
      rank: index + 1,
      ...user,
      isTopThree: index < 3
    }));

    // ✅ Mark any announced winner (daily or weekly) inside allParticipants, with prize image
    const startOfCurrentWeek = new Date(now);
    const currentDayNum = now.getDay();
    const currentWeekDiff = now.getDate() - currentDayNum + (currentDayNum === 0 ? -6 : 1);
    startOfCurrentWeek.setDate(currentWeekDiff);
    startOfCurrentWeek.setHours(0, 0, 0, 0);

    const endOfCurrentWeek = new Date(startOfCurrentWeek);
    endOfCurrentWeek.setDate(startOfCurrentWeek.getDate() + 6);
    endOfCurrentWeek.setHours(23, 59, 59, 999);

    await markWinnersInParticipants(currentWeekAllUsers, startOfCurrentWeek, endOfCurrentWeek);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          currentWeek: {
            week: currentWeek.weekNumber,
            year: currentWeek.year,
            isLive: true,
            note: 'Updates as users attempt quizzes. Final winner announced on Monday.',
            totalParticipants: currentWeekAllUsers.length,
            top3: currentWeekAllUsers.slice(0, 3),
            allParticipants: currentWeekAllUsers
          }
        },
        'Weekly leaderboard retrieved successfully.'
      )
    );

  } catch (error) {
    console.error('Error in getWinners:', error);
    return res.status(500).json(
      new ApiResponse(
        500,
        null,
        'Internal server error'
      )
    );
  }
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