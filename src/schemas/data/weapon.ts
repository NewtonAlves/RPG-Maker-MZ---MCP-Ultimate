import { z } from 'zod';
import { TraitSchema } from '../shared/index.js';

export const WeaponSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    description: z.string().default(''),
    iconIndex: z.number().int().nonnegative().default(0),
    price: z.number().int().nonnegative().default(0),
    wtypeId: z.number().int().nonnegative().default(1),
    etypeId: z.number().int().nonnegative().default(1),
    animationId: z.number().int().default(0),
    /** 8 stats: maxhp, maxmp, atk, def, mat, mdf, agi, luk */
    params: z.array(z.number().int()).length(8).default([0, 0, 0, 0, 0, 0, 0, 0]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Weapon = z.infer<typeof WeaponSchema>;
