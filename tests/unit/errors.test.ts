import { describe, it, expect } from 'vitest';

import { MzMcpError, mzError } from '../../src/utils/errors.js';

describe('MzMcpError', () => {
  it('mzError() helper cria instância com code+message', () => {
    const e = mzError('file_not_found', 'arquivo não existe');
    expect(e).toBeInstanceOf(MzMcpError);
    expect(e.code).toBe('file_not_found');
    expect(e.message).toBe('arquivo não existe');
  });

  it('toJSON serializa fields esperados', () => {
    const e = mzError('schema_validation_failed', 'msg', {
      helpTopic: 'actor',
      details: { field: 'name' },
    });
    const json = e.toJSON();
    expect(json.code).toBe('schema_validation_failed');
    expect(json.message).toBe('msg');
    expect(json.helpTopic).toBe('actor');
    expect((json.details as { field: string }).field).toBe('name');
  });

  it('preserva stack trace nativo', () => {
    const e = mzError('plugin_invalid', 'bad message');
    expect(e.stack).toBeDefined();
    // Stack inclui o message (não o code; code é campo separado)
    expect(e.stack).toContain('bad message');
    expect(e.code).toBe('plugin_invalid');
  });
});
