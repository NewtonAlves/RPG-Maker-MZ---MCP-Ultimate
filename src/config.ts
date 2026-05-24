/**
 * Config do mz-mcp.
 *
 * Carrega de:
 *   1. Variáveis de ambiente (MZ_PROJECT_PATH, MZ_INSTALL_PATH, MZ_MCP_CONFIG)
 *   2. Arquivo mz-mcp.config.json (no projeto MZ ou caminho via MZ_MCP_CONFIG)
 *   3. Defaults
 *
 * Variáveis de ambiente sobrescrevem o arquivo de config quando ambos definidos.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

import { detectMzInstallPath } from './core/mz-install.js';
import { logger } from './utils/logger.js';

/* ------------------------------------------------------------------ */
/* Schema de config                                                    */
/* ------------------------------------------------------------------ */

const ConfigSchema = z.object({
  project: z.object({
    path: z.string().min(1, 'project.path é obrigatório'),
    autoBackup: z.boolean().default(true),
    backupRetention: z.number().int().positive().default(20),
    backupDir: z.string().default('.mz-mcp/backups'),
  }),
  editor: z.object({
    onLock: z.enum(['warn', 'block', 'ignore']).default('warn'),
  }),
  mz: z.object({
    installPath: z.string().default('auto'),
    corescriptVersion: z.string().default('v1.6.0'),
  }),
  runtime: z.object({
    enableEvalJs: z.boolean().default(false),
    companionPort: z.number().int().nonnegative().default(0),
    tokenFile: z.string().default('.mz-mcp/companion.token'),
  }),
  plugins: z.object({
    defaultNamingConvention: z.enum(['snake', 'visustella']).default('snake'),
    knownBases: z.record(z.string()).default({}),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    file: z.string().optional(),
  }),
  dashboard: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().nonnegative().default(39873),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Forma do arquivo mz-mcp.config.json (todos os campos opcionais até a validação). */
type PartialConfigFile = {
  project?: Partial<{
    path: string;
    autoBackup: boolean;
    backupRetention: number;
    backupDir: string;
  }>;
  editor?: Partial<{
    onLock: 'warn' | 'block' | 'ignore';
  }>;
  mz?: Partial<{
    installPath: string;
    corescriptVersion: string;
  }>;
  runtime?: Partial<{
    enableEvalJs: boolean;
    companionPort: number;
    tokenFile: string;
  }>;
  plugins?: Partial<{
    defaultNamingConvention: 'snake' | 'visustella';
    knownBases: Record<string, string>;
  }>;
  logging?: Partial<{
    level: 'debug' | 'info' | 'warn' | 'error';
    file: string;
  }>;
  dashboard?: Partial<{
    enabled: boolean;
    port: number;
  }>;
};

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

/**
 * Carrega config do disco e env. Retorna Config validada.
 *
 * - Lê env MZ_PROJECT_PATH (obrigatória — sem ela, o servidor falha cedo)
 * - Lê env MZ_INSTALL_PATH (opcional — auto-detecta se 'auto' ou não dada)
 * - Lê arquivo mz-mcp.config.json (opcional)
 * - Combina e valida via Zod
 */
export async function loadConfig(): Promise<Config> {
  const envProjectPath = process.env.MZ_PROJECT_PATH;
  const envInstallPath = process.env.MZ_INSTALL_PATH;
  const envConfigPath = process.env.MZ_MCP_CONFIG;

  if (!envProjectPath) {
    throw new Error(
      'MZ_PROJECT_PATH não definido. Defina a variável de ambiente apontando ' +
        'pra pasta raiz do seu projeto RPG Maker MZ.',
    );
  }

  const projectPath = path.resolve(envProjectPath);
  await ensureDirExists(projectPath, 'project.path');

  // Caminho do config file: env > <project>/mz-mcp.config.json
  const configPath = envConfigPath
    ? path.resolve(envConfigPath)
    : path.join(projectPath, 'mz-mcp.config.json');

  const fileConfig = await readConfigFileOrEmpty(configPath);

  // Resolve install path: env > arquivo > auto
  let installPath = envInstallPath ?? fileConfig.mz?.installPath ?? 'auto';
  if (installPath === 'auto') {
    const detected = await detectMzInstallPath();
    installPath = detected ?? 'auto';
    if (detected) {
      logger.info(`MZ install detectada em: ${detected}`);
    } else {
      logger.warn(
        'Instalação do RPG Maker MZ não detectada. Tools de generator/samplemaps/dlc/help vão falhar.',
      );
    }
  }

  // Monta a config crua (env tem precedência sobre arquivo)
  const rawConfig = {
    project: {
      path: projectPath,
      autoBackup: fileConfig.project?.autoBackup ?? true,
      backupRetention: fileConfig.project?.backupRetention ?? 20,
      backupDir: fileConfig.project?.backupDir ?? '.mz-mcp/backups',
    },
    editor: {
      onLock: fileConfig.editor?.onLock ?? 'warn',
    },
    mz: {
      installPath,
      corescriptVersion: fileConfig.mz?.corescriptVersion ?? 'v1.6.0',
    },
    runtime: {
      enableEvalJs: fileConfig.runtime?.enableEvalJs ?? false,
      companionPort: fileConfig.runtime?.companionPort ?? 0,
      tokenFile: fileConfig.runtime?.tokenFile ?? '.mz-mcp/companion.token',
    },
    plugins: {
      defaultNamingConvention: fileConfig.plugins?.defaultNamingConvention ?? 'snake',
      knownBases: fileConfig.plugins?.knownBases ?? {},
    },
    logging: {
      level: fileConfig.logging?.level ?? 'info',
      file: fileConfig.logging?.file,
    },
    dashboard: {
      enabled: fileConfig.dashboard?.enabled ?? true,
      port: fileConfig.dashboard?.port ?? 39873,
    },
  };

  // Valida e retorna
  return ConfigSchema.parse(rawConfig);
}

/* ------------------------------------------------------------------ */
/* Helpers internos                                                    */
/* ------------------------------------------------------------------ */

async function ensureDirExists(p: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) {
      throw new Error(`${label} aponta pra "${p}" mas isso não é uma pasta.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} aponta pra "${p}" mas a pasta não existe.`);
    }
    throw err;
  }
}

async function readConfigFileOrEmpty(configPath: string): Promise<PartialConfigFile> {
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug(`Sem arquivo de config em ${configPath} — usando defaults.`);
      return {} as PartialConfigFile;
    }
    if (err instanceof SyntaxError) {
      throw new Error(`Arquivo de config em ${configPath} tem JSON inválido: ${err.message}`);
    }
    throw err;
  }
}
