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
  inactivityTimeoutMs: positiveIntegerEnvironment('ROOM_INACTIVITY_TIMEOUT_MS', 15 * 60 * 1000),
  rankingRetentionMs: positiveIntegerEnvironment('RANKING_RETENTION_MS', 60 * 1000),
  playerReconnectGraceMs: positiveIntegerEnvironment('PLAYER_RECONNECT_GRACE_MS', 60 * 1000)
};

export const rateLimitConfig = {
  windowMs: 1000,
  createRoomPerIp: 1,
  joinRoomPerIp: 1,
  rejoinRoomPerIp: 2,
  startGamePerIp: 1,
  answerPerPlayer: 10,
  endRoomPerIp: 1,
  roomLookupPerIp: 5
};
