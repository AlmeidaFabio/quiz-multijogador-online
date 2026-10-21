import { avatarEmoji, avatarStyle } from '../lib/avatar.ts';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

export function PlayerAvatar({ avatar, size = 'sm' }: { avatar?: string; size?: AvatarSize }) {
  return (
    <span className={`avatar avatar-${size}`} style={avatarStyle(avatar)} aria-hidden="true">
      {avatarEmoji(avatar)}
    </span>
  );
}
