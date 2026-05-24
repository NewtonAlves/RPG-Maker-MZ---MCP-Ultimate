/**
 * Event emitter central pra eventos do MCP em direção ao dashboard.
 *
 * Tools publicam eventos via `dashboardEmitter.emit('tool_call_start', ...)`.
 * O DashboardServer assina e propaga via WebSocket pros clientes conectados.
 */

import { EventEmitter } from 'node:events';

export interface ToolCallStartEvent {
  type: 'tool_call_start';
  id: number;
  name: string;
  args: unknown;
  timestamp: number;
}

export interface ToolCallEndEvent {
  type: 'tool_call_end';
  id: number;
  name: string;
  success: boolean;
  durationMs: number;
  error?: string;
  timestamp: number;
}

export interface CompanionEvent {
  type: 'companion_connected' | 'companion_disconnected';
  info?: { gameTitle?: string; protocolVersion?: string; companionVersion?: string };
  timestamp: number;
}

export interface PushEventDashboard {
  type: 'push_event';
  name: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type DashboardEvent =
  | ToolCallStartEvent
  | ToolCallEndEvent
  | CompanionEvent
  | PushEventDashboard;

class DashboardEmitter extends EventEmitter {
  private nextId = 1;

  nextCallId(): number {
    return this.nextId++;
  }
}

export const dashboardEmitter = new DashboardEmitter();
dashboardEmitter.setMaxListeners(100);
