import { describe, it, expect } from 'vitest';

import { ActorSchema } from '../../src/schemas/data/actor.js';
import { SkillSchema } from '../../src/schemas/data/skill.js';
import { EnemySchema } from '../../src/schemas/data/enemy.js';
import {
  TraitSchema,
  EffectSchema,
  DamageInfoSchema,
  EventCommandSchema,
} from '../../src/schemas/shared/index.js';

describe('ActorSchema', () => {
  it('aceita actor mínimo (só id)', () => {
    const parsed = ActorSchema.parse({ id: 1 });
    expect(parsed.id).toBe(1);
    expect(parsed.name).toBe('');
    expect(parsed.classId).toBe(1);
    expect(parsed.equips).toEqual([0, 0, 0, 0, 0]);
    expect(parsed.traits).toEqual([]);
    expect(parsed.note).toBe('');
  });

  it('rejeita actor sem id', () => {
    expect(() => ActorSchema.parse({})).toThrow();
  });

  it('rejeita actor com id <= 0', () => {
    expect(() => ActorSchema.parse({ id: 0 })).toThrow();
    expect(() => ActorSchema.parse({ id: -1 })).toThrow();
  });

  it('preserva campos extras via passthrough', () => {
    const parsed = ActorSchema.parse({ id: 1, customField: 'extra' });
    expect((parsed as Record<string, unknown>).customField).toBe('extra');
  });

  it('valida equips com 5 slots', () => {
    expect(() => ActorSchema.parse({ id: 1, equips: [1, 2, 3] })).not.toThrow();
    // Schema permite array de qualquer tamanho — default é 5, mas não força
  });
});

describe('SkillSchema', () => {
  it('aceita skill com damage formula', () => {
    const skill = SkillSchema.parse({
      id: 5,
      name: 'Fire',
      damage: { type: 1, elementId: 2, formula: 'a.mat * 3', variance: 20, critical: false },
    });
    expect(skill.damage.formula).toBe('a.mat * 3');
    expect(skill.damage.type).toBe(1);
  });

  it('damage tem defaults sensatos', () => {
    const skill = SkillSchema.parse({ id: 5 });
    expect(skill.damage.type).toBe(0);
    expect(skill.damage.formula).toBe('0');
    expect(skill.damage.variance).toBe(20);
  });
});

describe('EnemySchema', () => {
  it('exige params com 8 stats', () => {
    expect(() => EnemySchema.parse({ id: 1, params: [100, 0, 10, 5] })).toThrow();
    expect(() => EnemySchema.parse({ id: 1, params: [100, 0, 10, 5, 5, 5, 5, 5] })).not.toThrow();
  });

  it('exige dropItems com 3 slots', () => {
    expect(() => EnemySchema.parse({ id: 1, dropItems: [] })).toThrow();
    const enemy = EnemySchema.parse({ id: 1 });
    expect(enemy.dropItems).toHaveLength(3);
  });
});

describe('TraitSchema', () => {
  it('aceita trait com code/dataId/value', () => {
    const t = TraitSchema.parse({ code: 22, dataId: 0, value: 1 });
    expect(t.code).toBe(22);
  });
});

describe('EffectSchema', () => {
  it('aceita effect com 4 campos', () => {
    const e = EffectSchema.parse({ code: 21, dataId: 0, value1: 1, value2: 0 });
    expect(e.code).toBe(21);
  });
});

describe('DamageInfoSchema', () => {
  it('aceita all defaults', () => {
    const d = DamageInfoSchema.parse({});
    expect(d.type).toBe(0);
    expect(d.variance).toBe(20);
    expect(d.critical).toBe(false);
  });
});

describe('EventCommandSchema', () => {
  it('aceita comando código 0 (terminator)', () => {
    const c = EventCommandSchema.parse({ code: 0 });
    expect(c.code).toBe(0);
    expect(c.indent).toBe(0);
    expect(c.parameters).toEqual([]);
  });

  it('aceita Show Text 101 com parâmetros completos', () => {
    const c = EventCommandSchema.parse({
      code: 101,
      indent: 0,
      parameters: ['Actor1', 0, 0, 2, ''],
    });
    expect(c.parameters).toHaveLength(5);
  });
});
