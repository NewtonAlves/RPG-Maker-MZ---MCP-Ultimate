/**
 * Logger simples para mz-mcp.
 *
 * IMPORTANTE: como mz-mcp é um servidor MCP no modo stdio, stdout é reservado
 * pro protocolo JSON-RPC. TODO log vai pra stderr. Nunca console.log no código.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.MZ_MCP_LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function format(level: LogLevel, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] ${msg}`;
}

function write(level: LogLevel, msg: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  // Sempre stderr — stdout é do protocolo MCP
  const out = args.length > 0 ? `${msg} ${args.map(safeStringify).join(' ')}` : msg;
  process.stderr.write(format(level, out) + '\n');
}

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },
  debug(msg: string, ...args: unknown[]): void {
    write('debug', msg, ...args);
  },
  info(msg: string, ...args: unknown[]): void {
    write('info', msg, ...args);
  },
  warn(msg: string, ...args: unknown[]): void {
    write('warn', msg, ...args);
  },
  error(msg: string, ...args: unknown[]): void {
    write('error', msg, ...args);
  },
};
