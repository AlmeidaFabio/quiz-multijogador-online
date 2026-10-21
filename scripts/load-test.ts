import { performance } from 'node:perf_hooks';
import { io, type Socket } from 'socket.io-client';

type ServerAck = { ok: true; code?: string; playerId?: string; reconnectToken?: string } | { ok: false; message: string };

const urls = (process.env.LOAD_TEST_URLS ?? process.env.LOAD_TEST_URL ?? 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const roomCount = Number(process.env.LOAD_TEST_ROOMS ?? 10);
const playersPerRoom = Number(process.env.LOAD_TEST_PLAYERS_PER_ROOM ?? 50);
const targetLatencyMs = Number(process.env.LOAD_TEST_TARGET_LATENCY_MS ?? 500);
const expectedMaxRooms = Number(process.env.LOAD_TEST_MAX_CONCURRENT_ROOMS ?? 10);
const questionCount = 5;
const questionDurationSeconds = 10;

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 15_000
    });
    const timeout = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Timed out connecting to ${url}.`));
    }, 15_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      socket.disconnect();
      reject(error);
    });
  });
}

function emitResponse(socket: Socket, event: string, payload: unknown): Promise<ServerAck> {
  return new Promise((resolve, reject) => {
    socket.timeout(15_000).emit(event, payload, (error: Error | null, response: ServerAck) => {
      if (error) {
        reject(error);
      } else {
        resolve(response);
      }
    });
  });
}

async function emitAck(socket: Socket, event: string, payload: unknown): Promise<Extract<ServerAck, { ok: true }>> {
  const response = await emitResponse(socket, event, payload);
  if (!response?.ok) {
    throw new Error(response && 'message' in response ? response.message : `Request ${event} failed.`);
  }
  return response;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)];
}

async function createRoom(master: Socket, nickname: string): Promise<string> {
  const response = await emitAck(master, 'room:create', {
    categories: ['Filmes'],
    questionCount,
    timePerQuestionSeconds: questionDurationSeconds,
    nickname
  });
  if (!('code' in response) || !response.code) {
    throw new Error('Room creation acknowledgement did not include a room code.');
  }
  return response.code;
}

async function joinRoom(socket: Socket, code: string, nickname: string): Promise<number> {
  const startedAt = performance.now();
  const firstState = new Promise<number>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for room state after join.')), 15_000);
    socket.once('room:state', () => {
      clearTimeout(timeout);
      resolve(performance.now() - startedAt);
    });
  });
  await emitAck(socket, 'room:join', { code, nickname });
  return firstState;
}

async function playRoom(sockets: Socket[], latencyMeasurements: number[]): Promise<void> {
  const listeners = sockets.map((socket) => {
    let questionNumber = 0;
    const complete = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the final ranking.')), 120_000);
      socket.on('game:question', (question: { endsAt: number }) => {
        questionNumber += 1;
        latencyMeasurements.push(Date.now() - (question.endsAt - questionDurationSeconds * 1000));
        void emitAck(socket, 'game:answer', 0).catch(reject);
      });
      socket.once('game:ranking', () => {
        clearTimeout(timer);
        if (questionNumber !== questionCount) {
          reject(new Error(`Expected ${questionCount} questions, received ${questionNumber}.`));
          return;
        }
        resolve();
      });
    });
    return complete;
  });
  const master = sockets[0];
  if (!master) {
    throw new Error('A room is missing its master socket.');
  }
  await emitAck(master, 'room:start', {});
  await Promise.all(listeners);
}

async function main(): Promise<void> {
  assertPositiveInteger(roomCount, 'LOAD_TEST_ROOMS');
  assertPositiveInteger(playersPerRoom, 'LOAD_TEST_PLAYERS_PER_ROOM');
  assertPositiveInteger(targetLatencyMs, 'LOAD_TEST_TARGET_LATENCY_MS');
  if (urls.length === 0) {
    throw new Error('LOAD_TEST_URLS must include at least one server URL.');
  }
  if (playersPerRoom < 1) {
    throw new Error('LOAD_TEST_PLAYERS_PER_ROOM must include at least the master.');
  }

  const sockets: Socket[] = [];
  const roomSockets: Socket[][] = [];
  const joinLatencies: number[] = [];
  const gameEventLatencies: number[] = [];
  let roomCapRejectionVerified = false;
  const startedAt = performance.now();

  try {
    const totalPlayers = roomCount * playersPerRoom;
    const connections = await Promise.all(Array.from({ length: totalPlayers }, (_, index) =>
      connect(urls[index % urls.length])
    ));
    sockets.push(...connections);
    let cursor = 0;
    for (let roomIndex = 0; roomIndex < roomCount; roomIndex += 1) {
      const players: Socket[] = [];
      const master = connections[cursor++];
      if (!master) {
        throw new Error('Could not allocate a master connection.');
      }
      players.push(master);
      const code = await createRoom(master, `Mestre ${roomIndex + 1}`);
      for (let playerIndex = 1; playerIndex < playersPerRoom; playerIndex += 1) {
        const player = connections[cursor++];
        if (!player) {
          throw new Error('Could not allocate a player connection.');
        }
        players.push(player);
        joinLatencies.push(await joinRoom(player, code, `Jogador ${roomIndex + 1}-${playerIndex + 1}`));
      }
      roomSockets.push(players);
    }

    if (roomCount === expectedMaxRooms) {
      const firstUrl = urls[0];
      if (!firstUrl) {
        throw new Error('LOAD_TEST_URLS must include at least one server URL.');
      }
      const probe = await connect(firstUrl);
      sockets.push(probe);
      const response = await emitResponse(probe, 'room:create', {
        categories: ['Filmes'],
        questionCount,
        timePerQuestionSeconds: questionDurationSeconds,
        nickname: 'Teste limite global'
      });
      if (response.ok || !response.message.includes('limite de salas simultâneas')) {
        throw new Error('The global active-room limit was not enforced at the configured capacity.');
      }
      roomCapRejectionVerified = true;
    }

    const gameStartedAt = performance.now();
    await Promise.all(roomSockets.map((players) => playRoom(players, gameEventLatencies)));
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const joinP95 = percentile(joinLatencies, 0.95);
    const eventP95 = percentile(gameEventLatencies, 0.95);
    const result = {
      target: {
        rooms: roomCount,
        playersPerRoom,
        concurrentPlayers: totalPlayers,
        latencyTargetMs: targetLatencyMs
      },
      measured: {
        serverInstances: urls.length,
        connectedPlayers: totalPlayers,
        capacityProbeConnections: roomCapRejectionVerified ? 1 : 0,
        roomCapRejectionVerified,
        joinStateLatencyP95Ms: Math.round(joinP95),
        gameEventLatencyP95Ms: Math.round(eventP95),
        questionEvents: gameEventLatencies.length,
        gameDurationSeconds: Math.round((performance.now() - gameStartedAt) / 1000),
        totalDurationSeconds: Math.round(elapsedSeconds)
      }
    };
    console.log(JSON.stringify(result, null, 2));
    if (joinP95 > targetLatencyMs || eventP95 > targetLatencyMs) {
      process.exitCode = 1;
    }
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
