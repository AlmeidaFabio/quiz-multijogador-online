import type { SavedSession } from '../types.ts';

const NOTICE_KEY = 'quiz-notice';

function sessionStorageKey(code: string): string {
  return `quiz-session:${code}`;
}

export function readSavedSession(code: string): SavedSession | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(sessionStorageKey(code)) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const session = value as Partial<SavedSession>;
    return typeof session.playerId === 'string'
      && typeof session.reconnectToken === 'string'
      && typeof session.nickname === 'string'
      ? { playerId: session.playerId, reconnectToken: session.reconnectToken, nickname: session.nickname }
      : null;
  } catch {
    return null;
  }
}

export function saveSession(code: string, session: SavedSession): void {
  window.localStorage.setItem(sessionStorageKey(code), JSON.stringify(session));
}

export function clearSavedSession(code: string): void {
  window.localStorage.removeItem(sessionStorageKey(code));
}

export function takeStoredNotice(): string | null {
  const message = window.sessionStorage.getItem(NOTICE_KEY);
  if (message) {
    window.sessionStorage.removeItem(NOTICE_KEY);
  }
  return message;
}

export function storeNotice(message: string): void {
  window.sessionStorage.setItem(NOTICE_KEY, message);
}
