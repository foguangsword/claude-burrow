/**
 * Configuration management for ClaudeBurrow.
 *
 * Config is stored at: ~/.claude/plugins/data/claude-burrow/config.json
 * (resolved via CLAUDE_PLUGIN_DATA env var, or default path).
 *
 * The config file contains storage credentials (R2 endpoint, keys, bucket),
 * device identity (userId, deviceName), and crypto parameters (salt, iterations).
 *
 * IMPORTANT: The encryption passphrase is NEVER written to this file.
 * It is only held in memory during the current process lifetime.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---- Dotenv loading (development convenience) ----

/**
 * Load .env file from the project root (one level above scripts/).
 * Does nothing if dotenv is not installed or .env doesn't exist.
 *
 * This allows developers to store credentials in a gitignored .env file
 * instead of passing them as CLI args every time. In production (CC plugin),
 * credentials come from config.json written by /claude-burrow:setup.
 */
function loadEnv() {
  try {
    // Find project root: scripts/lib/config.js → ../../ = project root
    const root = path.resolve(__dirname, '..', '..');
    const dotenvPath = path.join(root, '.env');
    if (fs.existsSync(dotenvPath)) {
      require('dotenv').config({ path: dotenvPath });
    }
  } catch (_) {
    // dotenv not installed or .env not found — silently continue
  }
}

// Auto-load on module import
loadEnv();

/**
 * Build a storage config from environment variables (CLAUDEBURROW_* prefix).
 * Returns null if the required env vars are not set.
 *
 * @returns {Object|null} storage config or null
 */
function loadStorageFromEnv() {
  const type = process.env.CLAUDEBURROW_STORAGE_TYPE;
  const endpoint = process.env.CLAUDEBURROW_STORAGE_ENDPOINT;
  const bucket = process.env.CLAUDEBURROW_STORAGE_BUCKET;
  const accessKeyId = process.env.CLAUDEBURROW_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLAUDEBURROW_STORAGE_SECRET_ACCESS_KEY;

  if (!type || !endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    type,
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: process.env.CLAUDEBURROW_STORAGE_REGION || (type === 'r2' ? 'auto' : 'oss-cn-hangzhou'),
  };
}

// ---- Path resolution ----

/**
 * Resolve the ClaudeBurrow data directory.
 * Uses CLAUDE_PLUGIN_DATA if available (set by CC for plugins),
 * otherwise falls back to ~/.claude/plugins/data/claude-burrow
 */
function getDataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) {
    return process.env.CLAUDE_PLUGIN_DATA;
  }
  // Fallback for running outside CC plugin context (e.g. development)
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'claude-burrow');
}

function getConfigPath() {
  return path.join(getDataDir(), 'config.json');
}

// ---- Config schema defaults ----

/**
 * Create a fresh config object with default values.
 * @param {Object} overrides - Values to override defaults
 * @returns {Object} config object
 */
function createDefaultConfig(overrides = {}) {
  return {
    version: 1,
    deviceName: os.hostname(),
    storage: {
      type: 'r2',        // 'r2' | 's3' | 'custom'
      endpoint: '',
      bucket: 'claude-burrow-sync',
      accessKeyId: '',
      secretAccessKey: '',
      region: 'auto',    // R2 uses 'auto'
    },
    crypto: {
      salt: '',           // base64-encoded 16 random bytes
      iterations: 100000,
    },
    ...overrides,
  };
}

// ---- Read / Write ----

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read config at ${configPath}: ${err.message}`);
  }
}

function saveConfig(config) {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configPath = getConfigPath();
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    throw new Error(`Failed to write config to ${configPath}: ${err.message}`);
  }
}

/**
 * Check if ClaudeBurrow has been set up on this machine.
 * @returns {boolean}
 */
function isConfigured() {
  const config = loadConfig();
  if (!config) return false;
  return !!(config.storage.endpoint && config.crypto.salt);
}

/**
 * Get effective config — config.json first, env vars as fallback, cloud salt as last resort.
 *
 * Priority:
 * 1. config.json with complete config (written by /claude-burrow:setup)
 * 2. .env / environment variables (dev mode) — salt from env, or cloud, or auto-generated
 *
 * When salt is missing but storage credentials are available, this tries to
 * download salt.dat from the cloud bucket (async). This enables machine B
 * to discover the salt without manual copying.
 *
 * @returns {Promise<Object|null>} effective config or null if nothing is configured
 */
async function getEffectiveConfig() {
  // Priority 1: config.json (written by /claude-burrow:setup)
  const cfg = loadConfig();
  if (cfg && cfg.storage && cfg.storage.endpoint && cfg.crypto && cfg.crypto.salt) {
    return cfg;
  }

  // Priority 2: .env / environment variables (dev mode)
  const storageFromEnv = loadStorageFromEnv();
  if (storageFromEnv) {
    const saltFromEnv = process.env.CLAUDEBURROW_SALT;

    if (cfg && cfg.crypto && !cfg.crypto.salt) {
      // Config exists but no salt — try cloud first, then env, then generate
      cfg.crypto.salt = saltFromEnv || await tryFetchSaltFromCloud(storageFromEnv) || await generateAndUploadSalt(storageFromEnv);
      cfg.storage = storageFromEnv;
      saveConfig(cfg);
      return cfg;
    }

    // No config.json at all — create a minimal one
    const salt = saltFromEnv || await tryFetchSaltFromCloud(storageFromEnv) || await generateAndUploadSalt(storageFromEnv);

    const newCfg = {
      version: 1,
      deviceName: process.env.CLAUDEBURROW_DEVICE_NAME || require('os').hostname(),
      storage: storageFromEnv,
      crypto: {
        salt,
        iterations: 100000,
      },
    };
    saveConfig(newCfg);
    return newCfg;
  }

  return null;
}

/**
 * Try to download salt.dat from the cloud bucket.
 * Returns null if not found or if the network call fails.
 */
async function tryFetchSaltFromCloud(storageConfig) {
  try {
    const { createClient, getObject } = require('./storage');
    const client = createClient(storageConfig);
    // Inline fetch — avoids circular dependency with index-manager
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const result = await client.send(new GetObjectCommand({
      Bucket: storageConfig.bucket,
      Key: 'salt.dat',
    }));
    const chunks = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8').trim();
  } catch (_) {
    // No salt in cloud, or network error — caller will generate
    return null;
  }
}

/**
 * Generate a new random salt and upload it to the cloud bucket.
 * Upload failures are non-fatal — the salt is still valid locally.
 */
async function generateAndUploadSalt(storageConfig) {
  const newSalt = require('crypto').randomBytes(16).toString('base64');
  try {
    const { createClient, putObject } = require('./storage');
    const client = createClient(storageConfig);
    await putObject(client, storageConfig.bucket, 'salt.dat', Buffer.from(newSalt, 'utf-8'), {
      contentType: 'text/plain',
    });
  } catch (_) {
    // Upload failed — salt remains locally valid, will retry on next run
  }
  return newSalt;
}

// ---- Device identity ----

/**
 * Get the CC session ID from environment or transcript path.
 * CC hooks pass session_id via stdin JSON, but when running from a slash command
 * we need alternative sources.
 *
 * Priority:
 * 1. CLAUDE_SESSION_ID env var (if CC sets it for commands)
 * 2. Parse from transcript_path in hook stdin (only available in hook context)
 * 3. Find the most recently modified session in ~/.claude/projects/
 *
 * @param {string} [cwd] - Current working directory
 * @returns {{ sessionId: string, transcriptPath: string } | null}
 */
function detectCurrentSession(cwd) {
  const projectDir = getProjectSessionDir(cwd || process.cwd());

  if (!fs.existsSync(projectDir)) {
    return null;
  }

  // Find the most recently modified .jsonl file (skip subagent dirs, memory dirs)
  let latest = null;
  let latestTime = 0;

  try {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      const fullPath = path.join(projectDir, entry);
      // Only match session .jsonl files (they are flat files, not directories)
      if (!entry.endsWith('.jsonl')) continue;
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs > latestTime) {
        latestTime = stat.mtimeMs;
        latest = {
          sessionId: entry.replace('.jsonl', ''),
          transcriptPath: fullPath,
        };
      }
    }
  } catch (_) {
    return null;
  }

  return latest;
}

/**
 * Get the project session directory path.
 * ~/.claude/projects/<project-slug>/
 *
 * @param {string} cwd - Project working directory
 * @returns {string}
 */
function getProjectSessionDir(cwd) {
  // CC replaces non-alphanumeric chars with '-' in project directory name.
  // Do NOT collapse consecutive dashes — CC preserves them (e.g. D:\cc_tool → D--cc-tool).
  // Do NOT strip leading '-' — Unix absolute paths produce it (e.g. /Users/... → -Users-...).
  const projectSlug = cwd
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-$/, '')       // Only strip trailing dash (paths ending in /)
    .toLowerCase() || 'root';

  return path.join(os.homedir(), '.claude', 'projects', projectSlug);
}

/**
 * List all local sessions for the given project directory.
 * @param {string} cwd
 * @returns {Array<{ sessionId: string, transcriptPath: string, mtime: Date }>}
 */
function listLocalSessions(cwd) {
  const projectDir = getProjectSessionDir(cwd || process.cwd());
  if (!fs.existsSync(projectDir)) return [];

  const sessions = [];
  try {
    const entries = fs.readdirSync(projectDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const fullPath = path.join(projectDir, entry);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      sessions.push({
        sessionId: entry.replace('.jsonl', ''),
        transcriptPath: fullPath,
        mtime: stat.mtime,
      });
    }
  } catch (_) {
    // ignore
  }
  return sessions.sort((a, b) => b.mtime - a.mtime);
}

module.exports = {
  getDataDir,
  getConfigPath,
  createDefaultConfig,
  loadConfig,
  saveConfig,
  isConfigured,
  getEffectiveConfig,
  loadStorageFromEnv,
  detectCurrentSession,
  getProjectSessionDir,
  listLocalSessions,
};
