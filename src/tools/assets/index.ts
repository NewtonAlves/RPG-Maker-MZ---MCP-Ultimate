/**
 * Tools de Assets (imagens e áudio).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import {
  AUDIO_SPECS,
  IMAGE_SPECS,
  isAudioCategory,
  isImageCategory,
  type AudioCategory,
  type ImageCategory,
} from '../../core/asset-formats.js';
import { readPngInfo } from '../../core/png-info.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

const ImageCategoryEnum = z.enum(Object.keys(IMAGE_SPECS) as [ImageCategory, ...ImageCategory[]]);
const AudioCategoryEnum = z.enum(Object.keys(AUDIO_SPECS) as [AudioCategory, ...AudioCategory[]]);

export function registerAssetTools(server: McpServer, config: Config): void {
  /* -------------------- asset_list ------------------------- */
  server.registerTool(
    'asset_list',
    {
      description:
        'Lista arquivos numa categoria de asset (imagem). Categorias: ' +
        Object.keys(IMAGE_SPECS).join(', '),
      inputSchema: z.object({
        category: ImageCategoryEnum,
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = IMAGE_SPECS[args.category];
        const dir = path.join(config.project.path, spec.folder);
        let files: string[] = [];
        try {
          files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png'));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        return {
          category: args.category,
          folder: spec.folder,
          count: files.length,
          files: files.sort(),
        };
      }),
  );

  /* -------------------- audio_list ------------------------- */
  server.registerTool(
    'audio_list',
    {
      description: 'Lista arquivos de áudio numa categoria (bgm, bgs, me, se).',
      inputSchema: z.object({ category: AudioCategoryEnum }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = AUDIO_SPECS[args.category];
        const dir = path.join(config.project.path, spec.folder);
        let files: string[] = [];
        try {
          const all = await fs.readdir(dir);
          files = all.filter((f) => spec.extensions.some((ext) => f.toLowerCase().endsWith(ext)));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        return {
          category: args.category,
          folder: spec.folder,
          count: files.length,
          files: files.sort(),
        };
      }),
  );

  /* -------------------- asset_validate_format -------------- */
  server.registerTool(
    'asset_validate_format',
    {
      description:
        'Valida que um arquivo PNG bate com as dimensões esperadas pra categoria. ' +
        'Retorna ok=true se válido (ou flexível), senão warnings.',
      inputSchema: z.object({
        sourcePath: z.string().min(1),
        category: ImageCategoryEnum,
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = IMAGE_SPECS[args.category];
        const info = await readPngInfo(args.sourcePath);
        const warnings: string[] = [];
        let ok = true;
        if (spec.expectedWidth !== undefined && info.width !== spec.expectedWidth) {
          warnings.push(
            `Width ${info.width} ≠ esperado ${spec.expectedWidth} pra ${args.category}.`,
          );
          if (!spec.flexible) ok = false;
        }
        if (spec.expectedHeight !== undefined && info.height !== spec.expectedHeight) {
          warnings.push(
            `Height ${info.height} ≠ esperado ${spec.expectedHeight} pra ${args.category}.`,
          );
          if (!spec.flexible) ok = false;
        }
        return { ok, info, expected: spec, warnings };
      }),
  );

  /* -------------------- asset_import ----------------------- */
  server.registerTool(
    'asset_import',
    {
      description:
        'Importa um PNG pra a pasta certa do projeto. Valida formato (dimensões) antes; ' +
        'rejeita se incompatível e categoria não-flexível (a menos que force=true).',
      inputSchema: z.object({
        sourcePath: z.string().min(1),
        category: ImageCategoryEnum,
        destName: z.string().optional().describe('Nome final (default: basename do source)'),
        force: z.boolean().default(false).describe('Aceita formato divergente em categoria rígida'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = IMAGE_SPECS[args.category];
        const info = await readPngInfo(args.sourcePath);
        const warnings: string[] = [];
        let ok = true;
        if (spec.expectedWidth !== undefined && info.width !== spec.expectedWidth) {
          warnings.push(`Width ${info.width} ≠ ${spec.expectedWidth}`);
          if (!spec.flexible) ok = false;
        }
        if (spec.expectedHeight !== undefined && info.height !== spec.expectedHeight) {
          warnings.push(`Height ${info.height} ≠ ${spec.expectedHeight}`);
          if (!spec.flexible) ok = false;
        }
        if (!ok && !args.force) {
          throw mzError(
            'asset_format_invalid',
            `Asset incompatível com ${args.category}: ${warnings.join('; ')}. Use force=true pra ignorar.`,
            { details: { info, expected: spec, warnings } },
          );
        }
        const baseName = args.destName ?? path.basename(args.sourcePath);
        const destDir = path.join(config.project.path, spec.folder);
        await fs.mkdir(destDir, { recursive: true });
        const destPath = path.join(destDir, baseName);
        await fs.copyFile(args.sourcePath, destPath);
        return { imported: true, destPath, category: args.category, info, warnings };
      }),
  );

  /* -------------------- audio_import_bgm/bgs/me/se --------- */
  for (const cat of ['bgm', 'bgs', 'me', 'se'] as const) {
    server.registerTool(
      `audio_import_${cat}`,
      {
        description: `Importa um arquivo de áudio (.ogg ou .m4a) pra audio/${cat}/.`,
        inputSchema: z.object({
          sourcePath: z.string().min(1),
          destName: z.string().optional(),
        }).shape,
      },
      async (args) =>
        mcpReturn(async () => {
          const spec = AUDIO_SPECS[cat];
          const ext = path.extname(args.sourcePath).toLowerCase();
          if (!spec.extensions.includes(ext)) {
            throw mzError(
              'asset_format_invalid',
              `Extensão "${ext}" não permitida em ${cat}. Aceitas: ${spec.extensions.join(', ')}.`,
            );
          }
          const baseName = args.destName ?? path.basename(args.sourcePath);
          const destDir = path.join(config.project.path, spec.folder);
          await fs.mkdir(destDir, { recursive: true });
          const destPath = path.join(destDir, baseName);
          await fs.copyFile(args.sourcePath, destPath);
          return { imported: true, destPath, category: cat };
        }),
    );
  }

  /* -------------------- asset_get_info --------------------- */
  server.registerTool(
    'asset_get_info',
    {
      description: 'Retorna info (width, height) de um PNG no projeto.',
      inputSchema: z.object({
        category: ImageCategoryEnum,
        name: z.string().min(1).describe('Nome do arquivo (com .png)'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const spec = IMAGE_SPECS[args.category];
        const filePath = path.join(config.project.path, spec.folder, args.name);
        const info = await readPngInfo(filePath);
        return { category: args.category, name: args.name, ...info };
      }),
  );

  /* -------------------- asset_delete ----------------------- */
  server.registerTool(
    'asset_delete',
    {
      description: 'Deleta um asset (PNG ou áudio). Operação destrutiva — sem snapshot ' +
        '(assets têm muito espaço). Use git pra versionar.',
      inputSchema: z.object({
        kind: z.enum(['image', 'audio']),
        category: z.string().min(1),
        name: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        let folder: string;
        if (args.kind === 'image') {
          if (!isImageCategory(args.category)) {
            throw mzError('schema_validation_failed', `Categoria de imagem inválida: ${args.category}`);
          }
          folder = IMAGE_SPECS[args.category].folder;
        } else {
          if (!isAudioCategory(args.category)) {
            throw mzError('schema_validation_failed', `Categoria de áudio inválida: ${args.category}`);
          }
          folder = AUDIO_SPECS[args.category].folder;
        }
        const filePath = path.join(config.project.path, folder, args.name);
        await fs.unlink(filePath);
        return { deleted: true, path: filePath };
      }),
  );

  /* -------------------- asset_categories_list -------------- */
  server.registerTool(
    'asset_categories_list',
    {
      description: 'Lista as categorias de asset com specs (dimensões esperadas, pastas).',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => ({
        image: IMAGE_SPECS,
        audio: AUDIO_SPECS,
      })),
  );
}
