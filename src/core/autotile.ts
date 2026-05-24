/**
 * Encoding de autotile shapes do RPG Maker MZ.
 *
 * Tiles A1-A4 (IDs 2048+) usam shape bits 0-47 que codificam quais bordas
 * conectam com tiles adjacentes do mesmo autotile. Esta implementação cobre
 * casos comuns (4-direction + 4-corner) com fallback pra shape 46 (isolado).
 *
 * Tile ID final = baseAutotileId + shape (0-47).
 *
 * Encoding shape (simplified):
 *   - bits 0..3: 4 corners (NW, NE, SE, SW) — 1 se NÃO há autotile do mesmo
 *     tipo naquele canto
 *   - shape canonical = lookup table baseado em 8-neighbor connectivity
 */

/**
 * Calcula shape MZ a partir de 8-neighbor connectivity.
 *
 * neighbors: bitmask onde:
 *   bit 0 (1)   = N
 *   bit 1 (2)   = NE
 *   bit 2 (4)   = E
 *   bit 3 (8)   = SE
 *   bit 4 (16)  = S
 *   bit 5 (32)  = SW
 *   bit 6 (64)  = W
 *   bit 7 (128) = NW
 *
 * (bit ligado = vizinho É autotile do mesmo tipo).
 *
 * Tabela canônica MZ (48 entries) determinada empiricamente. Esta é uma
 * versão simplificada que cobre os 16 casos mais comuns (apenas 4-direction);
 * cantos são aproximados.
 */
export function computeShape(neighbors: number): number {
  const N = (neighbors & 1) !== 0;
  const E = (neighbors & 4) !== 0;
  const S = (neighbors & 16) !== 0;
  const W = (neighbors & 64) !== 0;
  // 4-bit lookup (N E S W → shape MZ canônico)
  // Tabela derivada da spec MZ Tilemap:
  const key = (N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0);
  const SHAPE_TABLE_4DIR: number[] = [
    /* 0000 */ 46, // isolado
    /* N=1 */ 44, // N
    /* E=2 */ 40, // E
    /* NE  */ 36, // N+E
    /* S=4 */ 42, // S
    /* NS  */ 34, // N+S (corredor vertical)
    /* SE  */ 38, // S+E (canto)
    /* NES */ 30, // N+S+E
    /* W=8 */ 41, // W
    /* NW  */ 37, // N+W
    /* EW  */ 33, // E+W (corredor horizontal)
    /* NEW */ 29, // N+E+W
    /* SW  */ 39, // S+W
    /* NSW */ 31, // N+S+W
    /* SEW */ 28, // S+E+W
    /* NSEW*/ 0,  // todos
  ];
  return SHAPE_TABLE_4DIR[key]!;
}

/** Wrapper conveniente: dado um grid boolean[width*height], retorna tileId pra cada célula. */
export function computeAutotileMap(
  grid: boolean[],
  width: number,
  height: number,
  baseAutotileId: number,
  wallTileId: number,
): number[] {
  const result = new Array(width * height).fill(wallTileId);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!grid[idx]) {
        result[idx] = wallTileId;
        continue;
      }
      // Coleta 4-direction neighbors
      const n = (y > 0 && grid[(y - 1) * width + x]) ? 1 : 0;
      const e = (x < width - 1 && grid[y * width + (x + 1)]) ? 4 : 0;
      const s = (y < height - 1 && grid[(y + 1) * width + x]) ? 16 : 0;
      const w = (x > 0 && grid[y * width + (x - 1)]) ? 64 : 0;
      const neighbors = n | e | s | w;
      const shape = computeShape(neighbors);
      result[idx] = baseAutotileId + shape;
    }
  }
  return result;
}

/** Base IDs dos autotile sheets MZ. */
export const AUTOTILE_BASE_IDS = {
  A1: 2048,   // 2048-2815  (16 autotiles × 48 shapes)
  A2: 2816,   // 2816-4351
  A3: 4352,   // 4352-5887
  A4: 5888,   // 5888-8191
  A5: 1536,   // 1536-2047  (A5 não tem autotile shapes — só 32 tiles fixos)
} as const;

/** Retorna o base ID do autotile `index` (0-based) em A1, A2, A3 ou A4. */
export function autotileBaseId(sheet: 'A1' | 'A2' | 'A3' | 'A4', index: number): number {
  return AUTOTILE_BASE_IDS[sheet] + index * 48;
}
