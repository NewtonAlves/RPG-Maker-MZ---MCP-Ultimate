/**
 * Schemas Zod compartilhados entre records MZ.
 *
 * Traits, Effects, DamageInfo, DropItem, AudioFile — usados em vários tipos.
 * Mantemos LENIENT: allow extras via passthrough; valida apenas o shape conhecido.
 */

import { z } from 'zod';

/**
 * Trait — usado em Actor, Class, Weapon, Armor, Enemy, State.
 * { code: number, dataId: number, value: number }
 * Os codes são mapeados pelo engine (ex.: 11=Element Rate, 22=Param, 41=Skill Type, etc.)
 */
export const TraitSchema = z
  .object({
    code: z.number().int().nonnegative(),
    dataId: z.number().int().nonnegative(),
    value: z.number(),
  })
  .passthrough();
export type Trait = z.infer<typeof TraitSchema>;

/**
 * Effect — usado em Skill e Item.
 * { code: number, dataId: number, value1: number, value2: number }
 * Codes: 11=HP, 12=MP, 13=TP, 21=Add State, 22=Remove State, 31=Special, etc.
 */
export const EffectSchema = z
  .object({
    code: z.number().int().nonnegative(),
    dataId: z.number().int().nonnegative(),
    value1: z.number(),
    value2: z.number(),
  })
  .passthrough();
export type Effect = z.infer<typeof EffectSchema>;

/**
 * DamageInfo — usado em Skill e Item.
 * type: 0=None, 1=HP Damage, 2=MP Damage, 3=HP Recover, 4=MP Recover, 5=HP Drain, 6=MP Drain
 */
export const DamageInfoSchema = z
  .object({
    type: z.number().int().nonnegative().default(0),
    elementId: z.number().int().default(-1),
    formula: z.string().default('0'),
    variance: z.number().int().min(0).max(100).default(20),
    critical: z.boolean().default(false),
  })
  .passthrough();
export type DamageInfo = z.infer<typeof DamageInfoSchema>;

/**
 * DropItem — usado em Enemy.
 * kind: 0=None, 1=Item, 2=Weapon, 3=Armor
 * dataId: ID do item/weapon/armor
 * denominator: 1/denominator chance de drop (ex.: 3 = 1/3)
 */
export const DropItemSchema = z
  .object({
    kind: z.number().int().min(0).max(3).default(0),
    dataId: z.number().int().nonnegative().default(0),
    denominator: z.number().int().positive().default(1),
  })
  .passthrough();
export type DropItem = z.infer<typeof DropItemSchema>;

/**
 * AudioFile — referência a um arquivo de áudio (BGM, BGS, ME, SE) no projeto.
 */
export const AudioFileSchema = z
  .object({
    name: z.string().default(''),
    volume: z.number().int().min(0).max(100).default(90),
    pitch: z.number().int().min(50).max(150).default(100),
    pan: z.number().int().min(-100).max(100).default(0),
  })
  .passthrough();
export type AudioFile = z.infer<typeof AudioFileSchema>;

/**
 * EventCommand — usado em CommonEvent, Map Event, Troop Battle Event.
 * { code: number, indent: number, parameters: any[] }
 * Codes mapeados pelo engine (101=Show Text, 111=Conditional, 201=Transfer, etc.)
 */
export const EventCommandSchema = z
  .object({
    code: z.number().int().nonnegative(),
    indent: z.number().int().nonnegative().default(0),
    parameters: z.array(z.unknown()).default([]),
  })
  .passthrough();
export type EventCommand = z.infer<typeof EventCommandSchema>;

/**
 * EnemyAction — padrão de ação de inimigo.
 * conditionType: 0=Always, 1=Turn, 2=HP, 3=MP, 4=State, 5=Party Level, 6=Switch
 */
export const EnemyActionSchema = z
  .object({
    skillId: z.number().int().positive().default(1),
    conditionType: z.number().int().nonnegative().default(0),
    conditionParam1: z.number().default(0),
    conditionParam2: z.number().default(0),
    rating: z.number().int().min(1).max(10).default(5),
  })
  .passthrough();
export type EnemyAction = z.infer<typeof EnemyActionSchema>;

/**
 * Learning — entrada de habilidade aprendida por uma classe ao subir de nível.
 */
export const LearningSchema = z
  .object({
    level: z.number().int().positive(),
    skillId: z.number().int().positive(),
    note: z.string().default(''),
  })
  .passthrough();
export type Learning = z.infer<typeof LearningSchema>;

/**
 * TroopMember — membro de um Troop.
 */
export const TroopMemberSchema = z
  .object({
    enemyId: z.number().int().positive(),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    hidden: z.boolean().default(false),
  })
  .passthrough();
export type TroopMember = z.infer<typeof TroopMemberSchema>;

/**
 * TroopPage — página de batalha (event commands com condições).
 */
export const TroopPageSchema = z
  .object({
    conditions: z
      .object({
        turnEnding: z.boolean().default(false),
        turnValid: z.boolean().default(false),
        turnA: z.number().int().nonnegative().default(0),
        turnB: z.number().int().nonnegative().default(0),
        enemyValid: z.boolean().default(false),
        enemyIndex: z.number().int().nonnegative().default(0),
        enemyHp: z.number().int().nonnegative().default(50),
        actorValid: z.boolean().default(false),
        actorId: z.number().int().nonnegative().default(1),
        actorHp: z.number().int().nonnegative().default(50),
        switchValid: z.boolean().default(false),
        switchId: z.number().int().nonnegative().default(1),
      })
      .passthrough()
      .default({}),
    span: z.number().int().nonnegative().default(0),
    list: z.array(EventCommandSchema).default([]),
  })
  .passthrough();
export type TroopPage = z.infer<typeof TroopPageSchema>;
