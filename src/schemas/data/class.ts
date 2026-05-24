import { z } from 'zod';
import { LearningSchema, TraitSchema } from '../shared/index.js';

export const ClassSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    /** [basis, extra, accelA, accelB] */
    expParams: z.array(z.number()).length(4).default([30, 20, 30, 30]),
    /** 2D array: [stat 0..7][level 0..maxLevel] */
    params: z.array(z.array(z.number())).default(() => Array.from({ length: 8 }, () => [])),
    learnings: z.array(LearningSchema).default([]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Class = z.infer<typeof ClassSchema>;
