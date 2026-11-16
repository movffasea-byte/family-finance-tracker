import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReserve, nextDueDate, daysBetween, lagosToday, daysLeftInMonth } from '../src/lib/bills.js';

test('monthly bills reserve their amount; yearly bills reserve one twelfth', () => {
  assert.equal(monthlyReserve({ frequency: 'monthly', amount: 50000 }), 50000);
  assert.equal(monthlyReserve({ frequency: 'yearly', amount: 1200000 }), 100000);
  assert.equal(monthlyReserve({ frequency: 'yearly', amount: 1000 }), 83.33);
});

test('next due date: this month if still ahead, otherwise next month', () => {
  const bill = { frequency: 'monthly', dueDay: 15 };
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 11, day: 10 }), { year: 2026, month: 11, day: 15 });
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 11, day: 15 }), { year: 2026, month: 11, day: 15 });
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 11, day: 16 }), { year: 2026, month: 12, day: 15 });
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 12, day: 20 }), { year: 2027, month: 1, day: 15 });
});

test('a due day past the end of a short month moves to its last day', () => {
  const bill = { frequency: 'monthly', dueDay: 31 };
  assert.deepEqual(nextDueDate(bill, { year: 2027, month: 2, day: 1 }), { year: 2027, month: 2, day: 28 });
  assert.deepEqual(nextDueDate(bill, { year: 2028, month: 2, day: 1 }), { year: 2028, month: 2, day: 29 });
});

test('yearly bills fall due once a year', () => {
  const bill = { frequency: 'yearly', dueDay: 1, dueMonth: 9 };
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 8, day: 31 }), { year: 2026, month: 9, day: 1 });
  assert.deepEqual(nextDueDate(bill, { year: 2026, month: 9, day: 2 }), { year: 2027, month: 9, day: 1 });
});

test('day maths', () => {
  assert.equal(daysBetween({ year: 2026, month: 11, day: 10 }, { year: 2026, month: 11, day: 15 }), 5);
  assert.equal(daysBetween({ year: 2026, month: 12, day: 30 }, { year: 2027, month: 1, day: 2 }), 3);
  assert.equal(daysLeftInMonth({ year: 2026, month: 11, day: 16 }), 15);
  assert.equal(daysLeftInMonth({ year: 2026, month: 11, day: 30 }), 1);
});

test('today is taken in Nigerian time (UTC+1)', () => {
  assert.deepEqual(lagosToday(new Date('2026-11-15T23:30:00Z')), { year: 2026, month: 11, day: 16 });
  assert.deepEqual(lagosToday(new Date('2026-11-15T12:00:00Z')), { year: 2026, month: 11, day: 15 });
});
