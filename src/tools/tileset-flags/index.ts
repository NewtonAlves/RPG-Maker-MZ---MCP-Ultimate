/**
 * Tools de manipulação de tileset flags com encoding/decoding.
 *
 * Esconde bit manipulation: passage bits, terrain tag, ladder/bush/counter/damage_floor.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadDbRaw, saveDbRaw, setRecordAtId, type DbRecord } from '../../core/db-io.js';
import { decodeTilesetFlag, encodeTilesetFlag, TILESET_FLAGS } from '../../core/mz-codes-loader.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const DIRS = z.enum(['down', 'left', 'right', 'up']);
const FLAG_KIND = z.enum(['ladder', 'bush', 'counter', 'damage_floor']);

export function registerTilesetFlagTools(server: McpServer, config: Config): void {
  server.registerTool(
    'tileset_set_passage',
    {
      description:
        'Define passabilidade de um tile. blockedDirs é array de direções bloqueadas. ' +
        'Ex.: ["down","left"] bloqueia south e west, libera north e east. Vazio = passa em tudo. ' +
        'Preserva outros bits (terrain tag, ladder, etc.).',
      inputSchema: z.object({
        tilesetId: z.number().int().positive(),
        tileIdx: z.number().int().nonnegative().describe('Índice no array tileset.flags (não é tile ID)'),
        blockedDirs: z.array(DIRS).default([]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'tileset');
        const tileset = raw[args.tilesetId];
        if (!tileset) throw mzError('file_not_found', `Tileset ${args.tilesetId} não existe.`);
        const flags = [...((tileset.flags as number[]) ?? [])];
        if (args.tileIdx >= flags.length) {
          throw mzError('schema_validation_failed', `tileIdx ${args.tileIdx} fora de range (${flags.length})`);
        }
        const current = flags[args.tileIdx]!;
        // Preserva tudo exceto bits 0-3 (passage)
        const preserved = current & ~15;
        let passageBits = 0;
        for (const d of args.blockedDirs) {
          passageBits |= TILESET_FLAGS.bits.passage.bitValues[d] ?? 0;
        }
        const newFlag = preserved | passageBits;
        flags[args.tileIdx] = newFlag;
        const updated = { ...tileset, flags };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, 'tileset', raw);
        return {
          tilesetId: args.tilesetId,
          tileIdx: args.tileIdx,
          previousFlag: current,
          newFlag,
          blockedDirs: args.blockedDirs,
        };
      }),
  );

  server.registerTool(
    'tileset_set_terrain_tag',
    {
      description: 'Define terrain tag (0-7) de um tile. Preserva outros bits.',
      inputSchema: z.object({
        tilesetId: z.number().int().positive(),
        tileIdx: z.number().int().nonnegative(),
        tag: z.number().int().min(0).max(7),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'tileset');
        const tileset = raw[args.tilesetId];
        if (!tileset) throw mzError('file_not_found', `Tileset ${args.tilesetId} não existe.`);
        const flags = [...((tileset.flags as number[]) ?? [])];
        if (args.tileIdx >= flags.length) {
          throw mzError('schema_validation_failed', `tileIdx fora de range`);
        }
        const current = flags[args.tileIdx]!;
        // Preserva tudo exceto bits 12-14 (terrain tag)
        const preserved = current & ~TILESET_FLAGS.bits.terrain_tag.mask;
        const newFlag = preserved | ((args.tag & 7) << TILESET_FLAGS.bits.terrain_tag.shift);
        flags[args.tileIdx] = newFlag;
        const updated = { ...tileset, flags };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, 'tileset', raw);
        return { tilesetId: args.tilesetId, tileIdx: args.tileIdx, previousFlag: current, newFlag, tag: args.tag };
      }),
  );

  server.registerTool(
    'tileset_set_flag',
    {
      description: 'Liga/desliga um bit específico: ladder, bush, counter, damage_floor.',
      inputSchema: z.object({
        tilesetId: z.number().int().positive(),
        tileIdx: z.number().int().nonnegative(),
        kind: FLAG_KIND,
        value: z.boolean(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'tileset');
        const tileset = raw[args.tilesetId];
        if (!tileset) throw mzError('file_not_found', `Tileset ${args.tilesetId} não existe.`);
        const flags = [...((tileset.flags as number[]) ?? [])];
        if (args.tileIdx >= flags.length) throw mzError('schema_validation_failed', 'tileIdx fora de range');
        const current = flags[args.tileIdx]!;
        const mask = TILESET_FLAGS.bits[args.kind].mask;
        const newFlag = args.value ? current | mask : current & ~mask;
        flags[args.tileIdx] = newFlag;
        const updated = { ...tileset, flags };
        setRecordAtId(raw, updated as DbRecord);
        await saveDbRaw(config, 'tileset', raw);
        return { tilesetId: args.tilesetId, tileIdx: args.tileIdx, kind: args.kind, value: args.value, previousFlag: current, newFlag };
      }),
  );

  server.registerTool(
    'tileset_get_flags_decoded',
    {
      description: 'Lê o flag de um tile e decodifica em struct legível (passage, ladder, bush, counter, damage_floor, terrain_tag).',
      inputSchema: z.object({
        tilesetId: z.number().int().positive(),
        tileIdx: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'tileset');
        const tileset = raw[args.tilesetId];
        if (!tileset) throw mzError('file_not_found', `Tileset ${args.tilesetId} não existe.`);
        const flags = (tileset.flags as number[]) ?? [];
        if (args.tileIdx >= flags.length) throw mzError('schema_validation_failed', 'tileIdx fora de range');
        const raw_flag = flags[args.tileIdx]!;
        return {
          tilesetId: args.tilesetId,
          tileIdx: args.tileIdx,
          rawFlag: raw_flag,
          decoded: decodeTilesetFlag(raw_flag),
        };
      }),
  );

  server.registerTool(
    'tileset_encode_flag',
    {
      description: 'Helper: dado um struct (blockedDirs, ladder, etc.), computa o valor numérico do flag.',
      inputSchema: z.object({
        blockedDirs: z.array(DIRS).default([]),
        ladder: z.boolean().default(false),
        bush: z.boolean().default(false),
        counter: z.boolean().default(false),
        damage_floor: z.boolean().default(false),
        terrain_tag: z.number().int().min(0).max(7).default(0),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => ({
        flag: encodeTilesetFlag({
          blockedDirs: args.blockedDirs,
          ladder: args.ladder,
          bush: args.bush,
          counter: args.counter,
          damage_floor: args.damage_floor,
          terrain_tag: args.terrain_tag,
        }),
        decoded: { blockedDirs: args.blockedDirs, ladder: args.ladder, bush: args.bush, counter: args.counter, damage_floor: args.damage_floor, terrain_tag: args.terrain_tag },
      })),
  );
}
