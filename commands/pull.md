---
name: burrow-pull
description: Browse and download synced sessions from cloud storage
argument-hint: "[search-keyword]"
---

# /claude-burrow:pull

List sessions stored in cloud storage and download the one you want to resume.

## Instructions

When the user invokes this command, do the following:

1. Ask the user for their **encryption passphrase**. Do NOT log or store it.

2. List cloud sessions:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/pull.js" --passphrase "<passphrase>"
   ```
   (Add `--keyword "<keyword>"` if the user provided a search term.)

3. Display the session list clearly — show number, title, device, date, and message count
   for each entry. Let the user pick one by number.

4. **Determine the target project path:**
   - If the session's `projectPath` matches the current working directory → skip the path
     question entirely, pass `--project-path "<cwd>"` directly.
   - If they differ → ask the user briefly. Accept these as "use current directory":
     "here", "current", "this", "当前目录", "当前", ".", "yes", "y".
     ```
     This session is from /home/alice/payment.
     Save to current directory (D:\cc_tool)? Type a path, or "here" for current.
     ```
   - The user can also type a custom absolute path.

5. Run the download:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/pull.js" \
     --passphrase "<passphrase>" \
     --select <number> \
     --project-path "<resolved-path>"
   ```

6. Display the result. If successful, tell the user the exact command to run.
   Fill in the actual session ID (not a placeholder). Include the `--plugin-dir` flag
   if the user originally launched CC that way:

   ```
   ✓ Session downloaded. To resume, open a new terminal and run:

     claude --plugin-dir ${CLAUDE_PLUGIN_ROOT} --resume f734ff63-054d-4a7a-b9e5-0c234abccfc9

   (If you installed via marketplace, omit --plugin-dir.)
   (CC can't switch sessions inside an active conversation — this needs a new window.)
   ```

   Always substitute the REAL session ID from the downloaded session.

## Error handling

- "not configured" → run `/claude-burrow:setup` first
- "Wrong passphrase" → must match the passphrase used when the session was pushed
- "No cloud sessions yet" → push first with `/claude-burrow:push`

## Cross-device path mapping

The pull script accepts `--project-path` to specify where to write the session file
locally. Defaults to the current working directory.
