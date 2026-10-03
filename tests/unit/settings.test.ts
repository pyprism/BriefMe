import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  parseSiteModels,
  pickModel,
  validateSettings,
} from '../../src/lib/settings-schema';

describe('validateSettings', () => {
  it('fills defaults', () => {
    const { settings } = validateSettings({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('assumes no provider by default', () => {
    expect(DEFAULT_SETTINGS.baseUrl).toBe('');
    expect(DEFAULT_SETTINGS.fallbackBaseUrl).toBe('');
    expect(DEFAULT_SETTINGS.model).toBe('');
    expect(DEFAULT_SETTINGS.fallbackModel).toBe('');
  });

  it('flags an invalid or missing primary URL', () => {
    expect(validateSettings({ baseUrl: 'ftp://nope' }).errors.baseUrl).toBe('invalid-url');
    expect(validateSettings({}).errors.baseUrl).toBe('required');
    expect(validateSettings({ baseUrl: 'ftp://nope' }).settings.baseUrl).toBe('');
  });

  it('only validates the backup URL when the backup is on', () => {
    expect(validateSettings({ baseUrl: 'http://a' }).errors.fallbackBaseUrl).toBeUndefined();
    const on = validateSettings({ baseUrl: 'http://a', fallbackEnabled: true, fallbackModel: 'm' });
    expect(on.errors.fallbackBaseUrl).toBe('required');
    const bad = validateSettings({ fallbackEnabled: true, fallbackBaseUrl: 'ftp://x' });
    expect(bad.errors.fallbackBaseUrl).toBe('invalid-url');
  });

  it('normalizes the URL', () => {
    expect(validateSettings({ baseUrl: '192.168.1.5:11434/' }).settings.baseUrl).toBe(
      'http://192.168.1.5:11434',
    );
  });

  it('clamps numbers and rejects unknown enums', () => {
    const { settings } = validateSettings({
      temperature: 9,
      numCtx: 10,
      theme: 'neon' as never,
      position: 'middle' as never,
    });
    expect(settings.temperature).toBe(2);
    expect(settings.numCtx).toBe(1024);
    expect(settings.theme).toBe('auto');
    expect(settings.position).toBe('top-right');
  });

  it('keeps a custom style only if the prompt exists', () => {
    const prompt = { id: 'x1', name: 'Mine', system: '', template: '' };
    expect(validateSettings({ style: 'custom:x1', customPrompts: [prompt] }).settings.style).toBe(
      'custom:x1',
    );
    expect(validateSettings({ style: 'custom:x1' }).settings.style).toBe(DEFAULT_SETTINGS.style);
  });

  it('requires a backup model when the backup is enabled', () => {
    const on = { baseUrl: 'http://a', fallbackEnabled: true, fallbackBaseUrl: 'http://b' };
    expect(validateSettings(on).errors.fallbackModel).toBe('required');
    expect(validateSettings({ ...on, fallbackModel: 'm' }).errors).toEqual({});
  });

  it('accepts list fields as text', () => {
    expect(validateSettings({ denyList: 'a.com\nb.com' as never }).settings.denyList).toEqual([
      'a.com',
      'b.com',
    ]);
  });
});

describe('timeouts', () => {
  it('defaults to generous limits for slow hardware', () => {
    const { settings } = validateSettings({});
    expect(settings.firstResponseTimeoutSec).toBe(600);
    expect(settings.idleTimeoutSec).toBe(180);
  });
  it('clamps to sane ranges and rounds', () => {
    const low = validateSettings({ firstResponseTimeoutSec: 1, idleTimeoutSec: 0 }).settings;
    expect([low.firstResponseTimeoutSec, low.idleTimeoutSec]).toEqual([10, 10]);
    const high = validateSettings({
      firstResponseTimeoutSec: 99999,
      idleTimeoutSec: 99999,
    }).settings;
    expect([high.firstResponseTimeoutSec, high.idleTimeoutSec]).toEqual([7200, 3600]);
    expect(
      validateSettings({ firstResponseTimeoutSec: 90.6 }).settings.firstResponseTimeoutSec,
    ).toBe(91);
    expect(validateSettings({ idleTimeoutSec: 'x' as never }).settings.idleTimeoutSec).toBe(180);
  });
});

describe('provider types', () => {
  it('uses the same default type for primary and backup', () => {
    const { settings } = validateSettings({});
    expect(settings.primaryType).toBe(settings.fallbackType);
  });
  it('accepts either type for both roles and rejects unknown values', () => {
    const { settings } = validateSettings({ primaryType: 'openai', fallbackType: 'ollama' });
    expect(settings.primaryType).toBe('openai');
    expect(settings.fallbackType).toBe('ollama');
    expect(validateSettings({ primaryType: 'x' as never }).settings.primaryType).toBe(
      DEFAULT_SETTINGS.primaryType,
    );
  });
});

describe('pickModel', () => {
  const base = { ...DEFAULT_SETTINGS, model: 'big', fastModel: 'small', fastBelowChars: 1000 };

  it('uses the default model for long text', () => {
    expect(pickModel(base, 'a.com', 5000)).toBe('big');
  });
  it('uses the fast model for short text', () => {
    expect(pickModel(base, 'a.com', 500)).toBe('small');
  });
  it('prefers a site override', () => {
    const s = { ...base, siteModels: 'a.com=special\n# bad line\nb.org = other' };
    expect(pickModel(s, 'news.a.com', 500)).toBe('special');
    expect(pickModel(s, 'b.org', 5000)).toBe('other');
    expect(pickModel(s, 'c.net', 5000)).toBe('big');
  });
  it('parses site models', () => {
    expect([...parseSiteModels('x.com=m1\nbad\n=m2\ny.com=')]).toEqual([['x.com', 'm1']]);
  });
});
