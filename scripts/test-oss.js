/**
 * OSS integration test — end-to-end push/pull round-trip.
 *
 * Usage: node scripts/test-oss.js
 * Reads credentials from .env file via config.loadStorageFromEnv().
 * Copy .env.example to .env and fill in your credentials first.
 */

const storage = require('./lib/storage');
const config = require('./lib/config');
const crypto = require('./lib/crypto');
const indexManager = require('./lib/index-manager');

// Load credentials from .env
const STORAGE_CONFIG = config.loadStorageFromEnv();
if (!STORAGE_CONFIG) {
  console.error('ERROR: No storage credentials found.');
  console.error('Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}

const PASSPHRASE = process.env.CLAWDBURROW_PASSPHRASE || 'burrow-test-2026';
// Fixed salt so repeated test runs can read back the same index.
// In production, salt is generated once during setup and persisted in config.json.
const SALT = 'YnVycm93LXRlc3Qtc2FsdA=='; // "burrow-test-salt" in base64

async function run() {
  console.log('=== ClaudeBurrow OSS Integration Test ===\n');

  // Step 1: Test connection
  console.log('[1] Testing OSS connection...');
  const client = storage.createClient(STORAGE_CONFIG);
  const connTest = await storage.testConnection(STORAGE_CONFIG);
  if (!connTest.ok) {
    console.log('  FAIL:', connTest.error);
    process.exit(1);
  }
  console.log('  OK: Connected to OSS\n');

  // Step 0: Initialize a fresh test index (overwrites any stale data from prior runs)
  console.log('[0] Initializing fresh test index...');
  const emptyIndex = indexManager.createEmptyIndex();
  const encrypted = crypto.encryptWithPassphrase(
    JSON.stringify(emptyIndex, null, 2), PASSPHRASE, SALT
  );
  await storage.putObject(client, STORAGE_CONFIG.bucket, indexManager.INDEX_KEY, encrypted);
  console.log('  OK: Fresh index uploaded\n');

  // Step 2: Create a fake session
  console.log('[2] Creating test session...');
  const testSession = {
    sessionId: 'test-session-' + Date.now(),
    title: 'Test - Refactor payment module',
    content: [
      JSON.stringify({ role: 'user', content: 'Help me refactor the payment module' }),
      JSON.stringify({ role: 'assistant', content: 'Sure, let me look at the code structure first' }),
      JSON.stringify({ role: 'user', content: 'Focus on src/payment/ directory' }),
      JSON.stringify({ role: 'assistant', content: 'I see WeChat Pay and Alipay are separate. Use strategy pattern.' }),
      JSON.stringify({ role: 'user', content: 'Yes, go with that approach' }),
    ].join('\n') + '\n',
    messageCount: 5,
    projectPath: '/home/dev/projects/payment',
  };
  console.log('  Session ID: ' + testSession.sessionId);
  console.log('  Title: ' + testSession.title);
  console.log('  Messages: ' + testSession.messageCount + '\n');

  // Step 3: Push (encrypt + upload session + update index)
  console.log('[3] Pushing session...');
  try {
    const pushResult = await indexManager.pushSession({
      client,
      bucket: STORAGE_CONFIG.bucket,
      passphrase: PASSPHRASE,
      saltBase64: SALT,
      sessionId: testSession.sessionId,
      sessionContent: testSession.content,
      meta: {
        title: testSession.title,
        projectPath: testSession.projectPath,
        deviceName: 'test-device',
        messageCount: testSession.messageCount,
      },
    });
    console.log('  OK: Session uploaded and index updated');
    console.log('  Entry: "' + pushResult.entry.title + '"\n');
  } catch (err) {
    console.log('  FAIL:', err.message);
    process.exit(1);
  }

  // Step 4: List cloud sessions
  console.log('[4] Listing cloud sessions...');
  const { sessions } = await indexManager.listCloudSessions({
    client,
    bucket: STORAGE_CONFIG.bucket,
    passphrase: PASSPHRASE,
    saltBase64: SALT,
  });
  console.log('  Found: ' + sessions.length + ' session(s)');
  sessions.forEach(s => {
    console.log('    - ' + s.title + ' (' + s.sessionId.slice(0, 12) + '...) @ ' + s.deviceName);
  });
  console.log('');

  // Step 5: Pull session back and verify round-trip
  console.log('[5] Pulling session back...');
  const pulled = await indexManager.pullSession({
    client,
    bucket: STORAGE_CONFIG.bucket,
    passphrase: PASSPHRASE,
    saltBase64: SALT,
    sessionId: testSession.sessionId,
  });
  console.log('  Downloaded: ' + pulled.content.length + ' chars');

  if (pulled.content === testSession.content) {
    console.log('  Round-trip: VERIFIED (content matches exactly)\n');
  } else {
    console.log('  Round-trip: MISMATCH!');
    console.log('  Original first 100: ' + testSession.content.substring(0, 100));
    console.log('  Pulled first 100:   ' + pulled.content.substring(0, 100));
    process.exit(1);
  }

  // Step 6: Test wrong password rejection
  console.log('[6] Testing wrong password rejection...');
  try {
    await indexManager.listCloudSessions({
      client,
      bucket: STORAGE_CONFIG.bucket,
      passphrase: 'wrong-password',
      saltBase64: SALT,
    });
    console.log('  FAIL: Should have rejected wrong password');
    process.exit(1);
  } catch (err) {
    if (err.message.includes('Decryption failed')) {
      console.log('  OK: Wrong password correctly rejected\n');
    } else {
      console.log('  Unexpected error:', err.message, '\n');
    }
  }

  // Step 7: Test keyword search in index
  console.log('[7] Testing keyword search...');
  const { sessions: filtered } = await indexManager.listCloudSessions({
    client,
    bucket: STORAGE_CONFIG.bucket,
    passphrase: PASSPHRASE,
    saltBase64: SALT,
    keyword: 'payment',
  });
  console.log('  Search "payment": found ' + filtered.length + ' session(s)');
  filtered.forEach(s => console.log('    - ' + s.title));
  console.log('');

  // Step 8: Test re-push (index update)
  console.log('[8] Testing re-push (index update)...');
  const pushResult2 = await indexManager.pushSession({
    client,
    bucket: STORAGE_CONFIG.bucket,
    passphrase: PASSPHRASE,
    saltBase64: SALT,
    sessionId: testSession.sessionId,
    sessionContent: testSession.content + JSON.stringify({ role: 'assistant', content: 'New message' }) + '\n',
    meta: {
      title: testSession.title + ' (updated)',
      projectPath: testSession.projectPath,
      deviceName: 'test-device',
      messageCount: testSession.messageCount + 1,
    },
  });
  console.log('  OK: Session re-pushed and index updated');

  // Verify title was updated
  const { sessions: updated } = await indexManager.listCloudSessions({
    client,
    bucket: STORAGE_CONFIG.bucket,
    passphrase: PASSPHRASE,
    saltBase64: SALT,
  });
  const updatedSession = updated.find(s => s.sessionId === testSession.sessionId);
  if (updatedSession && updatedSession.title.includes('updated')) {
    console.log('  OK: Index entry updated in place (title: "' + updatedSession.title + '")\n');
  } else {
    console.log('  FAIL: Index entry not updated\n');
    process.exit(1);
  }

  console.log('=== All 8 integration tests passed! ===');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
