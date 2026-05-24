/**
 * Tools de gestão do projeto MZ (project_*).
 *
 * Fase 1 implementa:
 *   - project_get_info
 *
 * Pendentes (fases posteriores):
 *   - project_init (scaffold de projeto novo a partir de newdata/)
 *   - project_lock_check
 *   - project_backup_create
 *   - project_restore_from_backup
 *   - project_undo_last_change
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import type { Config } from '../../config.js';
import { createSnapshot, listSnapshots, pruneSnapshots } from '../../core/backup.js';
import { detectEditorLock } from '../../core/lock-detect.js';
import { getProjectInfo } from '../../core/project.js';
import { MzMcpError, mzError } from '../../utils/errors.js';
import { mcpReturn } from '../database/index.js';

export function registerProjectTools(server: McpServer, config: Config): void {
  server.registerTool(
    'project_get_info',
    {
      description:
        'Retorna informação básica sobre o projeto MZ configurado: caminho, ' +
        'arquivos de dados presentes, número de mapas, número de plugins, ' +
        'versionId do System, título do jogo, status de lock do editor.',
      inputSchema: z.object({}).shape,
    },
    async () => {
      try {
        const info = await getProjectInfo(config.project.path);
        const lockStatus = await detectEditorLock();
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ...info,
                  editorLockStatus: lockStatus,
                  config: {
                    autoBackup: config.project.autoBackup,
                    backupRetention: config.project.backupRetention,
                    editorOnLock: config.editor.onLock,
                    runtimeEvalJsEnabled: config.runtime.enableEvalJs,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof MzMcpError) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(err.toJSON(), null, 2),
              },
            ],
          };
        }
        throw err;
      }
    },
  );

  /* -------------------- project_lock_check -------------------- */
  server.registerTool(
    'project_lock_check',
    {
      description: 'Retorna se o editor RPG Maker MZ está aberto (process running).',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const status = await detectEditorLock();
        return { status, editorOpen: status === 'locked' };
      }),
  );

  /* -------------------- project_backup_create -------------------- */
  server.registerTool(
    'project_backup_create',
    {
      description: 'Cria snapshot manual do projeto (data/ + js/plugins/ + config).',
      inputSchema: z.object({
        label: z.string().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const snap = await createSnapshot(
          config.project.path,
          config.project.backupDir,
          args.label ?? 'manual',
        );
        await pruneSnapshots(
          config.project.path,
          config.project.backupDir,
          config.project.backupRetention,
        );
        return snap;
      }),
  );

  /* -------------------- project_list_backups -------------------- */
  server.registerTool(
    'project_list_backups',
    {
      description: 'Lista snapshots existentes (mais recentes primeiro).',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const snaps = await listSnapshots(config.project.path, config.project.backupDir);
        return { count: snaps.length, snapshots: snaps };
      }),
  );

  /* -------------------- project_restore_from_backup -------------------- */
  server.registerTool(
    'project_restore_from_backup',
    {
      description:
        'Restaura projeto a partir de um snapshot. CRÍTICO: sobrescreve data/, js/plugins/ e plugins.js. ' +
        'Cria snapshot atual antes de restaurar (pra você poder desfazer).',
      inputSchema: z.object({
        snapshotId: z.string().min(1),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        const snaps = await listSnapshots(config.project.path, config.project.backupDir);
        const snap = snaps.find((s) => s.id === args.snapshotId);
        if (!snap) throw mzError('file_not_found', `Snapshot "${args.snapshotId}" não encontrado.`);
        // Cria snapshot pré-restore
        await createSnapshot(
          config.project.path,
          config.project.backupDir,
          'pre-restore',
        );
        // Copia conteúdo
        const targets = ['data', 'js/plugins', 'js/plugins.js', 'mz-mcp.config.json'];
        let restored = 0;
        for (const t of targets) {
          const src = path.join(snap.path, t);
          const dst = path.join(config.project.path, t);
          try {
            const stat = await fs.stat(src);
            if (stat.isDirectory()) {
              // Remove dst e copia src
              await fs.rm(dst, { recursive: true, force: true });
              await copyDir(src, dst);
              restored++;
            } else if (stat.isFile()) {
              await fs.mkdir(path.dirname(dst), { recursive: true });
              await fs.copyFile(src, dst);
              restored++;
            }
          } catch {
            // snapshot pode não ter esse target
          }
        }
        return { restored: true, snapshotId: args.snapshotId, targetsRestored: restored };
      }),
  );

  /* -------------------- project_undo_last_change -------------------- */
  server.registerTool(
    'project_undo_last_change',
    {
      description:
        'Restaura o último snapshot (que normalmente foi criado antes da última operação destrutiva). ' +
        'Atalho pra project_restore_from_backup com o mais recente.',
      inputSchema: z.object({}).shape,
    },
    async () =>
      mcpReturn(async () => {
        const snaps = await listSnapshots(config.project.path, config.project.backupDir);
        if (snaps.length === 0) {
          throw mzError('file_not_found', 'Nenhum snapshot existente — nada pra desfazer.');
        }
        const latest = snaps[0]!;
        await createSnapshot(config.project.path, config.project.backupDir, 'pre-undo');
        const targets = ['data', 'js/plugins', 'js/plugins.js', 'mz-mcp.config.json'];
        let restored = 0;
        for (const t of targets) {
          const src = path.join(latest.path, t);
          const dst = path.join(config.project.path, t);
          try {
            const stat = await fs.stat(src);
            if (stat.isDirectory()) {
              await fs.rm(dst, { recursive: true, force: true });
              await copyDir(src, dst);
              restored++;
            } else if (stat.isFile()) {
              await fs.mkdir(path.dirname(dst), { recursive: true });
              await fs.copyFile(src, dst);
              restored++;
            }
          } catch {}
        }
        return { undone: true, snapshotId: latest.id, targetsRestored: restored };
      }),
  );

  /* -------------------- project_init -------------------- */
  server.registerTool(
    'project_init',
    {
      description:
        'Scaffolds um projeto MZ novo. Variantes:\n' +
        '  - "newdata": template BASE — projeto vazio mínimo (Harold actor, 1 mapa, 0 plugins).\n' +
        '  - "newdata-1": Tutorial — base + 5 maps tutorial + custom Items/CommonEvents + System_diff.\n' +
        '  - "newdata-2": Sample completo — base + 189 maps de exemplo (jogo demo). Pesado!\n' +
        '  - "newdata-3": Multi-língua — base + System_diff + folders lang/ pra localização.\n' +
        'newdata-1/2/3 são OVERLAYS — primeiro copia newdata (base), depois merge em cima. ' +
        'ATENÇÃO: vai escrever no projectPath — só use em pasta vazia.',
      inputSchema: z.object({
        template: z
          .enum(['newdata', 'newdata-1', 'newdata-2', 'newdata-3'])
          .default('newdata'),
        gameTitle: z.string().optional(),
      }).shape,
    },
    async (args) =>
      mcpReturn(async () => {
        if (!config.mz.installPath || config.mz.installPath === 'auto') {
          throw mzError('mz_install_not_found', 'MZ install path não configurada.');
        }
        const existing = await fs.readdir(config.project.path).catch(() => []);
        const non = existing.filter((e) => e !== 'mz-mcp.config.json' && e !== '.mz-mcp');
        if (non.length > 0) {
          throw mzError(
            'project_invalid',
            `projectPath não está vazio (${non.length} itens). project_init só pode rodar em pasta vazia.`,
          );
        }
        // Copia newdata base primeiro
        const baseSrc = path.join(config.mz.installPath, 'newdata');
        await copyDir(baseSrc, config.project.path);

        // Se variant != newdata, faz overlay
        if (args.template !== 'newdata') {
          const overlaySrc = path.join(config.mz.installPath, args.template);
          await copyDir(overlaySrc, config.project.path);
          // System_diff.json é mesclado em cima do System.json
          const diffPath = path.join(config.project.path, 'data', 'System_diff.json');
          try {
            const diffRaw = await fs.readFile(diffPath, 'utf-8');
            const diff = JSON.parse(diffRaw);
            const sysPath = path.join(config.project.path, 'data', 'System.json');
            const sys = JSON.parse(await fs.readFile(sysPath, 'utf-8'));
            const merged = { ...sys, ...diff };
            merged.versionId = (sys.versionId ?? 0) + 1;
            await fs.writeFile(sysPath, JSON.stringify(merged));
            await fs.unlink(diffPath).catch(() => {});
          } catch {}
        }

        // Opcional: ajusta gameTitle
        if (args.gameTitle) {
          const sysPath = path.join(config.project.path, 'data', 'System.json');
          const sys = JSON.parse(await fs.readFile(sysPath, 'utf-8'));
          sys.gameTitle = args.gameTitle;
          await fs.writeFile(sysPath, JSON.stringify(sys));
        }
        return {
          initialized: true,
          template: args.template,
          variantNotes: {
            'newdata': 'Empty base project (1 map, 0 plugins)',
            'newdata-1': 'Tutorial project (5 maps + tutorial events)',
            'newdata-2': 'Sample game (189 maps — heavy)',
            'newdata-3': 'Multi-language template (lang/ folder)',
          }[args.template],
          projectPath: config.project.path,
          gameTitle: args.gameTitle,
        };
      }),
  );
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}
