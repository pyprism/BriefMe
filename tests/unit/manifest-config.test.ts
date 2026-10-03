import { describe, expect, it } from 'vitest';
import config, { FIREFOX_EXTENSION_PAGES_CSP } from '../../wxt.config';

type ManifestFn = (env: { browser: string }) => Record<string, unknown>;
const manifestFor = (browser: string) => (config.manifest as ManifestFn)({ browser });

describe('manifest policy', () => {
  it('does not upgrade the extension http requests in Firefox', () => {
    const csp = (manifestFor('firefox').content_security_policy as { extension_pages: string })
      .extension_pages;
    expect(csp).toBe(FIREFOX_EXTENSION_PAGES_CSP);
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('leaves the browser default policy in Chromium browsers', () => {
    expect(manifestFor('chrome').content_security_policy).toBeUndefined();
  });

  it('declares the permissions the extension needs and no host access up front', () => {
    const m = manifestFor('chrome');
    expect(m.permissions).toEqual(['activeTab', 'scripting', 'storage', 'contextMenus']);
    expect(m.host_permissions).toBeUndefined();
    expect(m.optional_host_permissions).toEqual(['*://*/*']);
  });
});
