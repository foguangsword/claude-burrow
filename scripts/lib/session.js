/**
 * Session file utilities for ClaudeBurrow.
 *
 * CC session files are JSONL format (one JSON object per line) stored at:
 *   ~/.claude/projects/<project-slug>/<session-id>.jsonl
 *
 * WARNING: The JSONL format is internal to Claude Code and may change between
 * versions. This module uses defensive parsing — if the expected fields aren't
 * found, it falls back gracefully rather than crashing.
 */

const fs = require('fs');

/**
 * Parse a session transcript file and extract metadata.
 *
 * @param {string} transcriptPath - Full path to the .jsonl file
 * @returns {{
 *   title: string,
 *   messageCount: number,
 *   firstUserMessage: string|null,
 *   projectPath: string|null,
 * }}
 */
function parseSessionFile(transcriptPath) {
  const content = fs.readFileSync(transcriptPath, 'utf-8');
  const lines = content.trim().split('\n');

  let firstUserMessage = null;
  let messageCount = 0;
  let projectPath = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    let entry;
    try {
      entry = JSON.parse(line);
    } catch (_) {
      // Skip malformed lines (shouldn't happen, but be defensive)
      continue;
    }

    // Count all messages (best-effort)
    messageCount++;

    // Extract project path from any entry that has it
    if (!projectPath && entry.cwd) {
      projectPath = entry.cwd;
    }

    // Find the first meaningful user message for title extraction.
    // Skip messages that are only slash commands — those aren't useful titles.
    if (!firstUserMessage) {
      const role = entry.role || entry.type || '';
      if (role === 'user' || role === 'human') {
        const text = extractTextContent(entry);
        // Skip if it's purely a slash command (e.g. "/claude-burrow:push")
        if (text && !isOnlyCommand(text)) {
          firstUserMessage = text;
        }
      }
    }

    // Early exit if we have everything we need
    if (firstUserMessage && projectPath) {
      continue;
    }
  }

  // Fallback: if all user messages were commands, use the first one anyway
  if (!firstUserMessage) {
    firstUserMessage = findFirstUserMessage(lines);
  }

  const title = firstUserMessage
    ? firstUserMessage
        .replace(/<[^>]*>/g, '')       // Strip XML/HTML tags
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 60)
    : null;

  return { title, messageCount, firstUserMessage, projectPath };
}

/**
 * Check if a message text is purely slash-command invocations
 * (e.g. "/claude-burrow:push", "/status", "/help me").
 * A line is considered "only a command" if it starts with '/' AND is short
 * (under 30 chars) — longer lines starting with '/' likely contain real
 * content after the command (e.g. "/push 帮我把代码推上去").
 *
 * @param {string} text
 * @returns {boolean}
 */
function isOnlyCommand(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return true;
  return lines.every(l => {
    const t = l.trim();
    return t.startsWith('/') && t.length < 30;
  });
}

/**
 * Fallback: scan all lines for the first user message (ignoring command-only filter).
 */
function findFirstUserMessage(lines) {
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_) { continue; }
    const role = entry.role || entry.type || '';
    if (role === 'user' || role === 'human') {
      return extractTextContent(entry);
    }
  }
  return null;
}

/**
 * Extract text content from a message entry.
 * Handles both string content and array-of-blocks content (multimodal).
 *
 * @param {Object} entry - Parsed JSON line from session file
 * @returns {string|null}
 */
function extractTextContent(entry) {
  if (!entry.content && !entry.message && !entry.text) return null;

  const raw = entry.content || entry.message || entry.text;

  if (typeof raw === 'string') {
    return raw.trim();
  }

  if (Array.isArray(raw)) {
    // Multimodal content blocks: find the first text block
    for (const block of raw) {
      if (typeof block === 'string') return block.trim();
      if (block.type === 'text' && block.text) return block.text.trim();
      if (block.text) return String(block.text).trim();
    }
    return null;
  }

  // Handle nested message object: { role: "user", content: "..." | [...] }
  if (typeof raw === 'object' && raw !== null && raw.content) {
    return extractTextContent({ content: raw.content });
  }

  // Unknown format — try to stringify
  return String(raw).substring(0, 60);
}

/**
 * Format file size for human display.
 *
 * @param {number} bytes
 * @returns {string} e.g. "4.2 MB"
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${size} ${units[i]}`;
}

module.exports = {
  parseSessionFile,
  extractTextContent,
  formatBytes,
};
