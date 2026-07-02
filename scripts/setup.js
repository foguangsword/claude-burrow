/**
 * /claude-burrow:setup — Interactive setup wizard.
 *
 * Guides the user through:
 * 1. Storage connection test
 * 2. Salt setup: download existing from cloud (machine B), or generate + upload new (machine A)
 * 3. Save local config
 *
 * Passphrase is NOT needed during setup — it's only required at push/pull time.
 * Salt is stored as plaintext in the bucket (salt.dat) — salt is not a secret.
 *
 * Usage: node scripts/setup.js --storage-type <type> --endpoint <url> --bucket <name>
 *                              --access-key <key> --secret-key <key>
 *                              [--region <region>] [--device-name <name>]
 */

const path = require('path');
const config = require('./lib/config');
const cryptojs = require('./lib/crypto');
const storage = require('./lib/storage');
const indexManager = require('./lib/index-manager');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const storageType = args.storageType || 'oss';

  console.log('╔══════════════════════════════════════════╗');
  console.log('║       ClaudeBurrow Setup Wizard          ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // ---- Step 1: Validate storage connection ----

  console.log(`[1/3] Testing ${storageType.toUpperCase()} connection...`);

  const defaultRegion = storageType === 'oss' ? 'oss-cn-hangzhou' : 'auto';

  const storageConfig = {
    type: storageType,
    endpoint: args.endpoint,
    bucket: args.bucket,
    accessKeyId: args.accessKey,
    secretAccessKey: args.secretKey,
    region: args.region || defaultRegion,
  };

  const testResult = await storage.testConnection(storageConfig);
  if (!testResult.ok) {
    console.log(`\n✗ Connection failed: ${testResult.error}`);
    console.log('Please check your credentials and try again.');
    process.exit(1);
  }
  console.log('✓ Connected to storage backend\n');

  // ---- Step 2: Set up salt (try cloud first, then generate) ----

  console.log('[2/3] Setting up encryption salt...');

  const client = storage.createClient(storageConfig);
  let salt;

  const cloudSalt = await indexManager.fetchSalt(client, storageConfig.bucket);
  if (cloudSalt) {
    // Machine B (or re-setup): salt already exists in cloud — reuse it
    salt = cloudSalt;
    console.log('✓ Found existing salt in cloud — reusing it');
    console.log('  (This ensures the same encryption key as your other devices)');
  } else {
    // Machine A (first setup): generate new salt and upload
    salt = cryptojs.generateSalt();
    await indexManager.uploadSalt(client, storageConfig.bucket, salt);
    console.log('✓ New salt generated and uploaded to cloud');
  }
  console.log('');

  // ---- Step 3: Save local config ----

  console.log('[3/3] Saving configuration...');

  const deviceName = args.deviceName || require('os').hostname();

  const cfg = config.createDefaultConfig({
    deviceName,
    storage: storageConfig,
    crypto: {
      salt,
      iterations: cryptojs.ITERATIONS,
    },
  });

  config.saveConfig(cfg);
  console.log(`✓ Config saved to ${config.getConfigPath()}\n`);

  // ---- Done ----

  console.log('╔══════════════════════════════════════════╗');
  console.log('║         Setup Complete! 🎉               ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`  Device:    ${deviceName}`);
  console.log(`  Storage:   ${storageConfig.type} (${storageConfig.bucket})\n`);
  console.log('Next steps:');
  console.log('  /claude-burrow:push    Push current session (will ask for passphrase)');
  console.log('  /claude-burrow:pull    Pull sessions from cloud');
  console.log('  /claude-burrow:status  View sync status\n');
  console.log('⚠  Set a strong passphrase you can remember — it cannot be recovered.');
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
  console.error('\n✗ Setup failed:', err.message);
  process.exit(1);
});
