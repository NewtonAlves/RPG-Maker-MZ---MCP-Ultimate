import { z } from 'zod';
import { TraitSchema } from '../shared/index.js';

export const StateSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    iconIndex: z.number().int().nonnegative().default(0),
    restriction: z.number().int().nonnegative().default(0),
    priority: z.number().int().nonnegative().default(50),
    removeAtBattleEnd: z.boolean().default(false),
    removeByRestriction: z.boolean().default(false),
    autoRemovalTiming: z.number().int().nonnegative().default(0),
    minTurns: z.number().int().nonnegative().default(1),
    maxTurns: z.number().int().nonnegative().default(1),
    removeByDamage: z.boolean().default(false),
    chanceByDamage: z.number().int().min(0).max(100).default(100),
    removeByWalking: z.boolean().default(false),
    stepsToRemove: z.number().int().nonnegative().default(100),
    motion: z.number().int().nonnegative().default(0),
    overlay: z.number().int().nonnegative().default(0),
    message1: z.string().default(''),
    message2: z.string().default(''),
    message3: z.string().default(''),
    message4: z.string().default(''),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type State = z.infer<typeof StateSchema>;
