import { z } from 'zod';
import { TroopMemberSchema, TroopPageSchema } from '../shared/index.js';

export const TroopSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    members: z.array(TroopMemberSchema).default([]),
    pages: z.array(TroopPageSchema).default([]),
  })
  .passthrough();

export type Troop = z.infer<typeof TroopSchema>;
