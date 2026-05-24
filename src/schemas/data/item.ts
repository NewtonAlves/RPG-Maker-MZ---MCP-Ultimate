import { z } from 'zod';
import { DamageInfoSchema, EffectSchema, TraitSchema } from '../shared/index.js';

export const ItemSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    description: z.string().default(''),
    iconIndex: z.number().int().nonnegative().default(0),
    price: z.number().int().nonnegative().default(0),
    consumable: z.boolean().default(true),
    itypeId: z.number().int().nonnegative().default(1),
    scope: z.number().int().nonnegative().default(0),
    occasion: z.number().int().nonnegative().default(0),
    speed: z.number().int().default(0),
    successRate: z.number().int().min(0).max(100).default(100),
    repeats: z.number().int().positive().default(1),
    hitType: z.number().int().nonnegative().default(0),
    animationId: z.number().int().default(0),
    damage: DamageInfoSchema.default({}),
    effects: z.array(EffectSchema).default([]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Item = z.infer<typeof ItemSchema>;
