const disallowedTerms = [
  'arrombado',
  'bosta',
  'buceta',
  'caralho',
  'foda',
  'foder',
  'fuck',
  'fucking',
  'merda',
  'motherfucker',
  'porra',
  'puta',
  'putaria',
  'puto',
  'shit',
  'vagabunda',
  'vagabundo'
];

const leetspeak: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  '$': 's'
};

function normalizeNickname(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[013457@$]/gu, (character) => leetspeak[character] ?? character);
}

function termPattern(term: string): RegExp {
  const letters = [...normalizeNickname(term)].map((character) => character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));
  const expression = letters.join('[^\\p{L}\\p{N}]*');
  return new RegExp(`(?<![\\p{L}\\p{N}])${expression}(?![\\p{L}\\p{N}])`, 'u');
}

const disallowedPatterns = disallowedTerms.map(termPattern);

export function hasDisallowedNicknameContent(nickname: string): boolean {
  const normalizedNickname = normalizeNickname(nickname);
  return disallowedPatterns.some((pattern) => pattern.test(normalizedNickname));
}
