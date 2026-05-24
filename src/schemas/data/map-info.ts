import { z } from 'zod';

export const MapInfoSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    expanded: z.boolean().default(false),
    order: z.number().int().nonnegative().default(0),
    parentId: z.number().int().nonnegative().default(0),
    scrollX: z.number().default(0),
    scrollY: z.number().default(0),
  })
  .passthrough();

export type MapInfo = z.infer<typeof MapInfoSchema>;
