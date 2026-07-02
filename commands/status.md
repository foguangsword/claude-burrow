---
name: burrow-status
description: Show ClaudeBurrow sync status — cloud session count, storage usage, and configuration
argument-hint: ""
---

# /claude-burrow:status

Display the current ClaudeBurrow status: configuration summary, cloud session count,
estimated storage usage, and local session overview.

## Instructions

When the user invokes this command:

1. Run the status script:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/status.js"
   ```

2. Display the output to the user. If it says "not configured",
   tell the user to run `/claude-burrow:setup` first.

## What it shows

- **Device info**: device name, user ID
- **Storage backend**: endpoint URL, bucket name, connection status
- **Cloud sessions**: total count, total storage used
- **Local sessions**: sessions in the current project directory
