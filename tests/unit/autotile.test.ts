import { describe, it, expect } from 'vitest';

import {
  autotileBaseId,
  computeAutotileMap,
  computeShape,
  AUTOTILE_BASE_IDS,
} from '../../src/core/autotile.js';

describe('computeShape', () => {
  it('shape 0 quando rodeado nos 4 lados (interior)', () => {
    // N=1, E=4, S=16, W=64 → neighbors mask 0b01010101 = 85
    const shape = computeShape(1 | 4 | 16 | 64);
    expect(shape).toBe(0);
  });

  it('shape 46 quando isolado', () => {
    expect(computeShape(0)).toBe(46);
  });

  it('shape específico pra N+S (corredor vertical)', () => {
    // 1+16 = 17
    expect(computeShape(17)).toBe(34);
  });

  it('shape específico pra E+W (corredor horizontal)', () => {
    // 4+64 = 68
    expect(computeShape(68)).toBe(33);
  });

  it('shape pra cantos varia por configuração', () => {
    // N+E (canto superior direito)
    expect(computeShape(1 | 4)).toBe(36);
    // S+W (canto inferior esquerdo)
    expect(computeShape(16 | 64)).toBe(39);
  });
});

describe('autotileBaseId', () => {
  it('A1 com index 0 = 2048', () => {
    expect(autotileBaseId('A1', 0)).toBe(AUTOTILE_BASE_IDS.A1);
    expect(autotileBaseId('A1', 0)).toBe(2048);
  });

  it('A2 com index 0 = 2816', () => {
    expect(autotileBaseId('A2', 0)).toBe(2816);
  });

  it('A1 com index 1 = 2096 (próximo autotile)', () => {
    expect(autotileBaseId('A1', 1)).toBe(2048 + 48);
  });

  it('A2 com index 15 = 3536', () => {
    expect(autotileBaseId('A2', 15)).toBe(2816 + 15 * 48);
  });
});

describe('computeAutotileMap', () => {
  it('aplica wallTileId em células fora do floor', () => {
    const grid = [false, false, false, false]; // 2x2 tudo wall
    const result = computeAutotileMap(grid, 2, 2, 2816, 0);
    expect(result).toEqual([0, 0, 0, 0]);
  });

  it('floor isolada vira shape 46 + base', () => {
    const grid = [false, false, false, false, true, false, false, false, false]; // 3x3 centro floor
    const result = computeAutotileMap(grid, 3, 3, 2816, 0);
    expect(result[4]).toBe(2816 + 46); // centro isolado
  });

  it('floor cheio vira shape 0 nos interiores', () => {
    const grid = new Array(9).fill(true); // 3x3 tudo floor
    const result = computeAutotileMap(grid, 3, 3, 2816, 0);
    // Centro tem 4 vizinhos floor → shape 0
    expect(result[4]).toBe(2816);
    // Cantos têm 2 vizinhos floor (lados) → shape ≠ 0 e ≠ 46
    expect(result[0]).not.toBe(2816);
    expect(result[0]).not.toBe(2816 + 46);
  });
});
