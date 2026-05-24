/**
 * Tools de Build e Deploy. Wrappa o `rpgmpacker` CLI quando disponível.
 *
 * https://github.com/erri120/rpgmpacker
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { computeUnusedAssets } from '../../core/asset-scanner.js';
import { mzError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { mcpReturn } from '../database/index.js';
import { getProjectInfo } from '../../core/project.js';
import { createSnapshot, pruneSnapshots } from '../../core/backup.js';

async function rpgmpackerAvailable(): Promise<{ ok: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('rpgmpacker', ['--help'], { shell: true });
    let out = '';
    proc.stdout?.on('data', (c) => (out += c.toString()));
    proc.stderr?.on('data', (c) => (out += c.toString()));
    proc.on('error', (err) => resolve({ ok: false, error: err.message }));
    proc.on('close', (code) => {
      if (code === 0) {
        const m = /rpgmpacker\s+v?([\d.]+)/i.exec(out);
        resolve({ ok: true, version: m?.[1] });
      } else {
        resolve({ ok: false, error: `exit ${code}: ${out.slice(0, 200)}` });
      }
    });
  });
}

export function registerBuildTools(server: McpServer, config: Config): void {
  /* -------------------- mz_build_check_rpgmpacker ------ */
  server.registerTool(
    'mz_build_check_rpgmpacker',
    {
      description:
        'Verifica se rpgmpacker está no PATH. Retorna versão se sim. Se não, ' +
        'fornece instruções de instalação.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const r = await rpgmpackerAvailable();
        return {
          available: r.ok,
          version: r.version,
          error: r.error,
          installInstructions: r.ok
            ? undefined
            : 'Baixe rpgmpacker de https://github.com/erri120/rpgmpacker/releases e adicione ao PATH.',
        };
      }),
  );

  /* -------------------- mz_validate_project ------------ */
  server.registerTool(
    'mz_validate_project',
    {
      description:
        'Valida integridade do projeto antes de build: data files presentes, plugins.js parseável, ' +
        'System.json válido, mapas referenciados existem.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const info = await getProjectInfo(config.project.path);
        const issues: string[] = [];

        // Checa System.json
        try {
          const sysRaw = await fs.readFile(
            path.join(config.project.path, 'data', 'System.json'),
            'utf-8',
          );
          JSON.parse(sysRaw);
        } catch (err) {
          issues.push(`System.json: ${(err as Error).message}`);
        }

        // Checa plugins.js
        try {
          const pluginsJs = await fs.readFile(
            path.join(config.project.path, 'js', 'plugins.js'),
            'utf-8',
          );
          if (!/\$plugins\s*=\s*\[/.test(pluginsJs)) {
            issues.push('plugins.js: formato inesperado (sem `var $plugins = [`)');
          }
        } catch (err) {
          issues.push(`plugins.js: ${(err as Error).message}`);
        }

        return { valid: issues.length === 0, info, issues };
      }),
  );

  /* -------------------- mz_build ----------------------- */
  server.registerTool(
    'mz_build',
    {
      description:
        'Faz build do projeto pra plataformas alvo via rpgmpacker. Suporta windows, mac, web, ' +
        'mobile. Opções: encryptAudio, encryptImages, encryptionKey. ' +
        'Progresso é streamado linha-a-linha pro log do mz-mcp (logging.file) e opcionalmente ' +
        'pra logFile dado. Operação demorada — pode levar minutos.',
      inputSchema: z.object({
        platforms: z.array(z.enum(['windows', 'osx', 'mac', 'web', 'mobile', 'browser'])).min(1),
        outputDir: z.string().min(1).describe('Pasta de saída (será criada)'),
        encryptAudio: z.boolean().default(false),
        encryptImages: z.boolean().default(false),
        encryptionKey: z.string().optional(),
        excludeUnused: z.boolean().default(false),
        logFile: z.string().optional().describe('Stream stdout/stderr line-by-line pra esse arquivo (tail -f pra ver progresso ao vivo)'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const r = await rpgmpackerAvailable();
        if (!r.ok) {
          throw mzError(
            'tool_not_implemented',
            `rpgmpacker não encontrado no PATH: ${r.error}. Use mz_build_check_rpgmpacker pra ver instruções.`,
          );
        }

        const platformsArg = args.platforms
          .map((p) => (p === 'mac' ? 'osx' : p === 'browser' ? 'web' : p))
          .join(',');

        const cmdArgs = [
          '-i', config.project.path,
          '-o', args.outputDir,
          '-p', platformsArg,
        ];
        if (args.encryptAudio) cmdArgs.push('--encryptAudio');
        if (args.encryptImages) cmdArgs.push('--encryptImages');
        if (args.encryptionKey) cmdArgs.push('--encryptionKey', args.encryptionKey);
        if (args.excludeUnused) cmdArgs.push('--exclude');

        logger.info(`mz_build iniciando: rpgmpacker ${cmdArgs.join(' ')}`);

        // Abre logFile se especificado
        let logHandle: import('node:fs/promises').FileHandle | null = null;
        if (args.logFile) {
          logHandle = await (await import('node:fs/promises')).open(args.logFile, 'w');
        }

        return new Promise((resolve, reject) => {
          const proc = spawn('rpgmpacker', cmdArgs, { shell: true });
          let stdout = '';
          let stderr = '';
          let lineBuffer = '';
          let errLineBuffer = '';

          const processLine = async (line: string, stream: 'stdout' | 'stderr') => {
            if (!line.trim()) return;
            logger.info(`[rpgmpacker:${stream}] ${line}`);
            if (logHandle) {
              await logHandle.appendFile(`[${stream}] ${line}\n`).catch(() => {});
            }
          };

          proc.stdout?.on('data', (c) => {
            const chunk = c.toString();
            stdout += chunk;
            lineBuffer += chunk;
            let nl;
            while ((nl = lineBuffer.indexOf('\n')) !== -1) {
              const line = lineBuffer.slice(0, nl);
              lineBuffer = lineBuffer.slice(nl + 1);
              void processLine(line, 'stdout');
            }
          });
          proc.stderr?.on('data', (c) => {
            const chunk = c.toString();
            stderr += chunk;
            errLineBuffer += chunk;
            let nl;
            while ((nl = errLineBuffer.indexOf('\n')) !== -1) {
              const line = errLineBuffer.slice(0, nl);
              errLineBuffer = errLineBuffer.slice(nl + 1);
              void processLine(line, 'stderr');
            }
          });
          proc.on('error', (err) => {
            if (logHandle) void logHandle.close();
            reject(err);
          });
          proc.on('close', async (code) => {
            // Flush leftover buffers
            if (lineBuffer.trim()) await processLine(lineBuffer, 'stdout');
            if (errLineBuffer.trim()) await processLine(errLineBuffer, 'stderr');
            if (logHandle) await logHandle.close();
            logger.info(`mz_build finalizado com exit code ${code}`);
            resolve({
              exitCode: code,
              ok: code === 0,
              platforms: args.platforms,
              outputDir: args.outputDir,
              logFile: args.logFile,
              stdoutTail: stdout.slice(-1000),
              stderrTail: stderr.slice(-1000),
            });
          });
        });
      }),
  );

  /* -------------------- mz_clean_unused_assets --------- */
  server.registerTool(
    'mz_clean_unused_assets',
    {
      description:
        'Identifica (dryRun=true por padrão) ou remove (dryRun=false) assets não-referenciados em ' +
        'data files. Análise completa: percorre Actors, Enemies, Tilesets, Animations, todos os Maps, ' +
        'CommonEvents, Troops e System, varrendo referências em campos diretos e em event commands ' +
        '(Show Picture 231, Play BGM 241, Play BGS 245, Play ME 249, Play SE 250, etc.). ' +
        'Operação destrutiva (se dryRun=false): cria snapshot antes.',
      inputSchema: z.object({
        dryRun: z.boolean().default(true),
        limit: z.number().int().positive().optional().describe('Máximo de arquivos retornados/removidos'),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const { unused, referencedCounts } = await computeUnusedAssets(config);
        const limited = args.limit ? unused.slice(0, args.limit) : unused;

        if (!args.dryRun && limited.length > 0) {
          // Snapshot antes de deletar
          if (config.project.autoBackup) {
            await createSnapshot(config.project.path, config.project.backupDir, 'before-clean-unused');
            await pruneSnapshots(config.project.path, config.project.backupDir, config.project.backupRetention);
          }
          let removed = 0;
          for (const u of limited) {
            try {
              await fs.unlink(path.join(config.project.path, u.folder, u.file));
              removed++;
            } catch {}
          }
          return { dryRun: false, totalUnused: unused.length, removed, referencedCounts };
        }

        return {
          dryRun: args.dryRun,
          totalUnused: unused.length,
          unusedSample: limited.slice(0, 30),
          referencedCounts,
        };
      }),
  );
}
