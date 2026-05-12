import Like from '../models/Like.model.js';
import Bookmark from '../models/Bookmark.model.js';
import QuizAttempt from '../models/QuizAttempt.model.js';
import Comment from '../models/Comment.model.js';

export async function enrichContent(content, userId = null) {
  const [userLike, isBookmarked, quizAttempt, likesCount, commentsCount] = await Promise.all([
    userId ? Like.findOne({ userId, contentId: content._id }) : null,
    userId ? Bookmark.findOne({ userId, contentId: content._id }) : null,
    userId && content.contentType === 'quiz'
      ? QuizAttempt.findOne({ userId, contentId: content._id })
      : null,
    Like.countDocuments({ contentId: content._id }),
    Comment.countDocuments({ contentId: content._id }),
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