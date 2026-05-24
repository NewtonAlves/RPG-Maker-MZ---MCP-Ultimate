// Smoke test: inicializa o mz-mcp via stdio, lista as tools e chama uma.
// Útil pra validação manual da Fase 1 antes de configurar um cliente real.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const env = {
  ...process.env,
  MZ_PROJECT_PATH:
    process.env.MZ_PROJECT_PATH ??
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\RPG Maker MZ\\newdata',
  MZ_MCP_LOG_LEVEL: 'warn',
};

const server = spawn('node', ['dist/index.js'], {
  cwd: projectRoot,
  env,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();

server.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf-8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch {
      // Não-JSON (logs perdidos no stdout) — ignora
    }
  }
});

let idCounter = 0;
function rpc(method, params) {
  const id = ++idCounter;
  const req = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(JSON.stringify(req) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for response to ${method}`));
      }
    }, 10_000);
  });
}

function notify(method, params) {
  const note = { jsonrpc: '2.0', method, params };
  server.stdin.write(JSON.stringify(note) + '\n');
}

async function main() {
  console.log('[smoke] Initializing MCP session...');
  const initResp = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mz-mcp-smoke', version: '0.1.0' },
  });
  console.log('[smoke] Server:', initResp.result?.serverInfo);

  notify('notifications/initialized', {});

  console.log('[smoke] Listing tools...');
  const list = await rpc('tools/list', {});
  const tools = list.result?.tools ?? [];
  console.log(`[smoke] ${tools.length} tools registered:`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description?.slice(0, 80)}...`);
  }

  console.log('\n[smoke] Calling mz_install_detect_path...');
  const detectResp = await rpc('tools/call', {
    name: 'mz_install_detect_path',
    arguments: {},
  });
  console.log('[smoke] Result:', detectResp.result?.content?.[0]?.text);

  console.log('\n[smoke] Calling project_get_info...');
  const infoResp = await rpc('tools/call', {
    name: 'project_get_info',
    arguments: {},
  });
  console.log('[smoke] Result:', infoResp.result?.content?.[0]?.text);

  console.log('\n[smoke] ALL CHECKS PASSED ✓');
  server.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err);
  server.kill();
  process.exit(1);
});
