/**
 * Tools de Plugins — instalação, autoria, gerenciamento.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { loadPluginsJs, savePluginsJs, type PluginRegistryEntry } from '../../core/plugins-js.js';
import {
  PluginMetadataSchema,
  blankPluginBody,
  commandOnlyPluginBody,
  generatePluginSource,
} from '../../core/plugin-metadata-gen.js';
import {
  assertPluginSyntax,
  checkPluginSyntax,
  extractMetadata,
} from '../../core/plugin-validator.js';
import { parseMetadataDeep } from '../../core/plugin-metadata-parser.js';
import { mzError } from '../../utils/errors.js';
import { safeWrite } from '../../core/safe-writer.js';
import { mcpReturn } from '../database/index.js';
import { createSnapshot, pruneSnapshots } from '../../core/backup.js';

const pluginNameRegex = /^[A-Za-z][A-Za-z0-9_]*$/;

function pluginFilePath(config: Config, name: string): string {
  return path.join(config.project.path, 'js', 'plugins', `${name}.js`);
}

export function registerPluginTools(server: McpServer, config: Config): void {
  /* ----------------- plugin_list_installed -------------------- */
  server.registerTool(
    'plugin_list_installed',
    {
      description:
        'Lista plugins registrados em js/plugins.js (com status enable/disable). ' +
        'Adicionalmente verifica se o arquivo .js existe em js/plugins/.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const entries = await loadPluginsJs(config);
        const items = await Promise.all(
          entries.map(async (e) => {
            const filePath = pluginFilePath(config, e.name);
            let fileExists = true;
            try {
              await fs.access(filePath);
            } catch {
              fileExists = false;
            }
            return { ...e, fileExists };
          }),
        );
        return { count: items.length, plugins: items };
      }),
  );

  /* ----------------- plugin_install_from_file ----------------- */
  server.registerTool(
    'plugin_install_from_file',
    {
      description:
        'Instala um plugin de um arquivo local. Copia pra js/plugins/<name>.js, adiciona ' +
        'no plugins.js, marca como habilitado por default. Valida sintaxe antes.',
      inputSchema: z.object({
        sourcePath: z.string().min(1).describe('Caminho absoluto do .js'),
        name: z
          .string()
          .optional()
          .describe('Nome do plugin (default: basename do arquivo sem .js)'),
        enabled: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const source = await fs.readFile(args.sourcePath, 'utf-8');
        const name = args.name ?? path.basename(args.sourcePath, '.js');
        if (!pluginNameRegex.test(name)) {
          throw mzError(
            'plugin_invalid',
            `Nome de plugin inválido "${name}". Use [A-Za-z][A-Za-z0-9_]*`,
          );
        }
        assertPluginSyntax(source, name);
        const meta = extractMetadata(source);

        // Copia
        const destPath = pluginFilePath(config, name);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await safeWrite(destPath, source);

        // Registra
        const entries = await loadPluginsJs(config);
        const existing = entries.findIndex((e) => e.name === name);
        const entry: PluginRegistryEntry = {
          name,
          status: args.enabled,
          description: meta.plugindesc ?? '',
          parameters: {},
        };
        if (existing >= 0) entries[existing] = entry;
        else entries.push(entry);
        await savePluginsJs(config, entries);

        return { installed: true, name, params: meta.paramNames, commands: meta.commandNames };
      }),
  );

  /* ----------------- plugin_install_from_dlc ------------------ */
  server.registerTool(
    'plugin_install_from_dlc',
    {
      description:
        'Instala um plugin de uma pasta dlc/ da instalação MZ. Útil pra plugins ' +
        'bundled do tipo ARPG, Horror, Dungeon. Liste DLCs com mz_install_list_dlc_plugins (futuro).',
      inputSchema: z.object({
        dlcSet: z.string().min(1).describe('Nome da pasta sob dlc/ (ex.: "ARPG")'),
        pluginName: z.string().min(1).describe('Nome do plugin (sem .js)'),
        enabled: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const sourcePath = path.join(
          config.mz.installPath,
          'dlc',
          args.dlcSet,
          'js',
          'plugins',
          `${args.pluginName}.js`,
        );
        // Reusa lógica de install_from_file
        const source = await fs.readFile(sourcePath, 'utf-8');
        if (!pluginNameRegex.test(args.pluginName)) {
          throw mzError('plugin_invalid', `Nome inválido: ${args.pluginName}`);
        }
        assertPluginSyntax(source, args.pluginName);
        const meta = extractMetadata(source);
        const destPath = pluginFilePath(config, args.pluginName);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await safeWrite(destPath, source);
        const entries = await loadPluginsJs(config);
        const existing = entries.findIndex((e) => e.name === args.pluginName);
        const entry: PluginRegistryEntry = {
          name: args.pluginName,
          status: args.enabled,
          description: meta.plugindesc ?? '',
          parameters: {},
        };
        if (existing >= 0) entries[existing] = entry;
        else entries.push(entry);
        await savePluginsJs(config, entries);
        return { installed: true, name: args.pluginName, source: 'dlc/' + args.dlcSet };
      }),
  );

  /* ----------------- plugin_uninstall ------------------------- */
  server.registerTool(
    'plugin_uninstall',
    {
      description:
        'Remove um plugin: deleta o .js e remove do plugins.js. Operação destrutiva — cria snapshot.',
      inputSchema: z.object({
        name: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (config.project.autoBackup) {
          await createSnapshot(
            config.project.path,
            config.project.backupDir,
            `before-uninstall-${args.name}`,
          );
          await pruneSnapshots(
            config.project.path,
            config.project.backupDir,
            config.project.backupRetention,
          );
        }
        const entries = await loadPluginsJs(config);
        const idx = entries.findIndex((e) => e.name === args.name);
        if (idx < 0) {
          throw mzError('file_not_found', `Plugin "${args.name}" não está registrado.`);
        }
        entries.splice(idx, 1);
        await savePluginsJs(config, entries);
        // Deleta arquivo
        const filePath = pluginFilePath(config, args.name);
        await fs.unlink(filePath).catch(() => undefined);
        return { uninstalled: true, name: args.name };
      }),
  );

  /* ----------------- plugin_enable / disable ------------------ */
  server.registerTool(
    'plugin_enable',
    {
      description: 'Marca plugin como habilitado em plugins.js.',
      inputSchema: z.object({ name: z.string().min(1) }).shape,
    },
    async (args) => mcpReturn(() => setStatus(config, args.name, true)),
  );

  server.registerTool(
    'plugin_disable',
    {
      description: 'Marca plugin como desabilitado em plugins.js (mantém arquivo).',
      inputSchema: z.object({ name: z.string().min(1) }).shape,
    },
    async (args) => mcpReturn(() => setStatus(config, args.name, false)),
  );

  /* ----------------- plugin_reorder --------------------------- */
  server.registerTool(
    'plugin_reorder',
    {
      description:
        'Reordena plugins.js movendo um plugin pra uma nova posição (0-based). ' +
        'Ordem afeta dependências `@base`.',
      inputSchema: z.object({
        name: z.string().min(1),
        toIndex: z.number().int().nonnegative(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const entries = await loadPluginsJs(config);
        const from = entries.findIndex((e) => e.name === args.name);
        if (from < 0) throw mzError('file_not_found', `Plugin "${args.name}" não está registrado.`);
        const to = Math.min(args.toIndex, entries.length - 1);
        const [e] = entries.splice(from, 1);
        entries.splice(to, 0, e!);
        await savePluginsJs(config, entries);
        return { reordered: true, name: args.name, fromIndex: from, toIndex: to };
      }),
  );

  /* ----------------- plugin_set_param ------------------------- */
  server.registerTool(
    'plugin_set_param',
    {
      description:
        'Define um parameter do plugin (que aparece no Plugin Manager). Valor é ' +
        'serializado como string (MZ espera strings em parameters).',
      inputSchema: z.object({
        name: z.string().min(1),
        paramName: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const entries = await loadPluginsJs(config);
        const e = entries.find((x) => x.name === args.name);
        if (!e) throw mzError('file_not_found', `Plugin "${args.name}" não está registrado.`);
        e.parameters = { ...e.parameters, [args.paramName]: String(args.value) };
        await savePluginsJs(config, entries);
        return { ok: true, name: args.name, paramName: args.paramName, value: String(args.value) };
      }),
  );

  /* ----------------- plugin_create_new ------------------------ */
  server.registerTool(
    'plugin_create_new',
    {
      description:
        'Cria um plugin JS novo do zero: gera bloco JSDoc canônico de metadata + corpo ' +
        'a partir de template ("blank" ou "command_only"). Valida sintaxe. Instala e registra.',
      inputSchema: z.object({
        name: z.string().regex(pluginNameRegex),
        metadata: z.record(z.unknown()).default({}),
        template: z.enum(['blank', 'command_only']).default('blank'),
        body: z.string().optional().describe('Corpo custom; sobrescreve o template'),
        enabled: z.boolean().default(true),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const meta = PluginMetadataSchema.parse(args.metadata);
        let body: string;
        if (args.body) {
          body = args.body;
        } else if (args.template === 'command_only') {
          body = commandOnlyPluginBody(args.name, meta.commands);
        } else {
          body = blankPluginBody(args.name);
        }
        const source = generatePluginSource(meta, body);
        assertPluginSyntax(source, args.name);

        // Escreve arquivo
        const destPath = pluginFilePath(config, args.name);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await safeWrite(destPath, source);

        // Registra
        const entries = await loadPluginsJs(config);
        const existing = entries.findIndex((e) => e.name === args.name);
        const entry: PluginRegistryEntry = {
          name: args.name,
          status: args.enabled,
          description: meta.plugindesc,
          parameters: Object.fromEntries(
            meta.params.map((p) => [p.name, String(p.default ?? '')]),
          ),
        };
        if (existing >= 0) entries[existing] = entry;
        else entries.push(entry);
        await savePluginsJs(config, entries);

        return {
          created: true,
          name: args.name,
          file: destPath,
          paramsRegistered: meta.params.map((p) => p.name),
          commandsRegistered: meta.commands.map((c) => c.name),
        };
      }),
  );

  /* ----------------- plugin_update_code ----------------------- */
  server.registerTool(
    'plugin_update_code',
    {
      description:
        'Substitui o source de um plugin existente. Valida sintaxe antes de escrever.',
      inputSchema: z.object({
        name: z.string().min(1),
        source: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = pluginFilePath(config, args.name);
        try {
          await fs.access(filePath);
        } catch {
          throw mzError('file_not_found', `Plugin "${args.name}" não está instalado.`);
        }
        assertPluginSyntax(args.source, args.name);
        await safeWrite(filePath, args.source);
        return { updated: true, name: args.name };
      }),
  );

  /* ----------------- plugin_validate_metadata ----------------- */
  server.registerTool(
    'plugin_validate_metadata',
    {
      description:
        'Lê um plugin e valida seu bloco JSDoc + sintaxe. Retorna metadata SHALLOW ' +
        '(target, author, plugindesc, lista de nomes de params/commands).',
      inputSchema: z.object({
        name: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = pluginFilePath(config, args.name);
        const source = await fs.readFile(filePath, 'utf-8');
        const syntax = checkPluginSyntax(source);
        const meta = extractMetadata(source);
        return {
          name: args.name,
          syntaxOk: syntax.ok,
          syntaxError: syntax.error,
          metadata: meta,
        };
      }),
  );

  /* ----------------- plugin_parse_metadata_deep --------------- */
  server.registerTool(
    'plugin_parse_metadata_deep',
    {
      description:
        'Parse profundo de metadata: extrai todos os @type, @option, @default, @arg, @parent, ' +
        '@min/@max/@decimals de cada @param e @command. Retorna estrutura completa.',
      inputSchema: z.object({
        name: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const filePath = pluginFilePath(config, args.name);
        const source = await fs.readFile(filePath, 'utf-8');
        const syntax = checkPluginSyntax(source);
        const parsed = parseMetadataDeep(source);
        return {
          name: args.name,
          syntaxOk: syntax.ok,
          syntaxError: syntax.error,
          metadata: parsed,
        };
      }),
  );
}

/* ============================ helpers ============================ */

async function setStatus(config: Config, name: string, status: boolean): Promise<unknown> {
  const entries = await loadPluginsJs(config);
  const e = entries.find((x) => x.name === name);
  if (!e) throw mzError('file_not_found', `Plugin "${name}" não está registrado.`);
  e.status = status;
  await savePluginsJs(config, entries);
  return { ok: true, name, status };
}
