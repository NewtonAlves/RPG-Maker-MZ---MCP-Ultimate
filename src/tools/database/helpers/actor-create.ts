/**
 * Helper: actor_create — cria um novo personagem com defaults sensatos.
 *
 * Mais fácil que db_create("actor", {...}) porque preenche os campos chatos
 * (characterIndex, faceIndex, traits, note).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Config } from '../../../config.js';
import { loadDbRaw, nextFreeId, saveDbRaw, setRecordAtId } from '../../../core/db-io.js';
import { ActorSchema } from '../../../schemas/data/actor.js';
import { mzError } from '../../../utils/errors.js';
import { mcpReturn } from '../index.js';

export function registerActorCreateHelper(server: McpServer, config: Config): void {
  server.registerTool(
    'actor_create',
    {
      description:
        'Cria um personagem novo com defaults razoáveis. Atalho pra db_create("actor", ...) ' +
        'preenchendo campos comuns (sprite Actor1, face Actor1, traits=[], note="").',
      inputSchema: z.object({
        name: z.string().min(1).describe('Nome do personagem (ex.: "Marina")'),
        classId: z.number().int().positive().default(1).describe('ID da classe (de Classes.json)'),
        initialLevel: z.number().int().positive().default(1),
        maxLevel: z.number().int().min(1).max(99).default(99),
        nickname: z.string().default(''),
        profile: z.string().default(''),
        characterName: z.string().default('Actor1').describe('Nome do spritesheet (em img/characters/)'),
        characterIndex: z.number().int().min(0).max(7).default(0),
        faceName: z.string().default('Actor1').describe('Nome do face (em img/faces/)'),
        faceIndex: z.number().int().min(0).max(7).default(0),
        battlerName: z
          .string()
          .default('Actor1_1')
          .describe('Nome do battler SV (em img/sv_actors/)'),
        equips: z
          .array(z.number().int().nonnegative())
          .length(5)
          .default([0, 0, 0, 0, 0])
          .describe('5 slots: [weapon, shield, head, body, accessory] — IDs de Weapons/Armors.'),
        id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Force um ID específico. Se omitido, usa o próximo livre.'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const raw = await loadDbRaw(config, 'actor');
        let id: number;
        if (typeof args.id === 'number') {
          if (raw[args.id]) {
            throw mzError(
              'schema_validation_failed',
              `Já existe um personagem com id=${args.id}.`,
            );
          }
          id = args.id;
        } else {
          id = nextFreeId(raw);
        }

        const actor = ActorSchema.parse({
          id,
          name: args.name,
          nickname: args.nickname,
          profile: args.profile,
          classId: args.classId,
          initialLevel: args.initialLevel,
          maxLevel: args.maxLevel,
          characterName: args.characterName,
          characterIndex: args.characterIndex,
          faceName: args.faceName,
          faceIndex: args.faceIndex,
          battlerName: args.battlerName,
          equips: args.equips,
          traits: [],
          note: '',
        });

        setRecordAtId(raw, actor);
        await saveDbRaw(config, 'actor', raw, { destructive: false });
        return { id, actor };
      }),
  );
}
