import argon2 from 'argon2';
import { pool, query } from '../db.js';

const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
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
