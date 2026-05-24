/**
 * WebSocket bridge entre mz-mcp e MzMcpCompanion.js.
 *
 * mz-mcp roda um WebSocket SERVER em localhost:port. Quando o companion no jogo
 * inicia, ele conecta como cliente. Após handshake (token), comandos JSON-RPC
 * podem ser enviados em qualquer direção.
 */

import { WebSocket, WebSocketServer } from 'ws';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import type { Config } from '../config.js';
import { dashboardEmitter } from '../dashboard/events.js';
import { logger } from '../utils/logger.js';
import { mzError } from '../utils/errors.js';

const DEFAULT_PORT = 39872;
const PORT_RANGE = 10; // tenta 39872..39881 se primeira opção ocupada
const PORT_FILE_NAME = '.mz-mcp/companion.port';

export interface PushEvent {
  name: string;
  data: Record<string, unknown>;
  t: number;
}

export class CompanionBridge {
  private wss: WebSocketServer | null = null;
  private companion: WebSocket | null = null;
  private companionInfo: { gameTitle?: string; protocolVersion?: string; companionVersion?: string } = {};
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private nextId = 1;
  private token: string;
  private port: number;
  private started = false;
  /** Buffer circular de eventos push do companion (últimos 200). */
  private eventBuffer: PushEvent[] = [];
  private readonly maxBufferSize = 200;
  /** Listeners pra waitForEvent. */
  private eventListeners: Array<{ predicate: (e: PushEvent) => boolean; resolve: (e: PushEvent) => void }> = [];

  constructor(private config: Config) {
    this.port = config.runtime.companionPort > 0 ? config.runtime.companionPort : DEFAULT_PORT;
    this.token = this.loadOrCreateToken();
  }

  private loadOrCreateToken(): string {
    const tokenFile = path.resolve(this.config.project.path, this.config.runtime.tokenFile);
    try {
      const existing = fsSync.readFileSync(tokenFile, 'utf-8').trim();
      if (existing.length >= 16) return existing;
    } catch {
      // Não existe — cria novo
    }
    const token = crypto.randomBytes(32).toString('hex');
    try {
      fsSync.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fsSync.writeFileSync(tokenFile, token, 'utf-8');
      logger.info(`Token de companion criado em ${tokenFile}`);
    } catch (err) {
      logger.warn(`Não consegui salvar token em ${tokenFile}: ${(err as Error).message}`);
    }
    return token;
  }

  getToken(): string {
    return this.token;
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Inicia o servidor WS. Tenta múltiplas portas (this.port, port+1, ..., port+PORT_RANGE-1)
   * caso a primeira esteja ocupada. Escreve a porta REAL escolhida em
   * <project>/.mz-mcp/companion.port — o companion plugin lê esse arquivo
   * pra saber em qual porta conectar. Permite múltiplas instâncias do MCP
   * coexistirem (cada uma na sua porta).
   */
  async start(): Promise<void> {
    if (this.started) return;
    const basePort = this.port;
    for (let attempt = 0; attempt < PORT_RANGE; attempt++) {
      const tryPort = basePort + attempt;
      try {
        await this.tryBindPort(tryPort);
        // Sucesso!
        this.port = tryPort;
        this.started = true;
        this.writePortFile(tryPort);
        if (attempt > 0) {
          logger.info(
            `Porta ${basePort} ocupada — bridge usando ${tryPort} (tentativa ${attempt + 1}/${PORT_RANGE})`,
          );
        }
        logger.info(`Companion bridge listening on 127.0.0.1:${tryPort}`);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EADDRINUSE') {
          logger.debug(`Porta ${tryPort} ocupada, tentando próxima...`);
          continue;
        }
        // Outro tipo de erro — propaga
        throw err;
      }
    }
    throw mzError(
      'companion_not_connected',
      `Nenhuma porta livre no range ${basePort}-${basePort + PORT_RANGE - 1}. ` +
        `Feche outras instâncias do MCP ou configure runtime.companionPort com base diferente.`,
    );
  }

  private async tryBindPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: '127.0.0.1', port });
      const onError = (err: Error) => {
        wss.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        wss.off('error', onError);
        this.wss = wss;
        this.wss.on('connection', (ws) => this.handleConnection(ws));
        this.wss.on('error', (err) => logger.warn(`WS server runtime error: ${err.message}`));
        resolve();
      };
      wss.once('error', onError);
      wss.once('listening', onListening);
    });
  }

  private writePortFile(port: number): void {
    try {
      const portFile = path.resolve(this.config.project.path, PORT_FILE_NAME);
      fsSync.mkdirSync(path.dirname(portFile), { recursive: true });
      fsSync.writeFileSync(portFile, String(port), 'utf-8');
    } catch (err) {
      logger.warn(`Não consegui salvar porta em ${PORT_FILE_NAME}: ${(err as Error).message}`);
    }
  }

  stop(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('bridge stopped'));
    }
    this.pending.clear();
    if (this.companion) this.companion.close();
    this.wss?.close();
    this.started = false;
    // Remove port file pra evitar companion conectar em porta morta
    try {
      const portFile = path.resolve(this.config.project.path, PORT_FILE_NAME);
      fsSync.unlinkSync(portFile);
    } catch {}
  }

  isConnected(): boolean {
    return !!this.companion && this.companion.readyState === WebSocket.OPEN;
  }

  getInfo(): {
    connected: boolean;
    port: number;
    companion: { gameTitle?: string; protocolVersion?: string; companionVersion?: string };
  } {
    return { connected: this.isConnected(), port: this.port, companion: this.companionInfo };
  }

  /** Envia uma chamada JSON-RPC e aguarda a resposta. Timeout default 10s. */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    if (!this.isConnected()) {
      throw mzError(
        'companion_not_connected',
        `Companion não conectado. Inicie Playtest do MZ com MzMcpCompanion.js instalado.`,
      );
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`runtime call '${method}' timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as never, reject, timer });
      this.companion!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private handleConnection(ws: WebSocket): void {
    logger.info('Companion conexão recebida — aguardando handshake');
    let authed = false;

    ws.on('message', (data) => {
      let msg: { jsonrpc?: string; id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(data.toString('utf-8'));
      } catch {
        ws.close();
        return;
      }
      if (!authed) {
        if (msg.method === 'hello' && msg.params && msg.params.token === this.token) {
          authed = true;
          this.companion = ws;
          this.companionInfo = {
            gameTitle: msg.params.gameTitle as string,
            protocolVersion: msg.params.protocolVersion as string,
            companionVersion: msg.params.companionVersion as string,
          };
          logger.info(`Companion autenticado: ${JSON.stringify(this.companionInfo)}`);
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'helloAck', params: { ok: true } }));
          // Notifica dashboard
          dashboardEmitter.emit('companion_connected', {
            type: 'companion_connected',
            info: this.companionInfo,
            timestamp: Date.now(),
          });
        } else {
          logger.warn('Handshake falhou — token inválido ou método errado');
          ws.close();
        }
        return;
      }

      // Pós-handshake: respostas a chamadas pendentes
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
        return;
      }
      // Push event (sem id, method=event)
      if (msg.method === 'event' && msg.params) {
        const ev: PushEvent = {
          name: (msg.params.name as string) ?? '',
          data: (msg.params.data as Record<string, unknown>) ?? {},
          t: (msg.params.t as number) ?? Date.now(),
        };
        this.eventBuffer.push(ev);
        if (this.eventBuffer.length > this.maxBufferSize) {
          this.eventBuffer.splice(0, this.eventBuffer.length - this.maxBufferSize);
        }
        // Notifica listeners de waitForEvent
        const remaining: typeof this.eventListeners = [];
        for (const l of this.eventListeners) {
          if (l.predicate(ev)) l.resolve(ev);
          else remaining.push(l);
        }
        this.eventListeners = remaining;
        // Propaga pro dashboard
        dashboardEmitter.emit('push_event', {
          type: 'push_event',
          name: ev.name,
          data: ev.data,
          timestamp: ev.t,
        });
      }
    });

    ws.on('close', () => {
      logger.info('Companion desconectado');
      if (this.companion === ws) {
        this.companion = null;
        this.companionInfo = {};
        dashboardEmitter.emit('companion_disconnected', {
          type: 'companion_disconnected',
          timestamp: Date.now(),
        });
      }
    });

    ws.on('error', (err) => logger.warn(`Companion ws error: ${err.message}`));
  }

  /** Drena o buffer (retorna todos os eventos pendentes e limpa). */
  drainEvents(filterName?: string): PushEvent[] {
    if (!filterName) {
      const all = this.eventBuffer.slice();
      this.eventBuffer = [];
      return all;
    }
    const kept: PushEvent[] = [];
    const matched: PushEvent[] = [];
    for (const ev of this.eventBuffer) {
      if (ev.name === filterName) matched.push(ev);
      else kept.push(ev);
    }
    this.eventBuffer = kept;
    return matched;
  }

  /** Aguarda próximo evento com nome especificado (ou predicate custom). Timeout opcional. */
  waitForEvent(eventName: string, timeoutMs = 30_000): Promise<PushEvent> {
    // Check buffer primeiro
    const existing = this.drainEvents(eventName);
    if (existing.length > 0) return Promise.resolve(existing[0]!);

    return new Promise((resolve, reject) => {
      const entry = { predicate: (e: PushEvent) => e.name === eventName, resolve };
      this.eventListeners.push(entry);
      setTimeout(() => {
        const i = this.eventListeners.indexOf(entry);
        if (i >= 0) {
          this.eventListeners.splice(i, 1);
          reject(new Error(`timeout aguardando evento "${eventName}" (${timeoutMs}ms)`));
        }
      }, timeoutMs);
    });
  }
}

/** Singleton — uma bridge por instância de mz-mcp. */
let _bridge: CompanionBridge | null = null;

export function getBridge(config: Config): CompanionBridge {
  if (!_bridge) {
    _bridge = new CompanionBridge(config);
  }
  return _bridge;
}

void fs;
