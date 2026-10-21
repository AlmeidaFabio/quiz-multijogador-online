import { AVATARS } from '../../shared/avatars.ts';
import type { AvatarId } from '../../shared/avatars.ts';
import { avatarStyle } from '../lib/avatar.ts';

type AvatarPickerProps = {
  value: AvatarId;
  onChange: (avatar: AvatarId) => void;
  labelId: string;
};

export function AvatarPicker({ value, onChange, labelId }: AvatarPickerProps) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-labelledby={labelId}>
      {AVATARS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.label}
          title={option.label}
          className={`avatar-choice ${value === option.id ? 'is-selected' : ''}`}
          style={avatarStyle(option.id)}
          onClick={() => onChange(option.id)}
        >
          <span aria-hidden="true">{option.emoji}</span>
        </button>
      ))}
    </div>
  );
}
