import { z } from 'zod';
import { TraitSchema } from '../shared/index.js';

export const ActorSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    nickname: z.string().default(''),
    profile: z.string().default(''),
    classId: z.number().int().positive().default(1),
    initialLevel: z.number().int().positive().default(1),
    maxLevel: z.number().int().min(1).max(99).default(99),
    characterName: z.string().default(''),
    characterIndex: z.number().int().min(0).max(7).default(0),
    faceName: z.string().default(''),
    faceIndex: z.number().int().min(0).max(7).default(0),
    battlerName: z.string().default(''),
    equips: z.array(z.number().int().nonnegative()).default([0, 0, 0, 0, 0]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Actor = z.infer<typeof ActorSchema>;
