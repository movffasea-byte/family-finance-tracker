import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate, resetDb, buildTestApp, signupAndLogin, addMember, call, pool } from './helpers.js';

let app, admin, member, outsider, h, api, memberApi, outsiderApi;

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
  outsider = await signupAndLogin(app, 'Outsider');
  api = call(app, admin.cookie);
  memberApi = call(app, member.cookie);
  outsiderApi = call(app, outsider.cookie);
});

const makePocket = async (name, kind = 'bill', extra = {}) =>
  (await api('POST', `${h}/pockets`, { name, kind, ...extra })).json().pocket;
const income = (amount) => api('POST', `${h}/transactions`, { type: 'income', amount });
const state = async () => (await api('GET', `${h}/pockets`)).json();
const balanceOf = (s, id) => s.pockets.find((p) => p.id === id).balance;

test('admin can create, rename and archive a pocket', async () => {
  const rent = await makePocket('Rent');
  assert.equal(rent.balance, 0);
  const renamed = await api('PATCH', `${h}/pockets/${rent.id}`, { name: 'House rent' });
  assert.equal(renamed.json().pocket.name, 'House rent');
  assert.equal((await api('DELETE', `${h}/pockets/${rent.id}`)).statusCode, 204);
  assert.equal((await state()).pockets.length, 0);
});

test('duplicate active pocket names are refused, archived names can be reused', async () => {
  const rent = await makePocket('Rent');
  const dup = await api('POST', `${h}/pockets`, { name: 'rent', kind: 'bill' });
  assert.equal(dup.statusCode, 409);
  await api('DELETE', `${h}/pockets/${rent.id}`);
  assert.equal((await api('POST', `${h}/pockets`, { name: 'Rent', kind: 'bill' })).statusCode, 201);
});

test('income raises Ready to assign; moving money updates pocket and Ready to assign', async () => {
  const rent = await makePocket('Rent');
  await income(100000);
  assert.equal((await state()).readyToAssign, 100000);

  const mv = await api('POST', `${h}/pocket-moves`, { fromPocketId: null, toPocketId: rent.id, amount: 30000 });
  assert.equal(mv.statusCode, 201);
  const s = await state();
  assert.equal(s.readyToAssign, 70000);
  assert.equal(balanceOf(s, rent.id), 30000);
});

test('expense paid from a pocket reduces it; expense with no pocket reduces Ready to assign', async () => {
  const rent = await makePocket('Rent');
  await income(100000);
  await api('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 30000 });

  const paid = await api('POST', `${h}/transactions`, { type: 'expense', amount: 5000, pocketId: rent.id });
  assert.equal(paid.statusCode, 201);
  assert.equal(paid.json().transaction.pocketName, 'Rent');
  let s = await state();
  assert.equal(balanceOf(s, rent.id), 25000);
  assert.equal(s.readyToAssign, 70000);

  await api('POST', `${h}/transactions`, { type: 'expense', amount: 2000 });
  s = await state();
  assert.equal(s.readyToAssign, 68000);
  assert.equal(balanceOf(s, rent.id), 25000);
});

test('moving more than the source holds is rejected and writes nothing', async () => {
  const rent = await makePocket('Rent');
  const food = await makePocket('Food', 'spending');
  await income(10000);
  await api('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 8000 });

  const fromRta = await api('POST', `${h}/pocket-moves`, { toPocketId: food.id, amount: 5000 });
  assert.equal(fromRta.statusCode, 400);
  assert.match(fromRta.json().error, /Ready to assign only has/);

  const fromPocket = await api('POST', `${h}/pocket-moves`, { fromPocketId: rent.id, toPocketId: food.id, amount: 8000.01 });
  assert.equal(fromPocket.statusCode, 400);
  assert.match(fromPocket.json().error, /Rent only has/);

  const { rows } = await pool.query('select count(*)::int as n from public.pocket_moves');
  assert.equal(rows[0].n, 1);
});

test('moves between pockets and back to Ready to assign balance exactly', async () => {
  const a = await makePocket('A');
  const b = await makePocket('B');
  await income(1000);
  await api('POST', `${h}/pocket-moves`, { toPocketId: a.id, amount: 100.1 });
  await api('POST', `${h}/pocket-moves`, { fromPocketId: a.id, toPocketId: b.id, amount: 0.1 });
  await api('POST', `${h}/pocket-moves`, { fromPocketId: b.id, toPocketId: null, amount: 0.1 });
  const s = await state();
  assert.equal(balanceOf(s, a.id), 100);
  assert.equal(balanceOf(s, b.id), 0);
  assert.equal(s.readyToAssign, 900);
});

test('bad move requests are refused', async () => {
  const a = await makePocket('A');
  await income(1000);
  assert.equal((await api('POST', `${h}/pocket-moves`, { amount: 10 })).statusCode, 400);
  assert.equal((await api('POST', `${h}/pocket-moves`, { fromPocketId: a.id, toPocketId: a.id, amount: 10 })).statusCode, 400);
  assert.equal((await api('POST', `${h}/pocket-moves`, { toPocketId: a.id, amount: 0 })).statusCode, 400);
  assert.equal((await api('POST', `${h}/pocket-moves`, { toPocketId: a.id, amount: 1.234 })).statusCode, 400);
});

test('archiving a pocket that still holds money is refused with a clear message', async () => {
  const rent = await makePocket('Rent');
  await income(1000);
  await api('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 400 });
  const res = await api('DELETE', `${h}/pockets/${rent.id}`);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Rent still holds ₦400/);
});

test('income with a pocketId is rejected, on create and on edit', async () => {
  const rent = await makePocket('Rent');
  const res = await api('POST', `${h}/transactions`, { type: 'income', amount: 1000, pocketId: rent.id });
  assert.equal(res.statusCode, 400);

  const exp = await api('POST', `${h}/transactions`, { type: 'expense', amount: 1000, pocketId: rent.id });
  const id = exp.json().transaction.id;
  assert.equal((await api('PATCH', `${h}/transactions/${id}`, { type: 'income' })).statusCode, 400);
  const ok = await api('PATCH', `${h}/transactions/${id}`, { type: 'income', pocketId: null });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().transaction.pocketId, null);
});

test('a transaction cannot use an archived pocket or another household\'s pocket', async () => {
  const mine = await makePocket('Mine');
  await api('DELETE', `${h}/pockets/${mine.id}`);
  const archived = await api('POST', `${h}/transactions`, { type: 'expense', amount: 10, pocketId: mine.id });
  assert.equal(archived.statusCode, 400);

  const theirs = (await outsiderApi('POST', `/households/${outsider.householdId}/pockets`, { name: 'Theirs', kind: 'bill' })).json().pocket;
  const cross = await api('POST', `${h}/transactions`, { type: 'expense', amount: 10, pocketId: theirs.id });
  assert.equal(cross.statusCode, 400);
});

test('summary includes readyToAssign', async () => {
  await income(5000);
  const res = await api('GET', `${h}/summary?month=${new Date().getMonth() + 1}&year=${new Date().getFullYear()}`);
  assert.equal(res.json().readyToAssign, 5000);
});

test('activity lists moves and expenses for a pocket, newest first', async () => {
  const rent = await makePocket('Rent');
  await income(1000);
  await api('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 500, note: 'first' });
  await api('POST', `${h}/transactions`, { type: 'expense', amount: 100, pocketId: rent.id, description: 'Agent fee' });
  const res = await api('GET', `${h}/pockets/${rent.id}/activity`);
  const body = res.json();
  assert.equal(body.pocket.balance, 400);
  assert.deepEqual(body.activity.map((a) => a.amount), [-100, 500]);
  assert.equal(body.activity[1].otherPocket, 'Ready to assign');
});

test('members get 403 on every admin endpoint and can still read', async () => {
  const rent = await makePocket('Rent');
  await income(1000);
  const denied = [
    memberApi('POST', `${h}/pockets`, { name: 'X', kind: 'bill' }),
    memberApi('PATCH', `${h}/pockets/${rent.id}`, { name: 'Y' }),
    memberApi('DELETE', `${h}/pockets/${rent.id}`),
    memberApi('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 10 }),
  ];
  for (const res of await Promise.all(denied)) assert.equal(res.statusCode, 403);

  assert.equal((await memberApi('GET', `${h}/pockets`)).statusCode, 200);
  assert.equal((await memberApi('GET', `${h}/pockets/${rent.id}/activity`)).statusCode, 200);
  assert.equal((await memberApi('GET', `${h}/pocket-moves`)).statusCode, 200);
  assert.equal((await memberApi('POST', `${h}/transactions`, { type: 'expense', amount: 5, pocketId: rent.id })).statusCode, 201);
});

test('non-members get 404 on everything', async () => {
  const rent = await makePocket('Rent');
  const calls = [
    outsiderApi('GET', `${h}/pockets`),
    outsiderApi('POST', `${h}/pockets`, { name: 'X', kind: 'bill' }),
    outsiderApi('PATCH', `${h}/pockets/${rent.id}`, { name: 'Y' }),
    outsiderApi('DELETE', `${h}/pockets/${rent.id}`),
    outsiderApi('GET', `${h}/pockets/${rent.id}/activity`),
    outsiderApi('GET', `${h}/pocket-moves`),
    outsiderApi('POST', `${h}/pocket-moves`, { toPocketId: rent.id, amount: 10 }),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.statusCode, 404);
});

test('concurrent moves cannot overspend Ready to assign', async () => {
  const a = await makePocket('A');
  const b = await makePocket('B');
  await income(1000);
  const results = await Promise.all([
    api('POST', `${h}/pocket-moves`, { toPocketId: a.id, amount: 700 }),
    api('POST', `${h}/pocket-moves`, { toPocketId: b.id, amount: 700 }),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 400]);
  assert.equal((await state()).readyToAssign, 300);
});
