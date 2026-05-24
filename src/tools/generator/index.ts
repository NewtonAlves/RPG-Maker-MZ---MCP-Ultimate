/**
 * Tools do Character Generator do MZ — agora com composição REAL via jimp.
 *
 *   - generator_list_parts: lista partes disponíveis
 *   - generator_preview: lista partes que seriam usadas (sem render)
 *   - actor_*_generate: COMPÕE de verdade as camadas e salva no projeto
 *
 * Z-order default em src/core/generator-recipes.ts; pode sobrescrever via param.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { composeLayers } from '../../core/image-composer.js';
import {
  DEFAULT_Z_ORDER,
  outputCategoryFor,
  partPath,
  sortPartsByZ,
  type GeneratorKind,
  type Gender,
} from '../../core/generator-recipes.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const KIND_ENUM = z.enum(['Face', 'SV', 'TV', 'TVD', 'Variation']);
const GENDER_ENUM = z.enum(['Female', 'Male', 'Kid']);

export function registerGeneratorTools(server: McpServer, config: Config): void {
  /* -------------------- generator_list_parts -------------------- */
  server.registerTool(
    'generator_list_parts',
    {
      description:
        'Lista partes (PNGs) do character generator do MZ. Agrupa por categoria detectada ' +
        'no prefixo do arquivo (Body, Hair, Eyes, AccA, etc.).',
      inputSchema: z.object({
        kind: KIND_ENUM,
        gender: GENDER_ENUM.default('Female').describe('Default Female'),
        category: z.string().optional().describe('Filtra por categoria (ex.: "Body", "Hair")'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const dir = path.join(config.mz.installPath, 'generator', args.kind, args.gender);
        let files: string[];
        try {
          files = await fs.readdir(dir);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            throw mzError('file_not_found', `Pasta ${args.kind}/${args.gender} não existe.`);
          }
          throw err;
        }
        const byCategory: Record<string, string[]> = {};
        for (const f of files) {
          if (!f.endsWith('.png')) continue;
          const m = /^[A-Z]+_([A-Za-z]+)_p\d+/.exec(f);
          const cat = m?.[1] ?? 'Other';
          byCategory[cat] ??= [];
          byCategory[cat]!.push(f);
        }
        if (args.category) {
          const filtered = byCategory[args.category];
          return {
            kind: args.kind, gender: args.gender, category: args.category,
            files: filtered?.sort() ?? [],
            count: filtered?.length ?? 0,
          };
        }
        return {
          kind: args.kind,
          gender: args.gender,
          categories: Object.keys(byCategory).sort(),
          countByCategory: Object.fromEntries(
            Object.entries(byCategory).map(([k, v]) => [k, v.length]),
          ),
          totalFiles: files.filter((f) => f.endsWith('.png')).length,
        };
      }),
  );

  /* -------------------- generator_preview -------------------- */
  server.registerTool(
    'generator_preview',
    {
      description:
        'Descreve a composição planejada (paths reais, ordem Z) sem renderizar. Útil ' +
        'pra validar antes de gerar.',
      inputSchema: z.object({
        kind: z.enum(['Face', 'SV', 'TV', 'TVD']),
        gender: GENDER_ENUM.default('Female'),
        parts: z.record(z.string()).default({}),
        zOrder: z.array(z.string()).optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const ordered = sortPartsByZ(args.parts, args.zOrder ?? DEFAULT_Z_ORDER);
        const planned = await Promise.all(
          ordered.map(async (p) => {
            const fullPath = partPath(config.mz.installPath, args.kind as GeneratorKind, args.gender as Gender, p.file);
            let exists = false;
            try { await fs.access(fullPath); exists = true; } catch {}
            return { ...p, fullPath, exists };
          }),
        );
        return {
          kind: args.kind, gender: args.gender,
          orderedLayers: planned,
          ready: planned.every((p) => p.exists),
        };
      }),
  );

  /* -------------------- generator_compose ------------------- */
  registerGenerateTool(
    server, config,
    'actor_sprite_generate',
    'TV',
    'Compõe sprite TV (character walking sheet 576x384). Output em img/characters/<actorName>.png.',
  );
  registerGenerateTool(
    server, config,
    'actor_face_generate',
    'Face',
    'Compõe face (portrait grid 4x2). Output em img/faces/<actorName>.png.',
  );
  registerGenerateTool(
    server, config,
    'actor_battler_generate_sv',
    'SV',
    'Compõe sideview battler. Output em img/sv_actors/<actorName>.png.',
  );
}

/* ============================ generator tool factory ============================ */

function registerGenerateTool(
  server: McpServer,
  config: Config,
  toolName: string,
  kind: GeneratorKind,
  description: string,
): void {
  server.registerTool(
    toolName,
    {
      description,
      inputSchema: z.object({
        actorName: z.string().min(1).describe('Nome final do arquivo (sem .png)'),
        gender: GENDER_ENUM.default('Female'),
        parts: z
          .record(z.string())
          .describe('Mapa categoria → nome do arquivo (ex.: { Body: "TV_Body_p01_c.png" })'),
        zOrder: z.array(z.string()).optional().describe('Override do Z-order default'),
        overwrite: z.boolean().default(false).describe('Sobrescreve PNG existente'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const ordered = sortPartsByZ(args.parts, args.zOrder ?? DEFAULT_Z_ORDER);
        if (ordered.length === 0) {
          throw mzError('schema_validation_failed', 'Pelo menos uma parte é necessária.');
        }
        const layerPaths = ordered.map((p) =>
          partPath(config.mz.installPath, kind, args.gender as Gender, p.file),
        );

        const destDir = path.join(config.project.path, outputCategoryFor(kind));
        await fs.mkdir(destDir, { recursive: true });
        const destPath = path.join(destDir, `${args.actorName}.png`);

        if (!args.overwrite) {
          try {
            await fs.access(destPath);
            throw mzError(
              'schema_validation_failed',
              `${destPath} já existe. Use overwrite=true ou escolha outro actorName.`,
            );
          } catch (err) {
            if (
              (err as NodeJS.ErrnoException).code !== 'ENOENT' &&
              !(err instanceof Error && err.message.includes('já existe'))
            )
              throw err;
            if (err instanceof Error && err.message.includes('já existe')) throw err;
          }
        }

        const result = await composeLayers(layerPaths, destPath);
        return {
          generated: true,
          kind,
          gender: args.gender,
          ...result,
          layerOrder: ordered.map((o) => o.category),
        };
      }),
  );
}
