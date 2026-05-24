import { describe, it, expect } from 'vitest';

import { helpUrl } from '../../src/utils/help-link.js';

describe('helpUrl', () => {
  it('retorna undefined sem installPath', () => {
    expect(helpUrl(undefined, 'actor')).toBeUndefined();
    expect(helpUrl('auto', 'actor')).toBeUndefined();
  });

  it('gera file:// URL pra topic conhecido', () => {
    const url = helpUrl('C:/Program Files (x86)/Steam/steamapps/common/RPG Maker MZ', 'actor');
    expect(url).toContain('file:///');
    expect(url).toContain('help-en');
    expect(url).toContain('01_08_01.html');
  });

  it('respeita lang param', () => {
    const url = helpUrl('C:/foo', 'actor', 'ja');
    expect(url).toContain('help-ja');
  });

  it('normaliza backslashes pra forward slashes', () => {
    const url = helpUrl('C:\\Foo\\Bar', 'actor');
    expect(url).not.toContain('\\');
  });
});
