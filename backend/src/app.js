import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import authRoutes from './routes/auth.js';
import householdRoutes from './routes/households.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';
import goalRoutes from './routes/goals.js';
import summaryRoutes from './routes/summary.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

  app.register(cors, { origin: process.env.CORS_ORIGIN, credentials: true });
  app.register(cookie);
  app.register(jwt, {
    secret: process.env.JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  app.decorate('authenticate', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Not authenticated' });
    }
  });

  app.get('/health', async () => ({ ok: true }));
  app.register(authRoutes, { prefix: '/auth' });
  app.register(householdRoutes, { prefix: '/households' });
  const scoped = '/households/:householdId';
  app.register(categoryRoutes, { prefix: `${scoped}/categories` });
  app.register(transactionRoutes, { prefix: `${scoped}/transactions` });
  app.register(budgetRoutes, { prefix: `${scoped}/budgets` });
  app.register(goalRoutes, { prefix: `${scoped}/goals` });
  app.register(summaryRoutes, { prefix: `${scoped}/summary` });

  return app;
}
