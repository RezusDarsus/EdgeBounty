import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const path = 'apps/api/.env';
let env = fs.readFileSync(path, 'utf8');
const values = { SANDBOX: 'docker', DOCKER_USE_SUDO: '1', VERIFICATION_EXECUTOR: 'worker', AI_PROVIDER: 'nvidia', SEMANTIC_DUPLICATES: 'on' };
for (const [key, value] of Object.entries(values)) {
 const re = new RegExp(`^${key}=.*\\r?$`, 'm');
 env = re.test(env) ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
}
fs.writeFileSync(path, env, { mode: 0o600 });
execFileSync('pm2', ['restart', 'api-usdc'], { stdio: 'inherit' });
try { execFileSync('pm2', ['describe', 'verification-usdc'], { stdio: 'ignore' });
 execFileSync('pm2', ['restart', 'verification-usdc'], { stdio: 'inherit' });
} catch {
 execFileSync('pm2', ['start', 'node_modules/tsx/dist/cli.mjs', '--name', 'verification-usdc', '--kill-timeout', '10000', '--', 'apps/api/src/worker.ts'], { stdio: 'inherit' });
}
execFileSync('pm2', ['save'], { stdio: 'inherit' });
