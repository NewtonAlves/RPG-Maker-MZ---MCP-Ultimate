import { z } from 'zod';
import { EventPageSchema } from './map-event-page.js';

export const MapEventSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    note: z.string().default(''),
    x: z.number().int().nonnegative().default(0),
    y: z.number().int().nonnegative().default(0),
    pages: z.array(EventPageSchema).default(() => [EventPageSchema.parse({})]),
  })
  .passthrough();

export type MapEvent = z.infer<typeof MapEventSchema>;
