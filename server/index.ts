import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { restoreRoom } from './game.ts';
import { registerHttpRoutes } from './http/routes.ts';
import { RoomRuntime } from './rooms/runtime.ts';
import { closeSharedStore, initializeSharedStore, restoreSharedRooms } from './shared-store.ts';
import { registerSocketHandlers } from './socket/handlers.ts';

const port = Number(process.env.PORT ?? 3000);
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
registerHttpRoutes(app);

const io = new Server(app.server, {
  cors: { origin: true },
  transports: ['websocket', 'polling']
});
const runtime = new RoomRuntime(io, app.log);

await initializeSharedStore(io);
const restoredRooms = await restoreSharedRooms();
for (const room of restoredRooms) {
  restoreRoom(room);
  runtime.syncRoomTimers(room);
}
const timerRecoveryInterval = setInterval(() => runtime.syncAllRoomTimers(), 1000);
timerRecoveryInterval.unref();

registerSocketHandlers(io, runtime, app.log);

app.addHook('onClose', async () => {
  clearInterval(timerRecoveryInterval);
  runtime.dispose();
  await closeSharedStore();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  await closeSharedStore();
  throw error;
}
