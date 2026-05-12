import moment from 'moment-timezone';

export const TIMEZONE = 'Asia/Karachi';

// Yahan sirf time change karo — baaki sab automatically update ho jayega
export const CONTENT_UNLOCK_TIMES = {
  text:  '08:00',
  quiz:  '14:00',
  video: '19:00'
};

export function getPKTDateRange(date = null) {
  if (date) {
    // String date "YYYY-MM-DD" se PKT range
    const day = moment.tz(date, 'YYYY-MM-DD', TIMEZONE);
    return {
      startOfDay: day.clone().startOf('day').toDate(),
      endOfDay: day.clone().endOf('day').toDate(),
    };
  }

  // Aaj ki PKT range
  const now = moment().tz(TIMEZONE);
  return {
    startOfDay: now.clone().startOf('day').toDate(),
    endOfDay: now.clone().endOf('day').toDate(),
  };
}