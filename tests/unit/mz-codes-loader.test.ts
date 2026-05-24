import { describe, it, expect } from 'vitest';

import {
  findEventCommand,
  searchEventCommands,
  listEventCommandCategories,
  effectByName,
  traitByName,
  encodeTilesetFlag,
  decodeTilesetFlag,
  notetagsForCategory,
  compatIssuesForPlugin,
  searchDamageFormulas,
  EFFECT_CODES,
  TRAIT_CODES,
  DAMAGE_FORMULAS,
} from '../../src/core/mz-codes-loader.js';

describe('findEventCommand', () => {
  it('encontra por code numérico', () => {
    const cmd = findEventCommand(101);
    expect(cmd?.name).toBe('Show Text');
    expect(cmd?.category).toBe('message');
  });

  it('encontra por nome exato (case-insensitive)', () => {
    expect(findEventCommand('Show Text')?.code).toBe(101);
    expect(findEventCommand('show text')?.code).toBe(101);
  });

  it('encontra por nome com underscore', () => {
    expect(findEventCommand('show_text')?.code).toBe(101);
  });

  it('retorna undefined pra código desconhecido', () => {
    expect(findEventCommand(9999)).toBeUndefined();
    expect(findEventCommand('NonExistent')).toBeUndefined();
  });

  it('codes principais existem', () => {
    // Conditional Branch
    expect(findEventCommand(111)?.name).toBe('Conditional Branch');
    // Transfer Player
    expect(findEventCommand(201)?.name).toBe('Transfer Player');
    // Play SE
    expect(findEventCommand(250)?.name).toBe('Play SE');
    // Battle Processing
    expect(findEventCommand(301)?.name).toBe('Battle Processing');
    // Plugin Command MZ
    expect(findEventCommand(357)?.name).toContain('Plugin Command');
    expect(findEventCommand(357)?.mzOnly).toBe(true);
  });
});

describe('searchEventCommands', () => {
  it('filtra por categoria', () => {
    const msgs = searchEventCommands({ category: 'message' });
    expect(msgs.length).toBeGreaterThan(3);
    expect(msgs.every((c) => c.category === 'message')).toBe(true);
  });

  it('filtra por namePartial', () => {
    const battles = searchEventCommands({ namePartial: 'battle' });
    expect(battles.some((c) => c.name.includes('Battle'))).toBe(true);
  });

  it('filtra por mzOnly', () => {
    const mzOnly = searchEventCommands({ mzOnly: true });
    expect(mzOnly.every((c) => c.mzOnly === true)).toBe(true);
    expect(mzOnly.length).toBeGreaterThan(0);
  });
});

describe('listEventCommandCategories', () => {
  it('retorna lista ordenada de categorias', () => {
    const cats = listEventCommandCategories();
    expect(cats).toContain('message');
    expect(cats).toContain('branch');
    expect(cats).toContain('sound');
    // Sorted
    expect(cats).toEqual([...cats].sort());
  });
});

describe('effectByName', () => {
  it('retorna effect por nome', () => {
    const e = effectByName('recover_hp');
    expect(e?.code).toBe(11);
    expect(e?.display).toBe('Recover HP');
  });

  it('retorna undefined pra nome inválido', () => {
    expect(effectByName('not_a_real_effect')).toBeUndefined();
  });

  it('todos os 13 effects estão presentes', () => {
    expect(Object.keys(EFFECT_CODES).length).toBe(13);
  });
});

describe('traitByName', () => {
  it('retorna trait por nome', () => {
    const t = traitByName('param_rate');
    expect(t?.code).toBe(21);
    expect(t?.display).toBe('Parameter Rate');
  });

  it('xparam_rate tem xparamMap', () => {
    const t = traitByName('xparam_rate');
    expect(t?.xparamMap).toBeDefined();
    expect(t?.xparamMap?.['0']).toBe('hit');
  });

  it('todos os 25 traits estão presentes', () => {
    expect(Object.keys(TRAIT_CODES).length).toBe(25);
  });
});

describe('encodeTilesetFlag', () => {
  it('flag vazio = 0', () => {
    expect(encodeTilesetFlag({})).toBe(0);
  });

  it('bloqueia south', () => {
    expect(encodeTilesetFlag({ blockedDirs: ['down'] })).toBe(1);
  });

  it('bloqueia todas as direções', () => {
    expect(encodeTilesetFlag({ blockedDirs: ['down', 'left', 'right', 'up'] })).toBe(15);
  });

  it('ladder bit', () => {
    expect(encodeTilesetFlag({ ladder: true })).toBe(32);
  });

  it('terrain tag bits 12-14', () => {
    expect(encodeTilesetFlag({ terrain_tag: 1 })).toBe(1 << 12);
    expect(encodeTilesetFlag({ terrain_tag: 7 })).toBe(7 << 12);
  });

  it('combina múltiplos bits', () => {
    const flag = encodeTilesetFlag({ blockedDirs: ['down'], ladder: true, terrain_tag: 3 });
    expect(flag).toBe(1 | 32 | (3 << 12));
  });
});

describe('decodeTilesetFlag', () => {
  it('flag 0 = tudo passa', () => {
    const d = decodeTilesetFlag(0);
    expect(d.passage).toEqual({ down: true, left: true, right: true, up: true });
    expect(d.ladder).toBe(false);
    expect(d.terrain_tag).toBe(0);
  });

  it('flag 15 = tudo bloqueado', () => {
    const d = decodeTilesetFlag(15);
    expect(d.passage).toEqual({ down: false, left: false, right: false, up: false });
  });

  it('decodifica terrain tag', () => {
    const d = decodeTilesetFlag(5 << 12);
    expect(d.terrain_tag).toBe(5);
  });

  it('encode/decode é simétrico', () => {
    const opts = { blockedDirs: ['down', 'left'] as ('down' | 'left' | 'right' | 'up')[], ladder: true, terrain_tag: 4 };
    const encoded = encodeTilesetFlag(opts);
    const decoded = decodeTilesetFlag(encoded);
    expect(decoded.passage.down).toBe(false);
    expect(decoded.passage.left).toBe(false);
    expect(decoded.passage.right).toBe(true);
    expect(decoded.passage.up).toBe(true);
    expect(decoded.ladder).toBe(true);
    expect(decoded.terrain_tag).toBe(4);
  });
});

describe('notetagsForCategory', () => {
  it('filtra por skill', () => {
    const skill = notetagsForCategory('skill');
    expect(skill.length).toBeGreaterThan(3);
    expect(skill.every((n) => n.appliesTo.includes('skill'))).toBe(true);
  });

  it('filtra por categoria inexistente retorna vazio', () => {
    expect(notetagsForCategory('nonexistent')).toEqual([]);
  });
});

describe('compatIssuesForPlugin', () => {
  it('encontra issues do VisuMZ_1_BattleCore', () => {
    const issues = compatIssuesForPlugin('VisuMZ_1_BattleCore');
    expect(issues.length).toBeGreaterThan(0);
  });

  it('matches YEP_* wildcard', () => {
    const issues = compatIssuesForPlugin('YEP_BattleSystem');
    expect(issues.some((i) => i.id === 'yep_ports_deprecated')).toBe(true);
  });

  it('plugin desconhecido sem issues', () => {
    expect(compatIssuesForPlugin('TotallyUniqueRandomPlugin')).toEqual([]);
  });
});

describe('searchDamageFormulas', () => {
  it('filtra por tag', () => {
    const physical = searchDamageFormulas({ tags: ['physical'] });
    expect(physical.length).toBeGreaterThan(2);
    expect(physical.every((p) => p.tags.includes('physical'))).toBe(true);
  });

  it('filtra por type', () => {
    const healing = searchDamageFormulas({ type: 3 });
    expect(healing.length).toBeGreaterThan(0);
    expect(healing.every((p) => p.type === 3)).toBe(true);
  });

  it('combina filtros', () => {
    const mediumMagical = searchDamageFormulas({ tags: ['medium_tier'], type: 1 });
    expect(mediumMagical.length).toBeGreaterThan(0);
  });

  it('presets têm 15+ entries', () => {
    expect(Object.keys(DAMAGE_FORMULAS).length).toBeGreaterThanOrEqual(15);
  });
});
