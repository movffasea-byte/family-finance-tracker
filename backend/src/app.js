import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import authRoutes from './routes/auth.js';
import householdRoutes from './routes/households.js';
import categoryRoutes from './routes/categories.js';
import transactionRoutes from './routes/transactions.js';
import budgetRoutes from './routes/budgets.js';
import billRoutes from './routes/bills.js';
import summaryRoutes from './routes/summary.js';
import pocketRoutes from './routes/pockets.js';
import pocketMoveRoutes from './routes/pocketMoves.js';
import splitRuleRoutes from './routes/splitRules.js';
import allocationRoutes from './routes/allocations.js';

export function buildApp() {
  const app = Fastify({ logger: true });

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');

  // Log the real error, but never send internals (hosts, IPs, stack details) to clients.
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error(error);
    else request.log.warn(error.message);
    if (status >= 500) {
      return reply.code(status).send({ error: 'Something went wrong on our side. Try again in a moment.' });
    }
    return reply.code(status).send({ error: error.message });
  });

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
  app.register(billRoutes, { prefix: `${scoped}/bills` });
  app.register(summaryRoutes, { prefix: `${scoped}/summary` });
  app.register(pocketRoutes, { prefix: `${scoped}/pockets` });
  app.register(pocketMoveRoutes, { prefix: `${scoped}/pocket-moves` });
  app.register(splitRuleRoutes, { prefix: `${scoped}/split-rules` });
  app.register(allocationRoutes, { prefix: `${scoped}/allocations` });

  return app;
}
