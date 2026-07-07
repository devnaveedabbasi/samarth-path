import Like from '../models/Like.model.js';
import Bookmark from '../models/Bookmark.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Comment from '../models/Comment.model.js';
import Prize from '../models/Prize.model.js';
import moment from 'moment-timezone';

export async function enrichContent(content, userId = null) {
  const [userLike, isBookmarked, quizAttempt, likesCount, commentsCount, prize, weeklyPrize] = await Promise.all([
    userId ? Like.findOne({ userId, contentId: content._id }) : null,
    userId ? Bookmark.findOne({ userId, contentId: content._id }) : null,
    userId && content.contentType === 'quiz'
      ? QuizAttempt.findOne({ userId, contentId: content._id })
      : null,
    Like.countDocuments({ contentId: content._id }),
    Comment.countDocuments({ contentId: content._id }),
    content.contentType === 'quiz'
      ? Prize.findOne({ quizId: content._id })
      : null,
    content.contentType === 'quiz'
      ? Prize.findOne({
          prizeType: 'weekly',
          weekNumber: moment(content.date).isoWeek(),
          year: moment(content.date).year(),
        })
      : null,
  ]);

  return {
    _id: content._id,
    contentType: content.contentType,
    unlocksAt: content.unlocksAt,
    date: content.date,
    isUnlocked: true,
    likesCount,
    commentsCount,
    isLiked: !!userLike,
    isBookmarked: !!isBookmarked,

    ...(content.contentType === 'text' && {
      textContent: content.textContent,
    }),

    ...(content.contentType === 'quiz' && {
      quizContent: {
        title: content.quizContent.title,
        question: content.quizContent.question,
        options: content.quizContent.options.map(opt => ({
          _id: opt.id,
          text: opt.text
        })),
        correctOptionId: content.quizContent.correctOptionId || null, // Security ke liye correct answer nahi bhejna
        timerSeconds: content.quizContent.timerSeconds,
        prize: prize
          ? {
            id: prize._id,
            title: prize.title,
            description: prize.description,
            imageUrl: prize.imageUrl,
          }
          : null,
        weeklyPrize: weeklyPrize
          ? {
            id: weeklyPrize._id,
            title: weeklyPrize.title,
            description: weeklyPrize.description,
            imageUrl: weeklyPrize.imageUrl,
            weekNumber: weeklyPrize.weekNumber,
            year: weeklyPrize.year,
          }
          : null,
      },
      quizAttempt: quizAttempt
        ? {
          selectedOptionId: quizAttempt.selectedOptionId,
          isCorrect: quizAttempt.isCorrect,
          timeTakenSeconds: quizAttempt.timeTakenSeconds,
        }
        : null,

    }),

    ...(content.contentType === 'video' && {
      videoContent: content.videoContent,
    }),
  };
}