/**
 * Cleanup script — removes test data from OSS.
 * Keeps the index but removes all test-session-* entries.
 *
 * Usage: node scripts/cleanup-oss.js
 */

const storage = require('./lib/storage');
const config = require('./lib/config');
const crypto = require('./lib/crypto');
const indexManager = require('./lib/index-manager');
const { S3Client, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

async function main() {
  const STORAGE_CONFIG = config.loadStorageFromEnv();
  if (!STORAGE_CONFIG) {
    console.error('ERROR: No storage credentials found in .env');
    process.exit(1);
  }

  const client = storage.createClient(STORAGE_CONFIG);
  const bucket = STORAGE_CONFIG.bucket;

  console.log('=== Cleaning up OSS test data ===\n');

  // 1. List ALL objects in the bucket
  console.log('[1] Scanning bucket...');
  const allObjects = await listAllObjects(client, bucket);
  console.log(`  Found ${allObjects.length} objects:\n`);

  const toDelete = [];

  for (const obj of allObjects) {
    const isTest = obj.key.includes('test-session-');
    const isOldPath = obj.key.includes('/a341d596-') || obj.key.includes('/test-17');
    const isOrphanIndex = obj.key.includes('/index.json.enc') && obj.key !== indexManager.INDEX_KEY;

    const flag = isTest ? ' [TEST]' : isOldPath ? ' [OLD-PATH]' : isOrphanIndex ? ' [ORPHAN-INDEX]' : '';
    console.log(`  ${flag ? '✗' : '✓'} ${obj.key} (${formatBytes(obj.size)})${flag}`);

    if (isTest || isOldPath || isOrphanIndex) {
      toDelete.push(obj.key);
    }
  }

  if (toDelete.length === 0) {
    console.log('\n  Nothing to clean up.');
    process.exit(0);
  }

  console.log(`\n[2] Deleting ${toDelete.length} test/legacy objects...`);
  for (const key of toDelete) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`  Deleted: ${key}`);
  }

  // 3. Also clean up the index: remove any test-session entries, re-upload
  console.log('\n[3] Cleaning index entries...');
  const PASSPHRASE = process.env.CLAWDBURROW_PASSPHRASE || 'burrow-test-2026';

  // Use the persisted salt from config, or the test salt as fallback
  const cfg = config.getEffectiveConfig();
  const salt = cfg ? cfg.crypto.salt : 'YnVycm93LXRlc3Qtc2FsdA==';

  try {
    const { index, etag } = await indexManager.fetchIndex(client, bucket, PASSPHRASE, salt);
    const before = index.sessions.length;
    index.sessions = index.sessions.filter(s => !s.title.includes('Test - ') && !s.sessionId.startsWith('test-session-'));
    const removed = before - index.sessions.length;
    console.log(`  Removed ${removed} test entries from index (${before} → ${index.sessions.length})`);

    if (removed > 0) {
      await indexManager.uploadIndex(client, bucket, index, PASSPHRASE, salt, etag);
      console.log('  Index re-uploaded');
    }
  } catch (err) {
    console.log(`  Skipped index cleanup: ${err.message}`);
  }

  console.log('\n=== Cleanup complete ===');
}

async function listAllObjects(client, bucket) {
  const all = [];
  let continuationToken = undefined;
  do {
    const resp = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    if (resp.Contents) {
      all.push(...resp.Contents.map(o => ({ key: o.Key, size: o.Size })));
    }
    continuationToken = resp.NextContinuationToken;
  } while (continuationToken);
  return all;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
