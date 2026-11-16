// Bill maths, no database.

// What a bill reserves each month, in naira rounded to the kobo: a yearly bill is spread over 12.
export function monthlyReserve(bill) {
  const kobo = Math.round(bill.amount * 100);
  return (bill.frequency === 'yearly' ? Math.round(kobo / 12) : kobo) / 100;
}

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Next due date on or after `today` (a { year, month, day } in the household's local date).
// A due day past the end of a short month is moved to that month's last day.
export function nextDueDate(bill, today) {
  const make = (year, month) => ({ year, month, day: Math.min(bill.dueDay, daysInMonth(year, month)) });
  const onOrAfter = (d) => d.year * 10000 + d.month * 100 + d.day >= today.year * 10000 + today.month * 100 + today.day;

  if (bill.frequency === 'yearly') {
    const thisYear = make(today.year, bill.dueMonth);
    return onOrAfter(thisYear) ? thisYear : make(today.year + 1, bill.dueMonth);
  }
  const thisMonth = make(today.year, today.month);
  if (onOrAfter(thisMonth)) return thisMonth;
  return today.month === 12 ? make(today.year + 1, 1) : make(today.year, today.month + 1);
}

export const daysBetween = (from, to) =>
  Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86400000);

// Today's date in Nigeria (UTC+1), whatever timezone the server runs in.
export function lagosToday(now = new Date()) {
  const d = new Date(now.getTime() + 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Days left in the month including today.
export const daysLeftInMonth = (today) => daysInMonth(today.year, today.month) - today.day + 1;

export const isoDate = (d) =>
  `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
