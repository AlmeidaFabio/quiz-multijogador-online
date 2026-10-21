import type { FastifyInstance } from 'fastify';
import { rateLimitConfig, roomConfig } from '../config.ts';
import { availableCategories, questionBank } from '../game.ts';
import { consumeSharedRateLimit, sharedStoreHealth, withLockedRoom } from '../shared-store.ts';

export function registerHttpRoutes(app: FastifyInstance): void {
  app.get('/health', async (_request, reply) => {
    const redis = await sharedStoreHealth();
    if (redis === 'error') {
      return reply.code(503).send({ status: 'error', sharedStore: redis });
    }
    return { status: 'ok', sharedStore: redis };
  });

  app.get('/api/config', async () => ({
    categories: availableCategories(),
    questionCounts: questionBank.reduce<Record<string, number>>((counts, question) => {
      counts[question.categoria] = (counts[question.categoria] ?? 0) + 1;
      return counts;
    }, {}),
    limits: {
      minQuestions: 5,
      maxQuestions: 30,
      minTimeSeconds: 10,
      maxTimeSeconds: 60,
      maxPlayersPerRoom: roomConfig.maxPlayersPerRoom
    }
  }));

  app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
    const limit = await consumeSharedRateLimit(`room-lookup:${request.ip}`, rateLimitConfig.roomLookupPerIp, rateLimitConfig.windowMs);
    if (!limit.allowed) {
      return reply.header('retry-after', Math.ceil(limit.retryAfterMs / 1000)).code(429)
        .send({ message: 'Muitas consultas de convite. Aguarde um instante e tente novamente.' });
    }
    const result = await withLockedRoom(request.params.code, (room) => {
      if (!room || room.status !== 'lobby') {
        return null;
      }
      return { code: room.code, questionCount: room.questionCount };
    });
    if (!result) {
      return reply.code(404).send({ message: 'Este convite é inválido ou a partida já começou.' });
    }
    return result;
  });
}
