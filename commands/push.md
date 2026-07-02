---
name: burrow-push
description: Encrypt and upload the current Claude Code session to cloud storage
argument-hint: "[session-id]"
---

# /claude-burrow:push

Encrypt the current (or specified) session and upload it to your configured cloud storage.
The session title is automatically extracted from your first user message.

## Instructions

When the user invokes this command, do the following:

1. First, check if ClaudeBurrow is configured:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/push.js" --help 2>&1 || true
   ```
   (Just use this to verify the script exists; the actual check happens in step 3.)

2. Ask the user for their **encryption passphrase**. Do NOT log or store it.

3. Run the push script with the passphrase:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/push.js" --passphrase "<passphrase>"
   ```
   (Replace `<passphrase>` with what the user entered. Quote it to handle special characters.
   If the user specified a session ID in the command, add `--session-id <id>`.)

4. Display the script's output to the user.

5. If the script fails with "not set up yet", tell the user to run `/claude-burrow:setup` first.
   If it fails with "Wrong passphrase", ask them to try again.

## What happens under the hood

1. Reads the most recent session transcript (.jsonl file) from `~/.claude/projects/`
2. Extracts a title from the first user message
3. Encrypts the content with AES-256-GCM (key derived from passphrase via PBKDF2)
4. Uploads the encrypted file to your storage: `sessions/{userId}/{sessionId}.enc`
5. Updates the encrypted index file with ETag-based optimistic locking

## Example

```
User: /claude-burrow:push

CC: What's your encryption passphrase?
User: ********

CC: (runs node "${CLAUDE_PLUGIN_ROOT}/scripts/push.js" --passphrase "********")

Output:
  Reading session: abc123def...
    Title: Refactoring the payment module
    Messages: 42
  Encrypting and uploading...
  ✓ Synced: "Refactoring the payment module" (abc123def)
```
