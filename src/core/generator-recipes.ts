/**
 * Z-order padrão pra composição de partes do generator do MZ.
 *
 * O usuário pode sobrescrever via parâmetro `zOrder`. Categorias não-listadas
 * vão pro topo da pilha.
 */

export type GeneratorKind = 'Face' | 'SV' | 'TV' | 'TVD';
export type Gender = 'Female' | 'Male' | 'Kid';

/** Z-order conservador. Mais abaixo = renderizado primeiro (fundo). */
export const DEFAULT_Z_ORDER: string[] = [
  'Body',
  'Ears',
  'BeastEars',
  'Face',
  'FacialMark',
  'Eyebrows',
  'Eyes',
  'Nose',
  'Mouth',
  'Beard',
  'Clothes',
  'HairBack',
  'BackHair',
  'FrontHair',
  'Hair',
  'Glasses',
  'AccA',
  'AccB',
  'Hat',
];

/** Ordena partes pelo Z-order definido (categorias desconhecidas vão pro fim). */
export function sortPartsByZ(
  parts: Record<string, string>,
  zOrder: string[] = DEFAULT_Z_ORDER,
): Array<{ category: string; file: string }> {
  const known = new Map(zOrder.map((c, i) => [c, i]));
  return Object.entries(parts)
    .map(([category, file]) => ({ category, file }))
    .sort((a, b) => {
      const ia = known.get(a.category) ?? 999;
      const ib = known.get(b.category) ?? 999;
      return ia - ib;
    });
}

/** Path absoluto dum part dentro de generator/<kind>/<gender>/. */
export function partPath(installPath: string, kind: GeneratorKind, gender: Gender, file: string): string {
  // Usa POSIX path join via template (jimp aceita ambos)
  return `${installPath}/generator/${kind}/${gender}/${file}`;
}

/** Destino canônico do output composto, dentro do projeto. */
export function outputCategoryFor(kind: GeneratorKind): string {
  switch (kind) {
    case 'Face': return 'img/faces';
    case 'TV':   return 'img/characters';
    case 'SV':   return 'img/sv_actors';
    case 'TVD':  return 'img/characters';
  }
}
