import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.test'), override: true });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-not-for-production';

// Tests wipe and rebuild the public schema, so refuse anything but a local *_test database.
const url = process.env.DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\/[^/]*(localhost|127\.0\.0\.1)[^/]*\/[^/?]*_test(\?.*)?$/.test(url)) {
  throw new Error('Tests need DATABASE_URL in backend/.env.test pointing at a local database whose name ends in _test.');
}

const { buildApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
export { pool };

// Rebuilds the public schema from every migration, in order.
export async function migrate() {
  await pool.query('drop schema public cascade; create schema public;');
  const dir = path.join(root, '..', 'supabase', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(path.join(dir, file), 'utf8'));
  }
}

export async function resetDb() {
  await pool.query('truncate public.users, public.households restart identity cascade');
}

export async function buildTestApp() {
  const app = buildApp();
  app.log.level = 'silent';
  await app.ready();
  return app;
}

let counter = 0;
const cookieFrom = (res) => res.headers['set-cookie'].split(';')[0];

// Registers a user (who becomes admin of a new "The Gaba House" household) and returns their cookie.
export async function signupAndLogin(app, name = 'Test User') {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: `user${counter}@example.com`, password: 'correct-horse-1', name, householdName: 'The Gaba House' },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  return { cookie: cookieFrom(res), householdId: res.json().household.id, userId: res.json().user.id };
}

// Adds a new user to an existing household with the given role.
export async function addMember(app, householdId, role) {
  const user = await signupAndLogin(app, `${role} user`);
  await pool.query('delete from public.memberships where user_id = $1', [user.userId]);
  await pool.query('insert into public.memberships (user_id, household_id, role) values ($1, $2, $3)', [
    user.userId,
    householdId,
    role,
  ]);
  return user;
}

// Small request helper: call(app, cookie)('POST', '/path', body)
export const call = (app, cookie) => (method, url, payload) =>
  app.inject({ method, url, payload, headers: { cookie } });
