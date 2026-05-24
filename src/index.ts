#!/usr/bin/env node
/**
 * RPG Maker MZ - MCP
 * Servidor Model Context Protocol que dá controle total sobre projetos do
 * RPG Maker MZ a agentes de IA.
 *
 * Autor: Newton Alves
 * Versão: 1.0.0
 * Produto: RPG Maker MZ - MCP
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import { registerAllTools } from './tools/index.js';
import { DashboardServer, instrumentServer, setDashboardInstance } from './dashboard/server.js';
import { getBridge } from './runtime/bridge.js';

const SERVER_NAME = 'rpg-maker-mz-mcp';
const SERVER_VERSION = '1.0.0';
const PRODUCT_NAME = 'RPG Maker MZ - MCP';
const AUTHOR = 'Newton Alves';

async function main(): Promise<void> {
  // Carrega config (env vars + mz-mcp.config.json se existir)
  const config = await loadConfig();
  logger.info(`${PRODUCT_NAME} v${SERVER_VERSION} (by ${AUTHOR})`);
  logger.info(`Project path: ${config.project.path}`);
  logger.info(`MZ install path: ${config.mz.installPath}`);

  // Cria o servidor MCP
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // Instrumenta o server pra capturar tool calls e propagar pro dashboard
  instrumentServer(server);

  // Registra todas as tools (delega pra src/tools/index.ts)
  await registerAllTools(server, config);

  // Inicia dashboard (HTTP+WS) se habilitado
  if (config.dashboard.enabled) {
    const dashboard = new DashboardServer(config, getBridge(config));
    setDashboardInstance(dashboard);
    await dashboard.start(config.dashboard.port).catch((err) => {
      logger.warn(`Dashboard falhou ao iniciar: ${(err as Error).message}`);
    });
  }

  // Conecta via stdio (modo padrão de transporte pra MCP)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(`${PRODUCT_NAME} ready — listening on stdio`);
}

main().catch((err) => {
  // stderr é o canal correto pra erros num servidor stdio MCP
  // (stdout é reservado pro protocolo JSON-RPC)
  // eslint-disable-next-line no-console
  console.error(`Fatal error during ${PRODUCT_NAME} boot:`, err);
  process.exit(1);
});
