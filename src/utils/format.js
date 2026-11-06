const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function isSameDay(a, b) {
  return a.toDateString() === b.toDateString();
}

function isYesterday(date) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(date, yesterday);
}

export function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateTimeFormat.format(date);
}

export function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : timeFormat.format(date);
}

/** "Today", "Yesterday" or a date: for dividers between days of messages. */
export function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (isSameDay(date, new Date())) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return dateFormat.format(date);
}

/** A time for today, otherwise the day: for lists of conversations. */
export function formatRelativeDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return isSameDay(date, new Date()) ? timeFormat.format(date) : formatDay(value);
}
