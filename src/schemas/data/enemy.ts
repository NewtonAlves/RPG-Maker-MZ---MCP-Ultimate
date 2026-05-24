import { z } from 'zod';
import { DropItemSchema, EnemyActionSchema, TraitSchema } from '../shared/index.js';

export const EnemySchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    battlerName: z.string().default(''),
    battlerHue: z.number().int().min(0).max(360).default(0),
    exp: z.number().int().nonnegative().default(0),
    gold: z.number().int().nonnegative().default(0),
    /** 8 stats: maxhp, maxmp, atk, def, mat, mdf, agi, luk */
    params: z.array(z.number().int()).length(8).default([100, 0, 10, 5, 5, 5, 5, 5]),
    dropItems: z
      .array(DropItemSchema)
      .length(3)
      .default([
        { kind: 0, dataId: 0, denominator: 1 },
        { kind: 0, dataId: 0, denominator: 1 },
        { kind: 0, dataId: 0, denominator: 1 },
      ]),
    actions: z.array(EnemyActionSchema).default([]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Enemy = z.infer<typeof EnemySchema>;
