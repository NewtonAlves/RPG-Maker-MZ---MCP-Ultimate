import { z } from 'zod';

export const TilesetSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    /** 0=Field Type, 1=Area Type, 2=VX Compatible */
    mode: z.number().int().min(0).max(2).default(0),
    /** Array of 9 strings: nomes dos 9 sheets (A1-A5, B-E) — index 0-8 */
    tilesetNames: z
      .array(z.string())
      .length(9)
      .default(['', '', '', '', '', '', '', '', '']),
    /** Flags por tile (passabilidade, etc.) */
    flags: z.array(z.number().int()).default([]),
    note: z.string().default(''),
  })
  .passthrough();

export type Tileset = z.infer<typeof TilesetSchema>;
