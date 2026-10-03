import { execSync } from 'node:child_process';

/** Build the extension with broad host access for the e2e run. */
export default function globalSetup() {
  execSync('npx wxt build', {
    stdio: 'inherit',
    env: { ...process.env, BRIEFME_E2E: '1' },
  });
}
