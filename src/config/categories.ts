const CATEGORY_ICONS: Record<string, string> = {
  Animes: '🎌',
  Games: '🎮',
  Filmes: '🎬',
  'Séries': '📺',
  Esportes: '🏆',
  Geografia: '🌍',
  'História': '🏛️',
  'Ciências': '🔬',
  'Música': '🎵',
  'Super Nerd': '🤓'
};

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '🎯';
}
