import argon2 from 'argon2';
import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { sendResetEmail } from '../email.js';

const RESET_MINUTES = 30;
const MAX_RESETS_PER_HOUR = 3;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 60 * 60 * 24 * 7,
};

const credentials = {
  email: { type: 'string', format: 'email', maxLength: 254 },
  password: { type: 'string', minLength: 8, maxLength: 128 },
};

export default async function authRoutes(app) {
  const issueToken = (reply, user) => {
    const token = app.jwt.sign({ sub: user.id }, { expiresIn: '7d' });
    reply.setCookie('token', token, cookieOptions);
  };

  // Creates the user, a household and an admin membership in one transaction.
  app.post(
    '/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'name', 'householdName'],
          additionalProperties: false,
          properties: {
            ...credentials,
            name: { type: 'string', minLength: 1, maxLength: 100 },
            householdName: { type: 'string', minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, name, householdName } = request.body;
      const passwordHash = await argon2.hash(password);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const userRes = await client.query(
          'insert into public.users (email, password_hash, name) values (lower($1), $2, $3) returning id, email, name',
          [email, passwordHash, name],
        );
        const user = userRes.rows[0];
        const hhRes = await client.query(
          'insert into public.households (name) values ($1) returning id, name',
          [householdName],
        );
        await client.query(
          "insert into public.memberships (user_id, household_id, role) values ($1, $2, 'admin')",
          [user.id, hhRes.rows[0].id],
        );
        await client.query('commit');
        issueToken(reply, user);
        return reply.code(201).send({ user, household: hhRes.rows[0] });
      } catch (err) {
        await client.query('rollback');
        if (err.code === '23505') return reply.code(409).send({ error: 'Email already registered' });
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: credentials,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const { rows } = await query(
        'select id, email, name, password_hash from public.users where email = lower($1)',
        [email],
      );
      const user = rows[0];
      const ok = user && (await argon2.verify(user.password_hash, password));
      if (!ok) return reply.code(401).send({ error: 'Invalid email or password' });
      issueToken(reply, user);
      return { user: { id: user.id, email: user.email, name: user.name } };
    },
  );

  // Always answers the same way, so nobody can learn which emails have accounts.
  app.post(
    '/forgot-password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: credentials.email },
        },
      },
    },
    async (request) => {
      const generic = { ok: true };
      const found = await query('select id, email from public.users where email = lower($1)', [
        request.body.email,
      ]);
      const user = found.rows[0];
      if (!user) return generic;

      const recent = await query(
        `select count(*)::int as n from public.password_resets
          where user_id = $1 and created_at > now() - interval '1 hour'`,
        [user.id],
      );
      if (recent.rows[0].n >= MAX_RESETS_PER_HOUR) return generic;

      const token = crypto.randomBytes(32).toString('base64url');
      await query(
        `insert into public.password_resets (user_id, token_hash, expires_at)
         values ($1, $2, now() + make_interval(mins => $3::int))`,
        [user.id, hashToken(token), RESET_MINUTES],
      );

      const base = (process.env.APP_URL || process.env.CORS_ORIGIN || '').replace(/\/$/, '');
      try {
        await sendResetEmail(user.email, `${base}/reset-password?token=${token}`);
      } catch (err) {
        request.log.error(err, 'password reset email failed');
      }
      return generic;
    },
  );

  app.post(
    '/reset-password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['token', 'password'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 20, maxLength: 200 },
            password: credentials.password,
          },
        },
      },
    },
    async (request, reply) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const found = await client.query(
          `select user_id from public.password_resets
            where token_hash = $1 and used_at is null and expires_at > now()
              for update`,
          [hashToken(request.body.token)],
        );
        if (!found.rowCount) {
          await client.query('rollback');
          return reply.code(400).send({ error: 'This reset link is invalid or has expired. Request a new one.' });
        }
        const userId = found.rows[0].user_id;
        const passwordHash = await argon2.hash(request.body.password);
        await client.query('update public.users set password_hash = $2 where id = $1', [userId, passwordHash]);
        await client.query(
          'update public.password_resets set used_at = now() where user_id = $1 and used_at is null',
          [userId],
        );
        await client.query('commit');
        reply.clearCookie('token', { path: '/' });
        return { ok: true };
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  );

  app.post('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return { ok: true };
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (request) => {
    const { rows } = await query('select id, email, name from public.users where id = $1', [
      request.user.sub,
    ]);
    return { user: rows[0] };
  });
}
