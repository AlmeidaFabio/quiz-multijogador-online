import type { CSSProperties } from 'react';
import { avatarById, avatarColors } from '../../shared/avatars.ts';

export function avatarStyle(avatar: string | undefined): CSSProperties {
  const [from, to] = avatarColors(avatar);
  return { '--avatar-a': from, '--avatar-b': to } as CSSProperties;
}

export function avatarEmoji(avatar: string | undefined): string {
  return avatarById(avatar).emoji;
}
