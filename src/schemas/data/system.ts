import { z } from 'zod';
import { AudioFileSchema } from '../shared/index.js';

/**
 * System.json — configurações globais do jogo. Schema lenient: tem MUITOS campos
 * (terms, sounds, vehicles, etc.) e queremos preservar tudo que não tocamos.
 */
export const SystemSchema = z
  .object({
    gameTitle: z.string().default(''),
    versionId: z.number().int().nonnegative().default(0),
    locale: z.string().default('en_US'),
    optDrawTitle: z.boolean().default(true),
    optTransparent: z.boolean().default(false),
    optFollowers: z.boolean().default(true),
    optSlipDeath: z.boolean().default(false),
    optFloorDeath: z.boolean().default(false),
    optDisplayTp: z.boolean().default(true),
    optExtraExp: z.boolean().default(false),
    optSideView: z.boolean().default(false),
    optAutosave: z.boolean().default(false),
    optKeyItemsNumber: z.boolean().default(false),
    optUseMidi: z.boolean().default(false),
    windowTone: z.array(z.number()).length(4).default([0, 0, 0, 0]),
    screenWidth: z.number().int().positive().default(816),
    screenHeight: z.number().int().positive().default(624),
    uiAreaWidth: z.number().int().positive().default(816),
    uiAreaHeight: z.number().int().positive().default(624),
    titleBgm: AudioFileSchema.default({}),
    battleBgm: AudioFileSchema.default({}),
    defeatMe: AudioFileSchema.default({}),
    victoryMe: AudioFileSchema.default({}),
    gameoverMe: AudioFileSchema.default({}),
    title1Name: z.string().default(''),
    title2Name: z.string().default(''),
    startMapId: z.number().int().nonnegative().default(1),
    startX: z.number().int().nonnegative().default(0),
    startY: z.number().int().nonnegative().default(0),
    partyMembers: z.array(z.number().int()).default([1]),
    currencyUnit: z.string().default('G'),
    /** Terms — strings mostradas no UI. */
    terms: z.record(z.unknown()).default({}),
    /** Arrays variados — schema lenient. */
    elements: z.array(z.string()).default([]),
    skillTypes: z.array(z.string()).default([]),
    weaponTypes: z.array(z.string()).default([]),
    armorTypes: z.array(z.string()).default([]),
    equipTypes: z.array(z.string()).default([]),
    sounds: z.array(z.unknown()).default([]),
    boat: z.unknown().optional(),
    ship: z.unknown().optional(),
    airship: z.unknown().optional(),
  })
  .passthrough();

export type System = z.infer<typeof SystemSchema>;
