import { z } from 'zod';
import { AudioFileSchema } from '../shared/index.js';
import { MapEventSchema } from './map-event.js';

export const MapEncounterSchema = z
  .object({
    troopId: z.number().int().positive(),
    weight: z.number().int().min(0).default(5),
    regionSet: z.array(z.number().int()).default([]),
  })
  .passthrough();

export const MapSchema = z
  .object({
    displayName: z.string().default(''),
    tilesetId: z.number().int().positive().default(1),
    width: z.number().int().min(17).max(256).default(17),
    height: z.number().int().min(13).max(256).default(13),
    scrollType: z.number().int().min(0).max(3).default(0),
    autoplayBgm: z.boolean().default(false),
    bgm: AudioFileSchema.default({}),
    autoplayBgs: z.boolean().default(false),
    bgs: AudioFileSchema.default({}),
    disableDashing: z.boolean().default(false),
    encounterList: z.array(MapEncounterSchema).default([]),
    encounterStep: z.number().int().positive().default(30),
    parallaxLoopX: z.boolean().default(false),
    parallaxLoopY: z.boolean().default(false),
    parallaxName: z.string().default(''),
    parallaxShow: z.boolean().default(true),
    parallaxSx: z.number().int().default(0),
    parallaxSy: z.number().int().default(0),
    specifyBattleback: z.boolean().default(false),
    battleback1Name: z.string().default(''),
    battleback2Name: z.string().default(''),
    note: z.string().default(''),
    /** Tile data: array de tamanho width*height*6 (6 camadas) */
    data: z.array(z.number().int()).default([]),
    /** Events: array com null em [0], MapEvent em [1..n] */
    events: z.array(z.union([z.null(), MapEventSchema])).default([null]),
  })
  .passthrough();

export type Map = z.infer<typeof MapSchema>;
