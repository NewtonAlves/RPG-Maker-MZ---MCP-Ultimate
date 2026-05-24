/**
 * Servidor HTTP + WebSocket pro dashboard.
 *
 * Serve a UI estática (HTML/CSS/JS) via HTTP + broadcast de eventos via WS.
 * Cliente assina ws://localhost:<port>/ws e recebe push de tool_call_*, companion_*,
 * push_event.
 *
 * REST endpoints:
 *   GET /              → index.html
 *   GET /style.css     → CSS
 *   GET /app.js        → JS cliente
 *   GET /api/status    → JSON com estado atual
 *   GET /api/screenshot → último screenshot cached como image/png
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

import type { Config } from '../config.js';
import type { CompanionBridge } from '../runtime/bridge.js';
import { logger } from '../utils/logger.js';
import { dashboardEmitter, type DashboardEvent } from './events.js';

const DEFAULT_DASHBOARD_PORT = 39873;
const PORT_RANGE = 10;

export class DashboardServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private port = 0;
  private started = false;
  private lastScreenshot: { data: Buffer; mimeType: string; timestamp: number } | null = null;
  private staticDir: string;
  /** Buffer circular de últimos N eventos pra novos clientes verem histórico recente. */
  private eventHistory: DashboardEvent[] = [];
  private readonly maxHistory = 200;

  constructor(
    private config: Config,
    private bridge: CompanionBridge,
  ) {
    // Static dir: tenta dist/dashboard/public (prod) → src/dashboard/public (dev)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(__dirname, 'public'),
      path.resolve(__dirname, '..', '..', 'src', 'dashboard', 'public'),
    ];
    this.staticDir = candidates[0]!;
    for (const c of candidates) {
      try {
        fsSync.accessSync(path.join(c, 'index.html'));
        this.staticDir = c;
        break;
      } catch {}
    }
  }

  async start(basePort = DEFAULT_DASHBOARD_PORT): Promise<void> {
    if (this.started) return;
    for (let attempt = 0; attempt < PORT_RANGE; attempt++) {
      const tryPort = basePort + attempt;
      try {
        await this.tryBind(tryPort);
        this.port = tryPort;
        this.started = true;
        this.writePortFile(tryPort);
        if (attempt > 0) {
          logger.info(`Dashboard port ${basePort} ocupada — usando ${tryPort}`);
        }
        logger.info(`Dashboard listening on http://127.0.0.1:${tryPort}`);
        this.subscribeToEvents();
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
        throw err;
      }
    }
    logger.warn(`Dashboard: nenhuma porta livre no range ${basePort}-${basePort + PORT_RANGE - 1}`);
  }

  private async tryBind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttp(req, res));
      server.once('error', reject);
      server.once('listening', () => {
        this.httpServer = server;
        this.wss = new WebSocketServer({ server, path: '/ws' });
        this.wss.on('connection', (ws) => this.handleWs(ws));
        resolve();
      });
      server.listen(port, '127.0.0.1');
    });
  }

  private writePortFile(port: number): void {
    try {
      const portFile = path.resolve(this.config.project.path, '.mz-mcp', 'dashboard.port');
      fsSync.mkdirSync(path.dirname(portFile), { recursive: true });
      fsSync.writeFileSync(portFile, String(port), 'utf-8');
    } catch {}
  }

  getPort(): number {
    return this.port;
  }

  private subscribeToEvents(): void {
    const types: Array<DashboardEvent['type']> = [
      'tool_call_start',
      'tool_call_end',
      'companion_connected',
      'companion_disconnected',
      'push_event',
    ];
    for (const type of types) {
      dashboardEmitter.on(type, (event: DashboardEvent) => {
        this.recordAndBroadcast(event);
      });
    }
  }

  private recordAndBroadcast(event: DashboardEvent): void {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.splice(0, this.eventHistory.length - this.maxHistory);
    }
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(msg);
        } catch {}
      }
    }
  }

  private handleWs(ws: WebSocket): void {
    this.clients.add(ws);
    logger.debug(`Dashboard client conectado (total: ${this.clients.size})`);
    // Envia histórico recente pro cliente novo
    for (const e of this.eventHistory) {
      try {
        ws.send(JSON.stringify(e));
      } catch {}
    }
    ws.on('close', () => {
      this.clients.delete(ws);
    });
    ws.on('error', () => {});
  }

  private async handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    try {
      if (url === '/' || url === '/index.html') {
        await this.serveStatic('index.html', 'text/html; charset=utf-8', res);
        return;
      }
      if (url === '/style.css') {
        await this.serveStatic('style.css', 'text/css; charset=utf-8', res);
        return;
      }
      if (url === '/app.js') {
        await this.serveStatic('app.js', 'application/javascript; charset=utf-8', res);
        return;
      }
      if (url === '/api/status') {
        // Detecta estado atual do editor (separado da política configurada)
        let editorLockStatus: 'locked' | 'unlocked' | 'unknown' = 'unknown';
        try {
          const { detectEditorLock } = await import('../core/lock-detect.js');
          editorLockStatus = await detectEditorLock();
        } catch {}
        const status = {
          mcpPort: this.port,
          companionPort: this.bridge.getPort(),
          companion: this.bridge.getInfo(),
          projectPath: this.config.project.path,
          autoBackup: this.config.project.autoBackup,
          editorOnLock: this.config.editor.onLock,
          editorLockStatus,
          historySize: this.eventHistory.length,
          activeClients: this.clients.size,
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
        return;
      }
      if (url === '/api/screenshot') {
        if (!this.lastScreenshot) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('No screenshot cached yet');
          return;
        }
        res.writeHead(200, {
          'Content-Type': this.lastScreenshot.mimeType,
          'X-Screenshot-Timestamp': String(this.lastScreenshot.timestamp),
        });
        res.end(this.lastScreenshot.data);
        return;
      }
      if (url === '/api/screenshot/capture' && req.method === 'POST') {
        await this.handleCaptureScreenshot(res);
        return;
      }
      if (url === '/api/events/recent') {
        // Retorna os últimos N eventos do histórico (pra cliente que abre tarde demais)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ events: this.eventHistory.slice(-100) }));
        return;
      }
      if (url?.startsWith('/api/map_render/')) {
        const mapId = parseInt(url.split('/').pop() ?? '0', 10);
        if (mapId > 0) {
          await this.handleRenderMap(mapId, res);
          return;
        }
      }
      if (url === '/api/runtime/snapshot') {
        await this.handleRuntimeSnapshot(res);
        return;
      }
      if (url === '/api/integrity_check') {
        await this.handleIntegrityCheck(res);
        return;
      }
      if (url === '/api/backup/create' && req.method === 'POST') {
        await this.handleBackupCreate(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } catch (err) {
      logger.warn(`Dashboard HTTP error: ${(err as Error).message}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
    }
  }

  private async serveStatic(name: string, mime: string, res: http.ServerResponse): Promise<void> {
    const filePath = path.join(this.staticDir, name);
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  }

  cacheScreenshot(data: Buffer, mimeType: string): void {
    this.lastScreenshot = { data, mimeType, timestamp: Date.now() };
  }

  /**
   * Dispara screenshot ao vivo via bridge. Cacheia resultado e devolve PNG.
   */
  private async handleCaptureScreenshot(res: http.ServerResponse): Promise<void> {
    if (!this.bridge.isConnected()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'companion_not_connected' }));
      return;
    }
    try {
      const result = (await this.bridge.call('screenshot')) as {
        ok: boolean;
        dataUrl?: string;
        error?: string;
        method?: string;
      };
      if (!result.ok || !result.dataUrl) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'screenshot_failed', detail: result.error }));
        return;
      }
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(result.dataUrl);
      const mime = match?.[1] ?? 'image/png';
      const b64 = match?.[2] ?? result.dataUrl;
      const buf = Buffer.from(b64, 'base64');
      this.cacheScreenshot(buf, mime);
      res.writeHead(200, {
        'Content-Type': mime,
        'X-Screenshot-Method': result.method ?? 'unknown',
        'X-Screenshot-Timestamp': String(Date.now()),
      });
      res.end(buf);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'capture_failed', detail: (err as Error).message }));
    }
  }

  /**
   * Renderiza um mapa (via core/map-renderer) e devolve PNG.
   */
  private async handleRenderMap(mapId: number, res: http.ServerResponse): Promise<void> {
    try {
      const { renderMap } = await import('../core/map-renderer.js');
      const buf = await renderMap(this.config, mapId, { scale: 0.5 });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(buf);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'render_failed', detail: (err as Error).message }));
    }
  }

  /**
   * Snapshot ao vivo do estado do jogo (companion). Combina várias queries
   * estruturadas num só payload pra o painel "ao vivo".
   */
  private async handleRuntimeSnapshot(res: http.ServerResponse): Promise<void> {
    if (!this.bridge.isConnected()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ connected: false }));
      return;
    }
    try {
      const [scene, gold, leader, switches] = await Promise.all([
        this.bridge.call('getSceneState').catch((err: Error) => ({ error: err.message })),
        this.bridge.call('inspectPath', { path: '$gameParty._gold' }).catch((err: Error) => ({ error: err.message })),
        this.bridge.call('inspectPath', { path: '$gameParty._actors[0]' }).catch(() => null),
        this.bridge.call('inspectPath', { path: '$gameSwitches._data.length' }).catch(() => null),
      ]);
      let leaderState: unknown = null;
      const leaderInfo = leader as { ok?: boolean; value?: number } | null;
      if (leaderInfo && leaderInfo.ok && typeof leaderInfo.value === 'number') {
        leaderState = await this.bridge.call('getActorState', { actorId: leaderInfo.value }).catch(() => null);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        connected: true,
        scene,
        gold,
        leaderActorId: leaderInfo?.value ?? null,
        leaderState,
        switchesArrayLength: switches,
        timestamp: Date.now(),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'snapshot_failed', detail: (err as Error).message }));
    }
  }

  /**
   * Roda o integrity checker e devolve sumário.
   */
  private async handleIntegrityCheck(res: http.ServerResponse): Promise<void> {
    try {
      const { checkConsistency } = await import('../core/integrity-checker.js');
      const result = await checkConsistency(this.config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'check_failed', detail: (err as Error).message }));
    }
  }

  /**
   * Cria backup snapshot do projeto e retorna localização.
   */
  private async handleBackupCreate(res: http.ServerResponse): Promise<void> {
    try {
      const { createSnapshot } = await import('../core/backup.js');
      const result = await createSnapshot(
        this.config.project.path,
        this.config.project.backupDir,
        'manual-dashboard',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'backup_failed', detail: (err as Error).message }));
    }
  }

  stop(): void {
    this.httpServer?.close();
    this.wss?.close();
    this.clients.clear();
    this.started = false;
  }
}

/** Singleton accessor — setado em index.ts no boot. */
let _dashboardInstance: DashboardServer | null = null;
export function setDashboardInstance(d: DashboardServer): void {
  _dashboardInstance = d;
}
export function getDashboardInstance(): DashboardServer | null {
  return _dashboardInstance;
}

/**
 * Wrappa registerTool do McpServer pra publicar eventos no dashboard.
 * Chama uma vez no startup, depois server.registerTool funciona normal mas com tracking.
 */
export function instrumentServer(server: unknown): void {
  const s = server as { registerTool: (...args: unknown[]) => unknown };
  const original = s.registerTool.bind(s);
  s.registerTool = function (...args: unknown[]) {
    const [name, config, callback] = args as [string, unknown, (a: unknown) => Promise<unknown>];
    const wrapped = async (toolArgs: unknown) => {
      const id = dashboardEmitter.nextCallId();
      const start = Date.now();
      dashboardEmitter.emit('tool_call_start', {
        type: 'tool_call_start',
        id,
        name,
        args: toolArgs,
        timestamp: start,
      });
      try {
        const result = await callback(toolArgs);
        dashboardEmitter.emit('tool_call_end', {
          type: 'tool_call_end',
          id,
          name,
          success: true,
          durationMs: Date.now() - start,
          timestamp: Date.now(),
        });
        return result;
      } catch (err) {
        dashboardEmitter.emit('tool_call_end', {
          type: 'tool_call_end',
          id,
          name,
          success: false,
          durationMs: Date.now() - start,
          error: (err as Error).message,
          timestamp: Date.now(),
        });
        throw err;
      }
    };
    return original(name, config, wrapped);
  };
}
