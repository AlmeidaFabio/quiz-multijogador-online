function positiveIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} deve ser um inteiro positivo.`);
  }
  return parsed;
}

export const roomConfig = {
  maxRoomsPerIp: positiveIntegerEnvironment('MAX_ROOMS_PER_IP', 5),
  maxConcurrentRooms: positiveIntegerEnvironment('MAX_CONCURRENT_ROOMS', 5),
  maxPlayersPerRoom: positiveIntegerEnvironment('MAX_PLAYERS_PER_ROOM', 500),
  maxRoomCreationQueue: positiveIntegerEnvironment('MAX_ROOM_CREATION_QUEUE', 500),
  inactivityTimeoutMs: positiveIntegerEnvironment('ROOM_INACTIVITY_TIMEOUT_MS', 15 * 60 * 1000),
  rankingRetentionMs: positiveIntegerEnvironment('RANKING_RETENTION_MS', 60 * 1000),
  playerReconnectGraceMs: positiveIntegerEnvironment('PLAYER_RECONNECT_GRACE_MS', 60 * 1000)
};

export const rateLimitConfig = {
  windowMs: 1000,
  createRoomPerIp: positiveIntegerEnvironment('CREATE_ROOM_PER_IP_RATE_LIMIT', 1),
  joinRoomPerIp: positiveIntegerEnvironment('JOIN_ROOM_PER_IP_RATE_LIMIT', 1),
  rejoinRoomPerIp: positiveIntegerEnvironment('REJOIN_ROOM_PER_IP_RATE_LIMIT', 2),
  startGamePerIp: positiveIntegerEnvironment('START_GAME_PER_IP_RATE_LIMIT', 1),
  answerPerPlayer: positiveIntegerEnvironment('ANSWER_PER_PLAYER_RATE_LIMIT', 10),
  endRoomPerIp: positiveIntegerEnvironment('END_ROOM_PER_IP_RATE_LIMIT', 1),
  roomLookupPerIp: positiveIntegerEnvironment('ROOM_LOOKUP_PER_IP_RATE_LIMIT', 5),
  queueRoomPerIp: positiveIntegerEnvironment('QUEUE_ROOM_PER_IP_RATE_LIMIT', 1),
  leaveQueuePerIp: positiveIntegerEnvironment('LEAVE_QUEUE_PER_IP_RATE_LIMIT', 5)
};
