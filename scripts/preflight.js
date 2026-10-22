const fs = require('node:fs');
const path = require('node:path');

const failures = [];
const warnings = [];
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) failures.push(`Node.js 20+ is required; found ${process.versions.node}.`);
const dataSetting = process.env.SITEPIX_DATA_DIR || './data';
const dataDir = path.isAbsolute(dataSetting) ? dataSetting : path.resolve(process.cwd(), dataSetting);
try {
  fs.mkdirSync(dataDir, { recursive: true });
  const probe = path.join(dataDir, `.sitepix-preflight-${process.pid}`);
  fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 });
  fs.unlinkSync(probe);
} catch (error) {
  failures.push(`Data directory is not writable (${dataDir}): ${error.message}`);
}
if (process.env.NODE_ENV === 'production') {
  if (!process.env.SITEPIX_BETA_INVITE_CODE) failures.push('SITEPIX_BETA_INVITE_CODE must be set in production.');
  const baseUrl = process.env.SITEPIX_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';
  if (!/^https:\/\//i.test(baseUrl)) failures.push('SITEPIX_BASE_URL or Render RENDER_EXTERNAL_URL must be set to the deployed HTTPS base URL.');
  if (process.env.SITEPIX_DATA_DIR && !path.isAbsolute(process.env.SITEPIX_DATA_DIR)) warnings.push('Use an absolute path for SITEPIX_DATA_DIR in deployment.');
  if (process.env.SITEPIX_DATA_DIR === '/app/data') warnings.push('Sandbox data directory is ephemeral; test accounts, records, and uploads may be lost after spin-down, restart, or redeploy.');
} else {
  warnings.push('Non-production mode: invite-only registration is active only when SITEPIX_BETA_INVITE_CODE is configured.');
}
if (!process.env.OPENAI_API_KEY) warnings.push('OpenAI is not configured; AI-assisted drafting and voice responses will be unavailable.');
if (!process.env.STRIPE_SECRET_KEY) warnings.push('Stripe is not configured; subscription checkout is unavailable.');
if (!process.env.TWILIO_AUTH_TOKEN) warnings.push('Twilio is not configured; real phone workflows are unavailable.');
if (!process.env.GOOGLE_MAPS_API_KEY) warnings.push('Routing API is not configured; travel calculations require contractor-entered distance/time.');
if (!process.env.DATABASE_URL) warnings.push('No PostgreSQL runtime adapter is implemented in this release; runtime data remains JSON-backed.');
if (!process.env.S3_BUCKET) warnings.push('Private cloud object storage is not configured; media remains on the app data filesystem.');
for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);
if (failures.length) process.exit(1);
console.log(`PASS  Trades Secretary preflight passed for ${process.env.NODE_ENV || 'development'} mode.`);
