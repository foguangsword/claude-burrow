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

2. First, list cloud sessions:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/pull.js" --passphrase "<passphrase>"
   ```
   (Add `--keyword "<keyword>"` if the user provided a search term.)

3. Display the session list to the user clearly. Format it nicely with numbers, titles,
   device names, and relative dates. Let the user pick one by number.

4. Once the user selects a session (by number), show where it was originally
   synced from, then ask where to save it locally. If the user provides nothing
   (empty answer), use the current working directory. Do NOT require them to
   type anything — just accept an empty response as "use current directory".

   Example prompt:
   ```
   Session "Payment refactor" was originally at: /home/alice/work/payment
   Where should I save it? (leave empty for current directory: /home/bob/code/cc_tool)
   ```

5. Run the download (omit --project-path to use default, or pass custom path):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/pull.js" --passphrase "<passphrase>" --select <number> --project-path "<path>"
   ```

6. Display the output. If successful, tell the user what command to run:
   ```
   Resume with:  claude --resume <session-id>
   ```

## Error handling

- If the script says "not configured", tell the user to run `/claude-burrow:setup` first
- If it says "Wrong passphrase", the passphrase must match the one used during setup
- If "No cloud sessions yet", the user should push first with `/claude-burrow:push`

## Cross-device path mapping

Since project paths differ across machines, the pull script accepts `--project-path`
to specify where to write the session file locally. Default is the current working directory.
