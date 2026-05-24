import { z } from 'zod';
import { DamageInfoSchema, EffectSchema, TraitSchema } from '../shared/index.js';

export const SkillSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    description: z.string().default(''),
    iconIndex: z.number().int().nonnegative().default(0),
    stypeId: z.number().int().nonnegative().default(0),
    mpCost: z.number().int().nonnegative().default(0),
    tpCost: z.number().int().nonnegative().default(0),
    tpGain: z.number().int().nonnegative().default(0),
    scope: z.number().int().nonnegative().default(1),
    occasion: z.number().int().nonnegative().default(0),
    speed: z.number().int().default(0),
    successRate: z.number().int().min(0).max(100).default(100),
    repeats: z.number().int().positive().default(1),
    hitType: z.number().int().nonnegative().default(0),
    animationId: z.number().int().default(0),
    damage: DamageInfoSchema.default({}),
    effects: z.array(EffectSchema).default([]),
    traits: z.array(TraitSchema).default([]),
    message1: z.string().default(''),
    message2: z.string().default(''),
    messageType: z.number().int().nonnegative().default(1),
    requiredWtypeId1: z.number().int().nonnegative().default(0),
    requiredWtypeId2: z.number().int().nonnegative().default(0),
    note: z.string().default(''),
  })
  .passthrough();

export type Skill = z.infer<typeof SkillSchema>;
