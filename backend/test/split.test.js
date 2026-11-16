import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeSplit } from '../src/lib/split.js';

const rules = [
  { pocketId: 'rent', method: 'fixed', value: 50000, priority: 1 },
  { pocketId: 'savings', method: 'percent', value: 20, priority: 2 },
  { pocketId: 'emergency', method: 'percent', value: 10, priority: 3 },
  { pocketId: 'spending', method: 'percent', value: 70, priority: 4 },
];
const amounts = (r) => Object.fromEntries(r.lines.map((l) => [l.pocketId, l.amount]));

test('fixed first, then percentages of what is left', () => {
  const r = proposeSplit(200000, rules);
  assert.deepEqual(amounts(r), { rent: 50000, savings: 30000, emergency: 15000, spending: 105000 });
  assert.equal(r.unassigned, 0);
});

test('a small income is eaten by the fixed rule and the rest get nothing', () => {
  const r = proposeSplit(40000, rules);
  assert.deepEqual(amounts(r), { rent: 40000 });
  assert.equal(r.unassigned, 0);
});

test('rounding: percentages round down and the leftover stays unassigned', () => {
  const r = proposeSplit(100.01, [
    { pocketId: 'a', method: 'percent', value: 33.33, priority: 1 },
    { pocketId: 'b', method: 'percent', value: 66.67, priority: 2 },
  ]);
  assert.deepEqual(amounts(r), { a: 33.33, b: 66.67 });
  assert.equal(r.unassigned, 0.01);
});

test('percentages that total under 100 leave the rest unassigned', () => {
  const r = proposeSplit(1000, [{ pocketId: 'a', method: 'percent', value: 25, priority: 1 }]);
  assert.deepEqual(amounts(r), { a: 250 });
  assert.equal(r.unassigned, 750);
});

test('rules run in priority order, not array order', () => {
  const r = proposeSplit(100, [
    { pocketId: 'second', method: 'fixed', value: 80, priority: 2 },
    { pocketId: 'first', method: 'fixed', value: 80, priority: 1 },
  ]);
  assert.deepEqual(amounts(r), { first: 80, second: 20 });
});

test('no rules: everything stays unassigned', () => {
  const r = proposeSplit(5000, []);
  assert.deepEqual(r.lines, []);
  assert.equal(r.unassigned, 5000);
});

test('zero income gives no lines and nothing unassigned', () => {
  const r = proposeSplit(0, rules);
  assert.deepEqual(r.lines, []);
  assert.equal(r.unassigned, 0);
});

test('an exhausted remainder produces no zero lines', () => {
  const r = proposeSplit(50000, rules);
  assert.deepEqual(amounts(r), { rent: 50000 });
  assert.equal(r.unassigned, 0);
});

test('lines plus unassigned always equal the income, to the kobo', () => {
  for (const income of [0.01, 1, 99.99, 12345.67, 1e9 + 0.37]) {
    const r = proposeSplit(income, rules);
    const total = r.lines.reduce((s, l) => s + Math.round(l.amount * 100), 0) + Math.round(r.unassigned * 100);
    assert.equal(total, Math.round(income * 100));
  }
});
