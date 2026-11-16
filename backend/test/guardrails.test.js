import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, resetDb, buildTestApp, signupAndLogin, addMember, call, pool } from './helpers.js';

let app, admin, member, h, api, memberApi;

before(async () => {
  await migrate();
  app = await buildTestApp();
});
after(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetDb();
  admin = await signupAndLogin(app, 'Admin');
  h = `/households/${admin.householdId}`;
  member = await addMember(app, admin.householdId, 'member');
  api = call(app, admin.cookie);
  memberApi = call(app, member.cookie);
});

const makePocket = async (name, kind = 'bill', extra = {}) =>
  (await api('POST', `${h}/pockets`, { name, kind, ...extra })).json().pocket;
const income = (amount) => api('POST', `${h}/transactions`, { type: 'income', amount });
const state = async () => (await api('GET', `${h}/pockets`)).json();
const balanceOf = (s, id) => s.pockets.find((p) => p.id === id).balance;
const fund = (pocket, amount) => api('POST', `${h}/pocket-moves`, { toPocketId: pocket.id, amount });

test('savings, emergency and goal pockets start locked; others do not', async () => {
  const s = await makePocket('Savings', 'savings');
  const g = await makePocket('Fees', 'goal', { deadline: '2027-01-31' });
  const r = await makePocket('Rent', 'bill');
  assert.equal(s.locked, true);
  assert.equal(g.locked, true);
  assert.equal(g.deadline, '2027-01-31');
  assert.equal(r.locked, false);
  const unlocked = await api('PATCH', `${h}/pockets/${s.id}`, { locked: false });
  assert.equal(unlocked.json().pocket.locked, false);
  assert.equal((await memberApi('PATCH', `${h}/pockets/${s.id}`, { locked: true })).statusCode, 403);
});

test('bills: create, reserve for monthly and yearly, members read only', async () => {
  const rent = await makePocket('Rent');
  const monthly = await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'Light', amount: 20000, frequency: 'monthly', dueDay: 5 });
  assert.equal(monthly.statusCode, 201);
  assert.equal(monthly.json().bill.monthlyReserve, 20000);
  const yearly = await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'Rent', amount: 1200000, frequency: 'yearly', dueDay: 1, dueMonth: 9 });
  assert.equal(yearly.json().bill.monthlyReserve, 100000);

  assert.equal((await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'X', amount: 1, frequency: 'yearly', dueDay: 1 })).statusCode, 400);
  assert.equal((await memberApi('POST', `${h}/bills`, { pocketId: rent.id, name: 'X', amount: 1, frequency: 'monthly', dueDay: 1 })).statusCode, 403);
  assert.equal((await memberApi('GET', `${h}/bills`)).json().bills.length, 2);
  const id = monthly.json().bill.id;
  assert.equal((await api('PATCH', `${h}/bills/${id}`, { amount: 25000 })).json().bill.monthlyReserve, 25000);
  assert.equal((await api('DELETE', `${h}/bills/${id}`)).statusCode, 204);
});

test('upcoming bills show funded or not from the bill pocket balance', async () => {
  const rent = await makePocket('Rent');
  await income(100000);
  await fund(rent, 30000);
  const today = new Date(Date.now() + 3600 * 1000);
  const tomorrow = ((today.getUTCDate() % 28) + 1);
  await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'Small', amount: 20000, frequency: 'monthly', dueDay: tomorrow });
  await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'Big', amount: 50000, frequency: 'monthly', dueDay: tomorrow });
  const res = await api('GET', `${h}/bills/upcoming?days=40`);
  const byName = Object.fromEntries(res.json().bills.map((b) => [b.name, b]));
  assert.equal(byName.Small.funded, true);
  assert.equal(byName.Big.funded, false);
  assert.equal(byName.Big.pocketBalance, 30000);
  assert.ok(byName.Big.daysUntil >= 0 && byName.Big.daysUntil <= 31);
});

test('split preview suggests the bill reserve for a pocket no rule covers', async () => {
  const rent = await makePocket('Rent');
  const spending = await makePocket('Spending', 'spending');
  await api('POST', `${h}/bills`, { pocketId: rent.id, name: 'Rent', amount: 1200000, frequency: 'yearly', dueDay: 1, dueMonth: 9 });
  await api('PUT', `${h}/split-rules`, { rules: [{ pocketId: spending.id, method: 'percent', value: 100 }] });
  const res = (await api('POST', `${h}/allocations/preview`, { amount: 300000 })).json();
  const byName = Object.fromEntries(res.lines.map((l) => [l.pocketName, l]));
  assert.equal(byName.Rent.amount, 100000);
  assert.equal(byName.Rent.suggested, true);
  assert.equal(byName.Spending.amount, 200000);
  assert.equal(byName.Spending.suggested, false);

  // Once a rule covers the pocket, nothing is suggested for it.
  await api('PUT', `${h}/split-rules`, { rules: [{ pocketId: rent.id, method: 'fixed', value: 40000 }] });
  const covered = (await api('POST', `${h}/allocations/preview`, { amount: 300000 })).json();
  assert.deepEqual(covered.lines.map((l) => [l.pocketName, l.amount, l.suggested]), [['Rent', 40000, false]]);
});

test('safe to spend is the sum of the spending pockets, and overspent pockets are listed', async () => {
  const food = await makePocket('Food', 'spending');
  const fun = await makePocket('Fun', 'spending');
  const rent = await makePocket('Rent');
  await income(100000);
  await fund(food, 30000);
  await fund(fun, 10000);
  await fund(rent, 50000);
  await api('POST', `${h}/transactions`, { type: 'expense', amount: 15000, pocketId: fun.id });
  const now = new Date();
  const res = (await api('GET', `${h}/summary?month=${now.getMonth() + 1}&year=${now.getFullYear()}`)).json();
  assert.equal(res.safeToSpend, 25000);
  assert.deepEqual(res.overspent.map((p) => [p.name, p.balance]), [['Fun', -5000]]);
  assert.ok(res.daysLeft >= 1);
  assert.equal(res.safePerDay, Math.round((25000 / res.daysLeft) * 100) / 100);
});

test('cover moves fix an overspent pocket', async () => {
  const fun = await makePocket('Fun', 'spending');
  await income(10000);
  await api('POST', `${h}/transactions`, { type: 'expense', amount: 3000, pocketId: fun.id });
  const cover = await api('POST', `${h}/pocket-moves`, { toPocketId: fun.id, amount: 3000, kind: 'cover' });
  assert.equal(cover.statusCode, 201);
  assert.equal(cover.json().move.kind, 'cover');
  assert.equal(balanceOf(await state(), fun.id), 0);
});

test('a withdrawal from a locked pocket is pending, not counted, and cannot be confirmed for 24 hours', async () => {
  const savings = await makePocket('Savings', 'savings');
  const food = await makePocket('Food', 'spending');
  await income(10000);
  await fund(savings, 10000);

  const res = await api('POST', `${h}/pocket-moves`, { fromPocketId: savings.id, toPocketId: food.id, amount: 4000 });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().move.status, 'pending');
  assert.match(res.json().message, /Savings is locked\. Your withdrawal will be ready to confirm tomorrow at \d\d:\d\d\./);
  const hoursAway = (new Date(res.json().move.availableAt) - Date.now()) / 3600000;
  assert.ok(hoursAway > 23.9 && hoursAway <= 24);

  let s = await state();
  assert.equal(balanceOf(s, savings.id), 10000);
  assert.equal(balanceOf(s, food.id), 0);

  const id = res.json().move.id;
  const early = await api('POST', `${h}/pocket-moves/${id}/confirm`);
  assert.equal(early.statusCode, 400);
  assert.match(early.json().error, /can be confirmed from/);
  s = await state();
  assert.equal(balanceOf(s, food.id), 0);
});

test('after 24 hours an admin can confirm, and the money then moves', async () => {
  const savings = await makePocket('Savings', 'savings');
  const food = await makePocket('Food', 'spending');
  await income(10000);
  await fund(savings, 10000);
  const id = (await api('POST', `${h}/pocket-moves`, { fromPocketId: savings.id, toPocketId: food.id, amount: 4000 })).json().move.id;
  await pool.query("update public.pocket_moves set available_at = now() - interval '1 minute' where id = $1", [id]);

  assert.equal((await memberApi('POST', `${h}/pocket-moves/${id}/confirm`)).statusCode, 403);
  const ok = await api('POST', `${h}/pocket-moves/${id}/confirm`);
  assert.equal(ok.statusCode, 200, ok.body);
  const s = await state();
  assert.equal(balanceOf(s, savings.id), 6000);
  assert.equal(balanceOf(s, food.id), 4000);
  assert.equal((await api('POST', `${h}/pocket-moves/${id}/confirm`)).statusCode, 409);
});

test('confirming re-checks the balance', async () => {
  const savings = await makePocket('Savings', 'savings');
  const food = await makePocket('Food', 'spending');
  await income(10000);
  await fund(savings, 10000);
  const first = (await api('POST', `${h}/pocket-moves`, { fromPocketId: savings.id, toPocketId: food.id, amount: 7000 })).json().move.id;
  const second = (await api('POST', `${h}/pocket-moves`, { fromPocketId: savings.id, toPocketId: food.id, amount: 7000 })).json().move.id;
  await pool.query("update public.pocket_moves set available_at = now() - interval '1 minute' where status = 'pending'");
  assert.equal((await api('POST', `${h}/pocket-moves/${first}/confirm`)).statusCode, 200);
  const res = await api('POST', `${h}/pocket-moves/${second}/confirm`);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Savings only has ₦3,000 now/);
  assert.equal(balanceOf(await state(), food.id), 7000);
});

test('anyone can cancel a pending withdrawal, and it never counts', async () => {
  const savings = await makePocket('Savings', 'savings');
  await income(5000);
  await fund(savings, 5000);
  const id = (await api('POST', `${h}/pocket-moves`, { fromPocketId: savings.id, toPocketId: null, amount: 1000 })).json().move.id;
  const pending = (await memberApi('GET', `${h}/pocket-moves?status=pending`)).json().moves;
  assert.equal(pending.length, 1);
  assert.equal((await memberApi('POST', `${h}/pocket-moves/${id}/cancel`)).statusCode, 200);
  assert.equal((await api('POST', `${h}/pocket-moves/${id}/cancel`)).statusCode, 409);
  assert.equal(balanceOf(await state(), savings.id), 5000);
  assert.equal((await state()).readyToAssign, 0);
});

test('moves out of unlocked pockets and into locked pockets are immediate', async () => {
  const rent = await makePocket('Rent');
  const savings = await makePocket('Savings', 'savings');
  await income(10000);
  await fund(rent, 5000);
  const into = await api('POST', `${h}/pocket-moves`, { fromPocketId: rent.id, toPocketId: savings.id, amount: 1000 });
  assert.equal(into.json().move.status, 'done');
  assert.equal(balanceOf(await state(), savings.id), 1000);
});

test('Phase 3 endpoints return 404 to non-members', async () => {
  const outsider = await signupAndLogin(app, 'Outsider');
  const out = call(app, outsider.cookie);
  const res = await Promise.all([
    out('GET', `${h}/bills`),
    out('GET', `${h}/bills/upcoming`),
    out('POST', `${h}/pocket-moves/00000000-0000-4000-8000-000000000000/confirm`),
    out('POST', `${h}/pocket-moves/00000000-0000-4000-8000-000000000000/cancel`),
  ]);
  for (const r of res) assert.equal(r.statusCode, 404);
});
