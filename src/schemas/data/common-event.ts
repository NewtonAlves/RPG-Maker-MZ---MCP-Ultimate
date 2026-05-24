import { z } from 'zod';
import { EventCommandSchema } from '../shared/index.js';

export const CommonEventSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    /** 0=None (chamada manual), 1=Autorun, 2=Parallel */
    trigger: z.number().int().min(0).max(2).default(0),
    switchId: z.number().int().nonnegative().default(1),
    list: z.array(EventCommandSchema).default([{ code: 0, indent: 0, parameters: [] }]),
  })
  .passthrough();

export type CommonEvent = z.infer<typeof CommonEventSchema>;
