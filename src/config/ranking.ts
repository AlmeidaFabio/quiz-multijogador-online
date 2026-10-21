export const CONFETTI_PIECES = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 61) % 96 + 2}%`,
  delay: `${(index % 8) * 0.35}s`,
  duration: `${3.4 + (index % 5) * 0.7}s`,
  rotate: `${(index * 47) % 360}deg`,
  color: ['#ffd166', 'var(--accent)', 'var(--accent-2)', 'var(--accent-3)'][index % 4]
}));
