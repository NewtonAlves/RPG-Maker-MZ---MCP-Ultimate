import { z } from 'zod';
import { TraitSchema } from '../shared/index.js';

export const ArmorSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    description: z.string().default(''),
    iconIndex: z.number().int().nonnegative().default(0),
    price: z.number().int().nonnegative().default(0),
    atypeId: z.number().int().nonnegative().default(0),
    etypeId: z.number().int().nonnegative().default(2),
    params: z.array(z.number().int()).length(8).default([0, 0, 0, 0, 0, 0, 0, 0]),
    traits: z.array(TraitSchema).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Armor = z.infer<typeof ArmorSchema>;
