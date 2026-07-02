/**
 * /claude-burrow:pull — Browse and download cloud sessions.
 *
 * Flow:
 * 1. Fetch and decrypt the index from R2
 * 2. Display session list (sorted by date)
 * 3. User selects a session (by number or search keyword)
 * 4. Download and decrypt the selected session
 * 5. Write to local ~/.claude/projects/<project>/<session-id>.jsonl
 *
 * Usage:
 *   node scripts/pull.js --passphrase <pw> [--keyword <search>] [--select <index>] [--project-path <path>]
 *
 * When run without --select, lists sessions and expects CC to handle the
 * interactive selection UI. When --select is provided (after CC collects
 * user choice), downloads that specific session.
 */

const config = require('./lib/config');
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
    console.log('  Usage: /claude-burrow:pull (will prompt for password)');
    process.exit(1);
  }

  const client = storage.createClient(cfg.storage);

  // ---- Fetch index ----
  console.log('Fetching cloud sessions...');

  let cloudSessions;
  try {
    const result = await indexManager.listCloudSessions({
      client,
      bucket: cfg.storage.bucket,
      passphrase,
      saltBase64: cfg.crypto.salt,
      keyword: args.keyword || null,
    });
    cloudSessions = result.sessions;
  } catch (err) {
    if (err.message && err.message.includes('Decryption failed')) {
      console.log('\n✗ Wrong passphrase. The password must match the one used during setup.');
      console.log('  If you forgot your password, cloud data cannot be recovered.');
    } else if (err.code === 'NoSuchKey') {
      console.log('\nNo cloud sessions found. Push a session first with /claude-burrow:push');
    } else {
      console.log(`\n✗ Failed to fetch sessions: ${err.message}`);
    }
    process.exit(1);
  }

  if (cloudSessions.length === 0) {
    const msg = args.keyword
      ? `No sessions matching "${args.keyword}".`
      : 'No cloud sessions yet.';
    console.log(`\n${msg}`);
    console.log('Push your first session with /claude-burrow:push');
    process.exit(0);
  }

  // ---- Display or select ----
  const selectIndex = args.select ? parseInt(args.select, 10) : null;

  if (selectIndex !== null && !isNaN(selectIndex)) {
    // ---- Download mode: user selected a session ----
    if (selectIndex < 1 || selectIndex > cloudSessions.length) {
      console.log(`✗ Invalid selection: ${selectIndex}. Choose 1-${cloudSessions.length}.`);
      process.exit(1);
    }

    const selected = cloudSessions[selectIndex - 1];
    console.log(`\nDownloading: "${selected.title}"...`);

    try {
      const result = await indexManager.pullSession({
        client,
        bucket: cfg.storage.bucket,
        passphrase,
        saltBase64: cfg.crypto.salt,
        sessionId: selected.sessionId,
      });

      // ---- Write to local session directory ----
      const projectPath = args.projectPath || process.cwd();
      const projectDir = config.getProjectSessionDir(projectPath);
      const fs = require('fs');
      const path = require('path');

      if (!fs.existsSync(projectDir)) {
        fs.mkdirSync(projectDir, { recursive: true });
      }

      const localPath = path.join(projectDir, `${selected.sessionId}.jsonl`);
      const alreadyExists = fs.existsSync(localPath);

      fs.writeFileSync(localPath, result.content, 'utf-8');

      const action = alreadyExists ? 'Overwritten' : 'Downloaded';
      console.log(`✓ ${action}: ${localPath}`);
      console.log(`  Session: "${selected.title}"`);
      console.log(`  Messages: ${selected.messageCount || 'unknown'}`);
      if (alreadyExists) {
        console.log('  (Local copy was overwritten with cloud version)');
      }
      console.log('');
      console.log(`Resume with:  claude --resume ${selected.sessionId}`);
      console.log(`  (run this from the project directory: ${projectPath})`);
    } catch (err) {
      console.log(`\n✗ Download failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    // ---- List mode: display sessions for CC to present to user ----
    console.log(`\nCloud sessions (${cloudSessions.length} total):\n`);

    cloudSessions.forEach((s, i) => {
      const num = String(i + 1).padStart(3, ' ');
      const title = s.title || '(untitled)';
      const device = s.deviceName || 'unknown';
      const date = formatRelativeDate(new Date(s.updatedAt));
      const status = s.status === 'active' ? '●' : '○';

      console.log(`  ${num}. ${status} ${title}`);
      console.log(`       ${device}  ·  ${date}  ·  ${s.messageCount || '?'} messages`);
    });

    console.log('');
    console.log('To download a session, run:');
    console.log('  /claude-burrow:pull and select the number');
    console.log('');
    console.log('Or filter by keyword:');
    console.log('  /claude-burrow:pull <keyword>');
  }
}

/**
 * Format a date relative to now, e.g. "today 10:30", "yesterday", "3 days ago".
 */
function formatRelativeDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const timeStr = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  if (diffDays === 0) return `today ${timeStr}`;
  if (diffDays === 1) return `yesterday ${timeStr}`;
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  console.error('\n✗ Pull failed:', err.message);
  process.exit(1);
});
