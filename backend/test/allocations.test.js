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

const makePocket = async (name, kind = 'bill') =>
  (await api('POST', `${h}/pockets`, { name, kind })).json().pocket;
const income = async (amount) =>
  (await api('POST', `${h}/transactions`, { type: 'income', amount })).json().transaction;
const rta = async () => (await api('GET', `${h}/pockets`)).json().readyToAssign;
const balance = async (id) => (await api('GET', `${h}/pockets`)).json().pockets.find((p) => p.id === id).balance;
const propose = (apiFn, lines, incomeTransactionId) =>
  apiFn('POST', `${h}/allocations`, { lines, ...(incomeTransactionId && { incomeTransactionId }) });

async function setupRules() {
  const rent = await makePocket('Rent');
  const savings = await makePocket('Savings', 'savings');
  const emergency = await makePocket('Emergency', 'emergency');
  const spending = await makePocket('Spending', 'spending');
  const put = await api('PUT', `${h}/split-rules`, {
    rules: [
      { pocketId: rent.id, method: 'fixed', value: 50000 },
      { pocketId: savings.id, method: 'percent', value: 20 },
      { pocketId: emergency.id, method: 'percent', value: 10 },
      { pocketId: spending.id, method: 'percent', value: 70 },
    ],
  });
  assert.equal(put.statusCode, 200);
  return { rent, savings, emergency, spending };
}

test('preview applies the rules and writes nothing', async () => {
  await setupRules();
  const res = await api('POST', `${h}/allocations/preview`, { amount: 200000 });
  const byName = Object.fromEntries(res.json().lines.map((l) => [l.pocketName, l.amount]));
  assert.deepEqual(byName, { Rent: 50000, Savings: 30000, Emergency: 15000, Spending: 105000 });
  assert.equal(res.json().unassigned, 0);
  const { rows } = await pool.query('select count(*)::int as n from public.pocket_moves');
  assert.equal(rows[0].n, 0);

  const small = await api('POST', `${h}/allocations/preview`, { amount: 40000 });
  assert.deepEqual(small.json().lines.map((l) => [l.pocketName, l.amount]), [['Rent', 40000]]);
});

test('members can preview and propose but not approve, discard or edit rules', async () => {
  const { rent } = await setupRules();
  const tx = await income(100000);
  assert.equal((await memberApi('POST', `${h}/allocations/preview`, { amount: 100 })).statusCode, 200);
  assert.equal((await memberApi('GET', `${h}/split-rules`)).statusCode, 200);
  const made = await propose(memberApi, [{ pocketId: rent.id, amount: 1000 }], tx.id);
  assert.equal(made.statusCode, 201);
  const id = made.json().allocation.id;
  assert.equal((await memberApi('POST', `${h}/allocations/${id}/approve`)).statusCode, 403);
  assert.equal((await memberApi('POST', `${h}/allocations/${id}/discard`)).statusCode, 403);
  assert.equal((await memberApi('PUT', `${h}/split-rules`, { rules: [] })).statusCode, 403);
  assert.equal((await rta()), 100000);
});

test('approving moves money out of Ready to assign into the pockets', async () => {
  const { rent, savings } = await setupRules();
  const tx = await income(100000);
  const made = await propose(api, [{ pocketId: rent.id, amount: 60000 }, { pocketId: savings.id, amount: 10000 }], tx.id);
  const id = made.json().allocation.id;
  assert.equal(made.json().allocation.status, 'proposed');
  assert.equal(await rta(), 100000);

  const res = await api('POST', `${h}/allocations/${id}/approve`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().allocation.status, 'approved');
  assert.equal(await rta(), 30000);
  assert.equal(await balance(rent.id), 60000);
  assert.equal(await balance(savings.id), 10000);
});

test('approving twice returns 409 and creates no duplicate moves', async () => {
  const { rent } = await setupRules();
  await income(100000);
  const id = (await propose(api, [{ pocketId: rent.id, amount: 1000 }])).json().allocation.id;
  assert.equal((await api('POST', `${h}/allocations/${id}/approve`)).statusCode, 200);
  assert.equal((await api('POST', `${h}/allocations/${id}/approve`)).statusCode, 409);
  const { rows } = await pool.query('select count(*)::int as n from public.pocket_moves where allocation_id = $1', [id]);
  assert.equal(rows[0].n, 1);
  assert.equal(await rta(), 99000);
});

test('two simultaneous approvals that together exceed Ready to assign: exactly one succeeds', async () => {
  const { rent, savings } = await setupRules();
  await income(1000);
  const a = (await propose(api, [{ pocketId: rent.id, amount: 700 }])).json().allocation.id;
  const b = (await propose(api, [{ pocketId: savings.id, amount: 700 }])).json().allocation.id;
  const results = await Promise.all([
    api('POST', `${h}/allocations/${a}/approve`),
    api('POST', `${h}/allocations/${b}/approve`),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
  assert.equal(await rta(), 300);
  const failed = results.find((r) => r.statusCode === 400).json();
  assert.match(failed.error, /short by ₦400/);
});

test('approval is refused when the split needs more than Ready to assign', async () => {
  const { rent } = await setupRules();
  await income(500);
  const id = (await propose(api, [{ pocketId: rent.id, amount: 800 }])).json().allocation.id;
  const res = await api('POST', `${h}/allocations/${id}/approve`);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Ready to assign only has ₦500/);
  const { rows } = await pool.query('select count(*)::int as n from public.pocket_moves');
  assert.equal(rows[0].n, 0);
});

test('discard moves nothing and a discarded split cannot be approved', async () => {
  const { rent } = await setupRules();
  await income(1000);
  const id = (await propose(api, [{ pocketId: rent.id, amount: 400 }])).json().allocation.id;
  assert.equal((await api('POST', `${h}/allocations/${id}/discard`)).statusCode, 200);
  assert.equal(await rta(), 1000);
  assert.equal((await api('POST', `${h}/allocations/${id}/approve`)).statusCode, 409);
  assert.equal((await api('POST', `${h}/allocations/${id}/discard`)).statusCode, 409);
});

test('approving a split that uses an archived pocket is refused', async () => {
  const { rent } = await setupRules();
  await income(1000);
  const id = (await propose(api, [{ pocketId: rent.id, amount: 400 }])).json().allocation.id;
  await api('DELETE', `${h}/pockets/${rent.id}`);
  const res = await api('POST', `${h}/allocations/${id}/approve`);
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /Rent is archived/);
});

test('percent totals above 100 are rejected on save, and nothing is changed', async () => {
  const { rent, savings } = await setupRules();
  const res = await api('PUT', `${h}/split-rules`, {
    rules: [
      { pocketId: rent.id, method: 'percent', value: 60 },
      { pocketId: savings.id, method: 'percent', value: 50 },
    ],
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /110%/);
  assert.equal((await api('GET', `${h}/split-rules`)).json().rules.length, 4);
});

test('rule validation: duplicates, foreign and archived pockets are refused; empty set clears rules', async () => {
  const { rent } = await setupRules();
  const dup = await api('PUT', `${h}/split-rules`, {
    rules: [{ pocketId: rent.id, method: 'fixed', value: 1 }, { pocketId: rent.id, method: 'percent', value: 5 }],
  });
  assert.equal(dup.statusCode, 400);

  const theirs = (await outsiderApi('POST', `/households/${outsider.householdId}/pockets`, { name: 'Theirs', kind: 'bill' })).json().pocket;
  const foreign = await api('PUT', `${h}/split-rules`, { rules: [{ pocketId: theirs.id, method: 'fixed', value: 1 }] });
  assert.equal(foreign.statusCode, 400);

  assert.equal((await api('PUT', `${h}/split-rules`, { rules: [] })).statusCode, 200);
  assert.deepEqual((await api('GET', `${h}/split-rules`)).json().rules, []);
});

test('list filters by status and includes lines and income details', async () => {
  const { rent } = await setupRules();
  const tx = await income(2000);
  await propose(api, [{ pocketId: rent.id, amount: 100 }], tx.id);
  const proposed = (await api('GET', `${h}/allocations?status=proposed`)).json().allocations;
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].incomeAmount, 2000);
  assert.deepEqual(proposed[0].lines.map((l) => [l.pocketName, l.amount]), [['Rent', 100]]);
  assert.equal((await api('GET', `${h}/allocations?status=approved`)).json().allocations.length, 0);
});

test('bad proposals are refused: foreign pocket, duplicate pockets, bad income id', async () => {
  const { rent } = await setupRules();
  const theirs = (await outsiderApi('POST', `/households/${outsider.householdId}/pockets`, { name: 'Theirs', kind: 'bill' })).json().pocket;
  assert.equal((await propose(api, [{ pocketId: theirs.id, amount: 10 }])).statusCode, 400);
  assert.equal((await propose(api, [{ pocketId: rent.id, amount: 10 }, { pocketId: rent.id, amount: 5 }])).statusCode, 400);
  const expense = (await api('POST', `${h}/transactions`, { type: 'expense', amount: 5 })).json().transaction;
  assert.equal((await propose(api, [{ pocketId: rent.id, amount: 10 }], expense.id)).statusCode, 400);
});

test('non-members get 404 on every Phase 2 endpoint', async () => {
  const { rent } = await setupRules();
  const id = (await propose(api, [{ pocketId: rent.id, amount: 1 }])).json().allocation.id;
  const calls = [
    outsiderApi('GET', `${h}/split-rules`),
    outsiderApi('PUT', `${h}/split-rules`, { rules: [] }),
    outsiderApi('POST', `${h}/allocations/preview`, { amount: 1 }),
    outsiderApi('POST', `${h}/allocations`, { lines: [{ pocketId: rent.id, amount: 1 }] }),
    outsiderApi('GET', `${h}/allocations`),
    outsiderApi('POST', `${h}/allocations/${id}/approve`),
    outsiderApi('POST', `${h}/allocations/${id}/discard`),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.statusCode, 404);
});
