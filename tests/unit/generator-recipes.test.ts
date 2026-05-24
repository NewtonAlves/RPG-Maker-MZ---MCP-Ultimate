import { describe, it, expect } from 'vitest';

import { DEFAULT_Z_ORDER, sortPartsByZ, outputCategoryFor, partPath } from '../../src/core/generator-recipes.js';

describe('sortPartsByZ', () => {
  it('ordena partes conforme Z_ORDER default', () => {
    const parts = { Hat: 'h.png', Body: 'b.png', Hair: 'a.png' };
    const sorted = sortPartsByZ(parts);
    expect(sorted[0]!.category).toBe('Body'); // Body vem antes
    expect(sorted[sorted.length - 1]!.category).toBe('Hat'); // Hat vem por último
  });

  it('categorias desconhecidas vão pro fim', () => {
    const parts = { CustomCat: 'x.png', Body: 'b.png' };
    const sorted = sortPartsByZ(parts);
    expect(sorted[0]!.category).toBe('Body');
    expect(sorted[1]!.category).toBe('CustomCat');
  });

  it('respeita Z_ORDER custom', () => {
    const customOrder = ['Hat', 'Body'];
    const sorted = sortPartsByZ({ Body: 'b.png', Hat: 'h.png' }, customOrder);
    expect(sorted[0]!.category).toBe('Hat');
    expect(sorted[1]!.category).toBe('Body');
  });
});

describe('outputCategoryFor', () => {
  it('Face → img/faces', () => {
    expect(outputCategoryFor('Face')).toBe('img/faces');
  });
  it('TV → img/characters', () => {
    expect(outputCategoryFor('TV')).toBe('img/characters');
  });
  it('SV → img/sv_actors', () => {
    expect(outputCategoryFor('SV')).toBe('img/sv_actors');
  });
});

describe('partPath', () => {
  it('monta path correto', () => {
    const p = partPath('C:/install', 'TV', 'Female', 'TV_Body_p01.png');
    expect(p).toBe('C:/install/generator/TV/Female/TV_Body_p01.png');
  });
});

describe('DEFAULT_Z_ORDER', () => {
  it('tem Body antes de Hair', () => {
    const bodyIdx = DEFAULT_Z_ORDER.indexOf('Body');
    const hairIdx = DEFAULT_Z_ORDER.indexOf('Hair');
    expect(bodyIdx).toBeLessThan(hairIdx);
  });
  it('tem Hair antes de Hat', () => {
    const hairIdx = DEFAULT_Z_ORDER.indexOf('Hair');
    const hatIdx = DEFAULT_Z_ORDER.indexOf('Hat');
    expect(hairIdx).toBeLessThan(hatIdx);
  });
});
