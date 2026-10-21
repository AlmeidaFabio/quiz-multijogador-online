export const AVATARS = [
  { id: 'fox', emoji: '🦊', label: 'Raposa', colors: ['#ff8a3d', '#ff4d6d'] },
  { id: 'panda', emoji: '🐼', label: 'Panda', colors: ['#a8b6c8', '#475569'] },
  { id: 'frog', emoji: '🐸', label: 'Sapo', colors: ['#7ee787', '#16a34a'] },
  { id: 'cat', emoji: '🐱', label: 'Gato', colors: ['#ffd166', '#f59e0b'] },
  { id: 'unicorn', emoji: '🦄', label: 'Unicórnio', colors: ['#f0abfc', '#a855f7'] },
  { id: 'octopus', emoji: '🐙', label: 'Polvo', colors: ['#ff7eb6', '#e11d48'] },
  { id: 'penguin', emoji: '🐧', label: 'Pinguim', colors: ['#7dd3fc', '#2563eb'] },
  { id: 'dino', emoji: '🦖', label: 'Dino', colors: ['#a3e635', '#15803d'] },
  { id: 'alien', emoji: '👾', label: 'Alien', colors: ['#c084fc', '#6d28d9'] },
  { id: 'robot', emoji: '🤖', label: 'Robô', colors: ['#94a3b8', '#334155'] },
  { id: 'ghost', emoji: '👻', label: 'Fantasma', colors: ['#e2e8f0', '#64748b'] },
  { id: 'lion', emoji: '🦁', label: 'Leão', colors: ['#fbbf24', '#b45309'] }
] as const;

export type Avatar = (typeof AVATARS)[number];
export type AvatarId = Avatar['id'];

export function isAvatarId(value: unknown): value is AvatarId {
  return AVATARS.some((avatar) => avatar.id === value);
}

export function avatarById(id: string | undefined): Avatar {
  return AVATARS.find((avatar) => avatar.id === id) ?? AVATARS[0];
}

export function avatarColors(id: string | undefined): [string, string] {
  const [from, to] = avatarById(id).colors;
  return [from, to];
}

export function defaultAvatarId(seed: string): AvatarId {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 9973;
  }
  return AVATARS[hash % AVATARS.length].id;
}

export function randomAvatarId(): AvatarId {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
}
