/**
 * Tools de integração com a instalação local do RPG Maker MZ.
 *
 * Fase 1 implementa:
 *   - mz_install_detect_path
 *
 * Pendentes (fases posteriores):
 *   - mz_install_get_corescript_path
 *   - mz_install_list_dlc_plugins
 *   - mz_install_get_help_url
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { corescriptPath, detectMzInstallPath, listCorescriptVersions } from '../../core/mz-install.js';
import { helpUrl, type HelpTopic } from '../../utils/help-link.js';
import { mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerMzInstallTools(server: McpServer, config: Config): void {
  server.registerTool(
    'mz_install_detect_path',
    {
      description:
        'Detecta o caminho de instalação do RPG Maker MZ no sistema. ' +
        'Verifica caminhos canônicos do Steam (Windows/Mac/Linux). ' +
        'Retorna o caminho absoluto se encontrado, ou um erro útil caso contrário.',
      inputSchema: z.object({}).shape, // Empty shape for no-input tools
    },
    async () => {
      // Se config já tem installPath resolvido, retorna ele direto
      if (config.mz.installPath && config.mz.installPath !== 'auto') {
        const versions = await listCorescriptVersions(config.mz.installPath);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  installPath: config.mz.installPath,
                  source: 'config',
                  corescriptVersions: versions,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const detected = await detectMzInstallPath();
      if (!detected) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'mz_install_not_found',
                  message:
                    'Não foi possível detectar a instalação do RPG Maker MZ. ' +
                    'Verifique se está instalado via Steam, ou defina MZ_INSTALL_PATH ' +
                    'na variável de ambiente apontando pra pasta da instalação.',
                  searchedPlatform: process.platform,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const versions = await listCorescriptVersions(detected);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                installPath: detected,
                source: 'auto-detect',
                corescriptVersions: versions,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  /* -------------------- mz_install_get_corescript_path -------------------- */
  server.registerTool(
    'mz_install_get_corescript_path',
    {
      description:
        'Retorna o caminho da pasta corescript pra uma versão específica (ou a configurada). ' +
        'Útil pra ler rmmz_objects.js como source of truth.',
      inputSchema: z.object({
        version: z.string().optional().describe('Versão (default: config.mz.corescriptVersion)'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const version = args.version ?? config.mz.corescriptVersion;
        const p = corescriptPath(config.mz.installPath, version);
        const files: string[] = [];
        try {
          for (const f of await fs.readdir(p)) {
            if (f.endsWith('.js')) files.push(f);
          }
        } catch {
          throw mzError('file_not_found', `corescript ${version} não existe em ${p}`);
        }
        return { version, path: p, files: files.sort() };
      }),
  );

  /* -------------------- mz_install_list_dlc_plugins -------------------- */
  server.registerTool(
    'mz_install_list_dlc_plugins',
    {
      description:
        'Lista plugins bundled na pasta dlc/ da instalação MZ. Útil pra plugin_install_from_dlc.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const dlcDir = path.join(config.mz.installPath, 'dlc');
        const result: Record<string, string[]> = {};
        let dlcSets: string[];
        try {
          const entries = await fs.readdir(dlcDir, { withFileTypes: true });
          dlcSets = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          return { available: false, sets: [] };
        }
        for (const set of dlcSets) {
          const pluginDir = path.join(dlcDir, set, 'js', 'plugins');
          try {
            const files = await fs.readdir(pluginDir);
            result[set] = files.filter((f) => f.endsWith('.js')).sort();
          } catch {
            result[set] = [];
          }
        }
        return { available: true, totalSets: dlcSets.length, sets: result };
      }),
  );

  /* -------------------- mz_install_get_help_url -------------------- */
  server.registerTool(
    'mz_install_get_help_url',
    {
      description:
        'Retorna o caminho file:// pra a página de ajuda local de um tópico. Útil pra incluir ' +
        'em mensagens explicativas. lang default "en".',
      inputSchema: z.object({
        topic: z.enum([
          'actor', 'class', 'skill', 'item', 'weapon', 'armor', 'enemy', 'troop',
          'state', 'animation', 'tileset', 'common_event', 'system', 'map',
          'event_command', 'plugin', 'asset_character', 'asset_face',
          'asset_tileset', 'asset_audio', 'switch_variable',
        ] as const),
        lang: z.enum(['en', 'ja', 'zh-cn']).default('en'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => ({
        topic: args.topic,
        lang: args.lang,
        url: helpUrl(config.mz.installPath, args.topic as HelpTopic, args.lang),
      })),
  );
}
