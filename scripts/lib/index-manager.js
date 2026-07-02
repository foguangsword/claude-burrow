/**
 * Index file manager for ClaudeBurrow.
 *
 * The index is a lightweight JSON file stored at:
 *   index/index.json.enc
 *
 * It contains metadata for all synced sessions (title, timestamp, project, device).
 * This enables fast session listing without scanning the entire bucket.
 *
 * There is NO per-user subdirectory — the bucket itself is the tenant boundary.
 * Each user has their own private bucket (their own credentials), so adding
 * a userId layer inside the bucket is redundant and hurts cross-device UX.
 *
 * The index is encrypted with the user's passphrase (same as session files).
 *
 * Concurrency: Uses ETag-based optimistic locking to handle rare cases where
 * two devices push at nearly the same time. On conflict, re-reads, merges,
 * and retries up to MAX_RETRIES times.
 */

const storage = require('./storage');
const crypto = require('./crypto');

const INDEX_KEY = 'index/index.json.enc';
const SALT_KEY = 'salt.dat';        // Plaintext salt — uploaded unencrypted
const SESSION_PREFIX = 'sessions/';
const MAX_RETRIES = 3;

// ---- Key helpers ----

function sessionKey(sessionId) {
  return `${SESSION_PREFIX}${sessionId}.enc`;
}

// ---- Salt management (salt.dat, uploaded as plaintext) ----

/**
 * Try to download salt.dat from the cloud bucket.
 * Salt is NOT secret — it only prevents rainbow-table attacks.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @returns {Promise<string|null>} base64 salt string, or null if not found
 */
async function fetchSalt(client, bucket) {
  try {
    const result = await storage.getObject(client, bucket, SALT_KEY);
    return result.body.toString('utf-8').trim();
  } catch (err) {
    if (err.code === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Upload salt.dat to the cloud bucket as plaintext.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} salt - base64 salt string
 */
async function uploadSalt(client, bucket, salt) {
  await storage.putObject(client, bucket, SALT_KEY, Buffer.from(salt, 'utf-8'), {
    contentType: 'text/plain',
  });
}

// ---- Index read/write ----

/**
 * Fetch and decrypt the index from remote storage.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} passphrase
 * @param {string} saltBase64
 * @returns {Promise<{ index: Object, etag: string }>}
 */
async function fetchIndex(client, bucket, passphrase, saltBase64) {
  try {
    const result = await storage.getObject(client, bucket, INDEX_KEY);
    const decrypted = crypto.decryptWithPassphrase(result.body, passphrase, saltBase64);
    const index = JSON.parse(decrypted);
    return { index, etag: result.etag };
  } catch (err) {
    if (err.code === 'NoSuchKey') {
      return { index: createEmptyIndex(), etag: null };
    }
    // Stale index from a different passphrase/salt, or corrupted data.
    // Overwrite with a fresh one — old orphaned sessions stay in the bucket
    // but are harmless; they'll be cleaned up by a future prune command.
    if (err.message && err.message.includes('Decryption failed')) {
      return { index: createEmptyIndex(), etag: null };
    }
    throw err;
  }
}

/**
 * Encrypt and upload the index to remote storage.
 * Uses optimistic locking if an ETag is provided.
 */
async function uploadIndex(client, bucket, index, passphrase, saltBase64, expectedEtag) {
  const plaintext = JSON.stringify(index, null, 2);
  const encrypted = crypto.encryptWithPassphrase(plaintext, passphrase, saltBase64);

  if (expectedEtag) {
    return storage.putObjectIfMatch(client, bucket, INDEX_KEY, encrypted, expectedEtag);
  } else {
    return storage.putObject(client, bucket, INDEX_KEY, encrypted);
  }
}

// ---- Index manipulation ----

function createEmptyIndex() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions: [],
  };
}

/**
 * Add or update a session entry in the index.
 */
function upsertSession(index, entry) {
  const now = new Date().toISOString();
  const existing = index.sessions.find(s => s.sessionId === entry.sessionId);

  if (existing) {
    Object.assign(existing, entry, { updatedAt: now });
  } else {
    index.sessions.push({
      sessionId: entry.sessionId,
      title: entry.title || '(untitled)',
      projectPath: entry.projectPath || '',
      deviceName: entry.deviceName || 'unknown',
      createdAt: entry.createdAt || now,
      updatedAt: now,
      messageCount: entry.messageCount || 0,
      status: entry.status || 'active',
    });
  }

  index.updatedAt = now;
  index.sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function searchSessions(index, keyword) {
  const lower = keyword.toLowerCase();
  return index.sessions.filter(s =>
    s.title.toLowerCase().includes(lower) ||
    s.projectPath.toLowerCase().includes(lower)
  );
}

// ---- High-level sync operations ----

/**
 * Push a session: encrypt + upload session file, then update index.
 */
async function pushSession({ client, bucket, passphrase, saltBase64, sessionId, sessionContent, meta }) {
  const encrypted = crypto.encryptWithPassphrase(sessionContent, passphrase, saltBase64);
  const sKey = sessionKey(sessionId);
  await storage.putObject(client, bucket, sKey, encrypted);

  let retries = 0;
  while (retries <= MAX_RETRIES) {
    const { index, etag } = await fetchIndex(client, bucket, passphrase, saltBase64);

    upsertSession(index, {
      sessionId,
      title: meta.title || '(untitled)',
      projectPath: meta.projectPath || '',
      deviceName: meta.deviceName || 'unknown',
      messageCount: meta.messageCount || 0,
      status: 'active',
    });

    try {
      await uploadIndex(client, bucket, index, passphrase, saltBase64, etag);
      return { uploaded: true, entry: index.sessions.find(s => s.sessionId === sessionId) };
    } catch (err) {
      if (err.code === 'PreconditionFailed' && retries < MAX_RETRIES) {
        retries++;
        await sleep(100 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Failed to update index after maximum retries');
}

/**
 * Pull a specific session: download, decrypt, return content + metadata.
 */
async function pullSession({ client, bucket, passphrase, saltBase64, sessionId }) {
  const sKey = sessionKey(sessionId);
  const result = await storage.getObject(client, bucket, sKey);
  const decrypted = crypto.decryptWithPassphrase(result.body, passphrase, saltBase64);

  let meta = null;
  try {
    const { index } = await fetchIndex(client, bucket, passphrase, saltBase64);
    meta = index.sessions.find(s => s.sessionId === sessionId) || null;
  } catch (_) {
    // Best-effort metadata lookup
  }

  return { content: decrypted, meta };
}

/**
 * List cloud sessions from the index.
 */
async function listCloudSessions({ client, bucket, passphrase, saltBase64, keyword }) {
  const { index, etag } = await fetchIndex(client, bucket, passphrase, saltBase64);
  let sessions = keyword ? searchSessions(index, keyword) : index.sessions;
  return { sessions, indexEtag: etag };
}

/**
 * Get total storage usage from the bucket.
 */
async function getStorageUsage(client, bucket) {
  const objects = await storage.listObjects(client, bucket, SESSION_PREFIX);
  const totalBytes = objects.reduce((sum, obj) => sum + obj.size, 0);
  return { totalBytes, sessionCount: objects.length };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  INDEX_KEY,
  SALT_KEY,
  SESSION_PREFIX,
  sessionKey,
  fetchSalt,
  uploadSalt,
  fetchIndex,
  uploadIndex,
  createEmptyIndex,
  upsertSession,
  searchSessions,
  pushSession,
  pullSession,
  listCloudSessions,
  getStorageUsage,
};
