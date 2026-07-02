---
name: burrow-setup
description: Initialize ClaudeBurrow — configure storage backend
argument-hint: ""
---

# /claude-burrow:setup

Initialize ClaudeBurrow on this machine. Configures your storage backend
and automatically sets up encryption parameters (salt).

No passphrase is needed during setup — you'll set one when you first push or pull.

## Instructions

When the user invokes this command, do the following:

1. Briefly explain what setup does:
   - Configures your S3-compatible storage (OSS/R2/S3/custom)
   - Automatically syncs the encryption salt with the cloud
   - After setup, use `/claude-burrow:push` (you'll be asked for a passphrase then)

2. Ask the user which storage backend they want to use:
   - **Aliyun OSS** (China users)
   - **Cloudflare R2** (global, free 10GB)
   - **AWS S3**
   - **Custom S3-compatible**

3. Guide them to get credentials based on their choice:
   - **OSS**: Create bucket at https://oss.console.aliyun.com/, get AccessKey at https://ram.console.aliyun.com/manage/ak
   - **R2**: Create bucket at https://dash.cloudflare.com/, generate API token with read+write
   - **S3**: Create bucket in AWS Console, get IAM access key
   - **Custom**: Provide your own endpoint

4. Ask for credentials (one at a time):
   ```
   Endpoint URL:
   Bucket name:
   Access Key ID:
   Secret Access Key:
   (for OSS/S3, also ask Region)
   ```

5. Ask for an optional device name (defaults to hostname — just accept empty).

6. Run the setup script (no passphrase needed):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.js" \
     --storage-type <type> \
     --endpoint "<endpoint>" \
     --bucket "<bucket>" \
     --access-key "<access_key>" \
     --secret-key "<secret_key>" \
     --region "<region>" \
     --device-name "<device_name>"
   ```

7. Display the output. Remind the user:
   - Salt was automatically synced (if this is the first device, a new one was created and uploaded)
   - Next step: `/claude-burrow:push` — you'll set your encryption passphrase then
   - Use the SAME passphrase on all your devices

## What happens under the hood

1. Tests connectivity to your storage backend
2. Checks if `salt.dat` exists in the cloud bucket:
   - **If yes** (machine B scenario): downloads it — same salt = same encryption key across devices
   - **If no** (machine A scenario): generates a new random salt and uploads it to the cloud
3. Saves everything to `~/.claude/plugins/data/claude-burrow/config.json`

## Security

The salt is stored as plaintext in the cloud bucket (`salt.dat`). This is safe because
salt is not a secret — it only prevents rainbow-table attacks. Your actual encryption
key is derived from **salt + passphrase**, and the passphrase never leaves your machine.
