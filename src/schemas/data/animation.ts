import { z } from 'zod';

/**
 * Animation — Effekseer-based em MZ. Schema permissivo porque o conteúdo
 * (frames, timings) é complexo e gerado pelo editor de animações.
 */
export const AnimationSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().default(''),
    displayType: z.number().int().nonnegative().default(0),
    effectName: z.string().default(''),
    flashTimings: z.array(z.unknown()).default([]),
    soundTimings: z.array(z.unknown()).default([]),
    offsetX: z.number().int().default(0),
    offsetY: z.number().int().default(0),
    rotation: z
      .object({
        x: z.number().default(0),
        y: z.number().default(0),
        z: z.number().default(0),
      })
      .passthrough()
      .default({}),
    scale: z.number().default(100),
    speed: z.number().default(100),
  })
  .passthrough();

export type Animation = z.infer<typeof AnimationSchema>;
