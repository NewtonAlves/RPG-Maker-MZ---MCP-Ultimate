import { z } from 'zod';
import { EventCommandSchema } from '../shared/index.js';

export const EventPageConditionsSchema = z
  .object({
    actorId: z.number().int().nonnegative().default(1),
    actorValid: z.boolean().default(false),
    itemId: z.number().int().nonnegative().default(1),
    itemValid: z.boolean().default(false),
    selfSwitchCh: z.enum(['A', 'B', 'C', 'D']).default('A'),
    selfSwitchValid: z.boolean().default(false),
    switch1Id: z.number().int().nonnegative().default(1),
    switch1Valid: z.boolean().default(false),
    switch2Id: z.number().int().nonnegative().default(1),
    switch2Valid: z.boolean().default(false),
    variableId: z.number().int().nonnegative().default(1),
    variableValid: z.boolean().default(false),
    variableValue: z.number().default(0),
  })
  .passthrough();

export const EventPageImageSchema = z
  .object({
    tileId: z.number().int().nonnegative().default(0),
    characterName: z.string().default(''),
    direction: z.number().int().min(2).max(8).default(2),
    pattern: z.number().int().min(0).max(3).default(0),
    characterIndex: z.number().int().min(0).max(7).default(0),
  })
  .passthrough();

export const MoveRouteSchema = z
  .object({
    list: z
      .array(
        z.object({
          code: z.number().int().nonnegative(),
          parameters: z.array(z.unknown()).default([]),
        }).passthrough(),
      )
      .default([{ code: 0, parameters: [] }]),
    repeat: z.boolean().default(true),
    skippable: z.boolean().default(false),
    wait: z.boolean().default(false),
  })
  .passthrough();

export const EventPageSchema = z
  .object({
    conditions: EventPageConditionsSchema.default({}),
    directionFix: z.boolean().default(false),
    image: EventPageImageSchema.default({}),
    list: z.array(EventCommandSchema).default([{ code: 0, indent: 0, parameters: [] }]),
    moveFrequency: z.number().int().min(1).max(5).default(3),
    moveRoute: MoveRouteSchema.default({}),
    moveSpeed: z.number().int().min(1).max(6).default(3),
    moveType: z.number().int().min(0).max(3).default(0),
    /** priorityType: 0=Below characters, 1=Same as characters, 2=Above characters */
    priorityType: z.number().int().min(0).max(2).default(1),
    stepAnime: z.boolean().default(false),
    through: z.boolean().default(false),
    /** trigger: 0=Action Button, 1=Player Touch, 2=Event Touch, 3=Autorun, 4=Parallel */
    trigger: z.number().int().min(0).max(4).default(0),
    walkAnime: z.boolean().default(true),
  })
  .passthrough();

export type EventPage = z.infer<typeof EventPageSchema>;
export type EventPageConditions = z.infer<typeof EventPageConditionsSchema>;
export type EventPageImage = z.infer<typeof EventPageImageSchema>;
