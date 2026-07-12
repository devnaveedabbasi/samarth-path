import moment from 'moment-timezone';

export const TIMEZONE = 'Asia/Kolkata';

// Change only the time here — everything else will automatically update
export const CONTENT_UNLOCK_TIMES = {
  text:  '08:00',
  quiz:  '14:00',
  video: '19:00'
};

// Whether the given content's scheduled unlock moment (its date + unlocksAt
// time, in IST) has already passed relative to now. Used at content-creation
// time to decide whether to publish it immediately (admin uploaded it after
// its unlock window already passed today) or leave it locked for the unlock
// cron to flip on at the scheduled time.
export function isUnlockTimePassed(dateValue, unlocksAt) {
  const contentDay = moment.tz(dateValue, TIMEZONE).format('YYYY-MM-DD');
  const unlockMoment = moment.tz(`${contentDay} ${unlocksAt}`, 'YYYY-MM-DD HH:mm', TIMEZONE);
  return moment().tz(TIMEZONE).isSameOrAfter(unlockMoment);
}

export function getPKTDateRange(date = null) {
  if (date) {
    // String date "YYYY-MM-DD" se IST range
    const day = moment.tz(date, 'YYYY-MM-DD', TIMEZONE);
    return {
      startOfDay: day.clone().startOf('day').toDate(),
      endOfDay: day.clone().endOf('day').toDate(),
    };
  }

  // Today's IST date range
  const now = moment().tz(TIMEZONE);
  return {
    startOfDay: now.clone().startOf('day').toDate(),
    endOfDay: now.clone().endOf('day').toDate(),
  };
}