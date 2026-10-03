import { defineConfig } from 'wxt';

export const FIREFOX_EXTENSION_PAGES_CSP = "script-src 'self'; object-src 'self';";

export default defineConfig({
  srcDir: 'src',
  // The e2e build gets broad host access so Playwright can drive it without permission prompts.
  outDir: process.env.BRIEFME_E2E ? 'dist-e2e' : 'dist',
  manifestVersion: 3,
  hooks: {
    // The runtime-registered content script makes WXT add its match pattern as a host
    // permission. Pages are reached through activeTab and optional host permissions instead.
    'build:manifestGenerated': (wxt, manifest) => {
      delete manifest.host_permissions;
      if (process.env.BRIEFME_E2E) {
        manifest.host_permissions = ['<all_urls>'];
        manifest.permissions?.push('tabs');
      }
      if (wxt.config.browser === 'safari') {
        // Safari has no side panel API.
        delete manifest.side_panel;
        manifest.permissions = manifest.permissions?.filter((p) => p !== 'sidePanel');
      }
    },
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'storage', 'contextMenus'],
    optional_permissions: ['tabs'],
    optional_host_permissions: ['*://*/*'],
    action: { default_title: '__MSG_actionTitle__' },
    commands: {
      summarize: {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdSummarize__',
      },
    },
    ...(browser === 'firefox'
      ? {
          // Firefox's default MV3 policy adds `upgrade-insecure-requests`, which rewrites the
          // extension's http requests to https. That breaks plain-http servers on a LAN or VPN
          // (localhost is exempt). Listing the policy without it keeps http requests as http.
          content_security_policy: { extension_pages: FIREFOX_EXTENSION_PAGES_CSP },
          browser_specific_settings: {
            gecko: {
              id: 'briefme@briefme.invalid',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
  zip: {
    name: 'briefme',
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
    excludeSources: [
      'dist/**',
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      '.idea/**',
      '.git/**',
      'safari/**',
    ],
  },
});
