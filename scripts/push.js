/**
 * /claude-burrow:push — Encrypt and upload current session.
 *
 * Flow:
 * 1. Read config and session file
 * 2. Extract title from first user message
 * 3. Derive key from passphrase
 * 4. Encrypt and upload session → R2
 * 5. Update index with optimistic locking
 *
 * Usage:
 *   node scripts/push.js --passphrase <pw> [--session-id <id>]
 *
 * If --session-id is omitted, the most recent session in the current
 * project directory is used.
 */

const config = require('./lib/config');
const crypto = require('./lib/crypto');
const storage = require('./lib/storage');
const indexManager = require('./lib/index-manager');
const session = require('./lib/session');

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // ---- Validate setup ----
  const cfg = await config.getEffectiveConfig();
  if (!cfg) {
    console.log('✗ ClaudeBurrow is not configured.');
    console.log('  Run /claude-burrow:setup, or create a .env file (see .env.example).');
    process.exit(1);
  }

  const passphrase = args.passphrase;
  if (!passphrase) {
    console.log('✗ Passphrase is required.');
    console.log('  Usage: /claude-burrow:push (will prompt for password)');
    process.exit(1);
  }

  // ---- Find the session to push ----
  const cwd = process.cwd();
  let sessionId = args.sessionId;
  let transcriptPath;

  if (sessionId) {
    // User specified a session ID — find its file
    const projectDir = config.getProjectSessionDir(cwd);
    const { join } = require('path');
    transcriptPath = join(projectDir, `${sessionId}.jsonl`);
    const fs = require('fs');
    if (!fs.existsSync(transcriptPath)) {
      console.log(`✗ Session not found: ${sessionId}`);
      console.log(`  Looked in: ${transcriptPath}`);
      process.exit(1);
    }
  } else {
    // Auto-detect most recent session
    const detected = config.detectCurrentSession(cwd);
    if (!detected) {
      console.log('✗ No local sessions found in this project.');
      console.log('  Start a Claude Code session first, then push it.');
      process.exit(1);
    }
    sessionId = detected.sessionId;
    transcriptPath = detected.transcriptPath;
  }

  // ---- Read and parse session ----
  console.log(`Reading session: ${sessionId}...`);
  let sessionContent, meta;
  try {
    sessionContent = require('fs').readFileSync(transcriptPath, 'utf-8');
    const parsed = session.parseSessionFile(transcriptPath);
    meta = {
      title: parsed.title || `${sessionId.slice(0, 8)}...`,
      messageCount: parsed.messageCount,
      projectPath: parsed.projectPath || cwd,
      deviceName: cfg.deviceName,
    };
  } catch (err) {
    console.log(`✗ Failed to read session file: ${err.message}`);
    process.exit(1);
  }

  console.log(`  Title: ${meta.title}`);
  console.log(`  Messages: ${meta.messageCount}`);

  // ---- Upload ----
  console.log('Encrypting and uploading...');

  const client = storage.createClient(cfg.storage);

  try {
    const result = await indexManager.pushSession({
      client,
      bucket: cfg.storage.bucket,
      passphrase,
      saltBase64: cfg.crypto.salt,
      sessionId,
      sessionContent,
      meta,
    });

    console.log('');
    console.log(`✓ Synced: "${meta.title}" (${sessionId})`);
    console.log(`  Device: ${cfg.deviceName}`);
  } catch (err) {
    if (err.message && err.message.includes('Decryption failed')) {
      console.log('\n✗ Wrong passphrase. Please try again.');
    } else {
      console.log(`\n✗ Upload failed: ${err.message}`);
    }
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        args[camelCase(key)] = value;
      } else {
        const key = arg.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        args[camelCase(key)] = value;
      }
    }
  }
  return args;
}

function camelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

main().catch(err => {
  console.error('\n✗ Push failed:', err.message);
  process.exit(1);
});
