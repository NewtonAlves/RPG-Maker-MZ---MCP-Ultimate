/**
 * Erros tipados do mz-mcp.
 *
 * Cada erro carrega um `code` legível (snake_case) e pode opcionalmente apontar
 * pra uma URL de ajuda local (help-en/ da instalação MZ) via helpTopic.
 */

export type ErrorCode =
  | 'project_not_found'
  | 'project_invalid'
  | 'mz_install_not_found'
  | 'config_invalid'
  | 'editor_locked'
  | 'file_not_found'
  | 'schema_validation_failed'
  | 'asset_format_invalid'
  | 'plugin_invalid'
  | 'companion_not_connected'
  | 'companion_auth_failed'
  | 'tool_not_implemented'
  | 'note_field_protected'
  | 'backup_failed'
  | 'unsupported_operation';

export class MzMcpError extends Error {
  readonly code: ErrorCode;
  readonly helpTopic?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    opts?: { helpTopic?: string; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'MzMcpError';
    this.code = code;
    this.helpTopic = opts?.helpTopic;
    this.details = opts?.details;
  }

  /** Versão serializável pra retornar no protocolo MCP */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      helpTopic: this.helpTopic,
      details: this.details,
    };
  }
}

/** Wrap rápido pra criar erro */
export function mzError(
  code: ErrorCode,
  message: string,
  opts?: { helpTopic?: string; details?: Record<string, unknown> },
): MzMcpError {
  return new MzMcpError(code, message, opts);
}
