/**
 * /claude-burrow:status — Display sync status and storage usage.
 *
 * Shows:
 * - Device identity and configuration
 * - Storage backend connectivity
 * - Cloud session count and storage usage
 * - Local session count and unsynchronized sessions
 *
 * Usage:
 *   node scripts/status.js
 */

const config = require('./lib/config');
const storage = require('./lib/storage');
const indexManager = require('./lib/index-manager');
const session = require('./lib/session');

async function main() {
  // ---- Config status ----
  const cfg = await config.getEffectiveConfig();
  if (!cfg) {
    console.log('ClaudeBurrow is not configured.');
    console.log('Run /claude-burrow:setup, or create a .env file (see .env.example).');
    process.exit(0);
  }

  console.log('ClaudeBurrow Status');
  console.log('='.repeat(45));
  console.log(`  Device:      ${cfg.deviceName}`);
  // userId removed — bucket itself is the namespace
  console.log(`  Storage:     ${cfg.storage.type.toUpperCase()} (${cfg.storage.bucket})`);
  console.log(`  Endpoint:    ${cfg.storage.endpoint}`);

  // ---- Connection test ----
  const client = storage.createClient(cfg.storage);
  let connected = false;
  try {
    const testResult = await storage.testConnection(cfg.storage);
    connected = testResult.ok;
  } catch (_) {
    // ignore
  }
  console.log(`  Connection:  ${connected ? '✓ Connected' : '✗ Not reachable'}`);

  // ---- Cloud stats ----
  console.log('');
  console.log('Cloud');
  console.log('-'.repeat(45));

  let cloudStats = { totalBytes: 0, sessionCount: 0 };
  if (connected) {
    try {
      cloudStats = await indexManager.getStorageUsage(client, cfg.storage.bucket);
      console.log(`  Sessions:     ${cloudStats.sessionCount}`);
      console.log(`  Storage used: ${session.formatBytes(cloudStats.totalBytes)}`);
    } catch (err) {
      console.log(`  (Unable to fetch cloud stats: ${err.message})`);
    }
  } else {
    console.log('  (Connect to view cloud stats)');
  }

  // ---- Local stats ----
  console.log('');
  console.log('Local');
  console.log('-'.repeat(45));

  const cwd = process.cwd();
  const localSessions = config.listLocalSessions(cwd);
  console.log(`  Project:      ${cwd}`);
  console.log(`  Sessions:     ${localSessions.length}`);

  if (localSessions.length > 0) {
    console.log('');
    console.log('  Recent sessions:');
    for (const s of localSessions.slice(0, 5)) {
      const size = require('fs').statSync(s.transcriptPath).size;
      const date = s.mtime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      console.log(`    ${s.sessionId.slice(0, 12)}...  ${session.formatBytes(size)}  ${date}`);
    }
  }

  console.log('');
  console.log('Commands:');
  console.log('  /claude-burrow:push   Push a session to cloud');
  console.log('  /claude-burrow:pull   Pull sessions from cloud');
}

main().catch(err => {
  console.error('✗ Status check failed:', err.message);
  process.exit(1);
});
