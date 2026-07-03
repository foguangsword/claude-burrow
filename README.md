# ClaudeBurrow 🐹

Cross-device session sync for Claude Code. Encrypt your conversations and sync them across machines via Aliyun OSS, Cloudflare R2, or any S3-compatible storage.

You spent two hours with Claude at work — nailed the architecture, built up all the context — then got home, opened your laptop, and had to start over. ClaudeBurrow fixes that. It encrypts your Claude Code sessions and syncs them to the cloud, so you can pick up exactly where you left off, on any machine.

> ⚠️ **Alpha software** — ClaudeBurrow is in early development. Currently tested as a local plugin (`--plugin-dir`). Marketplace publishing is planned.

## Supported Backends

| Backend | Free Tier |
|---------|-----------|
| **Aliyun OSS** (阿里云) | Pay-as-you-go, best for China |
| **Cloudflare R2** | 10 GB + 10M ops/month |
| **AWS S3** | 5 GB (free tier) |
| **Custom S3-compatible** | MinIO, Backblaze B2, etc. |

All backends use the same S3-compatible API.

## How it works

```
Machine A                                Machine B
─────────────                          ─────────────
CC session (.jsonl)                    CC session (.jsonl)
    │                                      ▲
    ▼ AES-256-GCM encrypt                  │ AES-256-GCM decrypt
    │                                      │
    ▼ upload ──────────→ ☁️ OSS/R2/S3 ☁️ ←── download
                         sessions/{sessionId}.enc
                         index/index.json.enc
```

- **Encrypted before upload** — the cloud never sees your conversation content
- **AES-256-GCM** — authenticated encryption with PBKDF2-SHA256 key derivation
- **Manual control** — you decide when to sync, you enter your passphrase each time

## Getting Started

### Prerequisites

- Node.js ≥ 18
- An S3-compatible storage bucket (OSS, R2, S3, or custom)
- Claude Code installed

### Step 1: Clone and install dependencies (one-time)

```bash
git clone https://github.com/yourname/claude-burrow.git
cd claude-burrow
npm install        # Installs @aws-sdk/client-s3 + dotenv into node_modules/
```

> `npm install` is only needed once — it puts dependencies in `node_modules/`. Skip this on subsequent uses.

### Step 2: Configure credentials

**Option A — `.env` file (recommended for now):**

```bash
cp .env.example .env
# Edit .env with your storage credentials
```

The `.env` file is gitignored. See `.env.example` for all available options.

**Option B — Setup wizard (in Claude Code):**

Launch CC first, then run `/claude-burrow:setup` for an interactive walkthrough.

### Step 3: Launch Claude Code with the plugin

```bash
claude --plugin-dir ./claude-burrow
```

> **Note:** `--plugin-dir` is needed **each time** you start CC — it's a session-only load. Once the plugin is published to the marketplace, `/plugin install claude-burrow` will make it permanent. For now, you can add an alias: `alias cc-burrow='claude --plugin-dir /path/to/claude-burrow'`.

The plugin loads with namespaced commands: `/claude-burrow:push`, `/claude-burrow:pull`, etc.

If you edit the plugin code mid-session, run `/reload-plugins` to pick up changes.

### Step 4: Push your first session

In Claude Code:

```
/claude-burrow:push
```

Enter your encryption passphrase when prompted. Your current session is encrypted and uploaded.

### Step 5: Pull on another machine

On a second machine, repeat steps 1–3 (same `.env` config with your storage credentials). Then:

```
/claude-burrow:pull
```

Browse your cloud sessions, pick one, and download it. Once downloaded:

```bash
claude --resume <session-id>
```

> **Important:** You must use the **same encryption passphrase** on both machines. The salt is automatically synced via `salt.dat` in your cloud bucket — other devices download it during setup or on first use. No manual copying needed.

## Commands

| Command | Description |
|---------|-------------|
| `/claude-burrow:setup` | Interactive setup wizard |
| `/claude-burrow:push` | Encrypt and upload current session |
| `/claude-burrow:pull` | List and download cloud sessions |
| `/claude-burrow:status` | View sync status and storage usage |

## Configuration Reference

### .env variables

| Variable | Required | Example |
|----------|----------|---------|
| `CLAUDEBURROW_STORAGE_TYPE` | Yes | `oss`, `r2`, `s3`, `custom` |
| `CLAUDEBURROW_STORAGE_ENDPOINT` | Yes | `https://oss-cn-hangzhou.aliyuncs.com` |
| `CLAUDEBURROW_STORAGE_BUCKET` | Yes | `claude-burrow` |
| `CLAUDEBURROW_STORAGE_ACCESS_KEY_ID` | Yes | Your access key |
| `CLAUDEBURROW_STORAGE_SECRET_ACCESS_KEY` | Yes | Your secret key |
| `CLAUDEBURROW_STORAGE_REGION` | No | `oss-cn-hangzhou` (OSS), `auto` (R2) |
| `CLAUDEBURROW_PASSPHRASE` | No | Set for non-interactive scripts |
| `CLAUDEBURROW_SALT` | No | Base64 salt (auto-generated if omitted) |
| `CLAUDEBURROW_DEVICE_NAME` | No | Defaults to hostname |

### Storage endpoint examples

| Backend | Endpoint |
|---------|----------|
| **Aliyun OSS** | `https://oss-cn-hangzhou.aliyuncs.com` |
| **Cloudflare R2** | `https://{account-id}.r2.cloudflarestorage.com` |
| **AWS S3** | `https://s3.us-east-1.amazonaws.com` |

## Security

- **Passphrase never stored** — held only in memory during the current operation
- **AES-256-GCM encryption** — authenticated encryption with tamper detection
- **PBKDF2 key derivation** — 100,000 iterations with a unique random salt
- **Local encryption** — data is encrypted before it leaves your machine
- **No plaintext in cloud** — only encrypted blobs are uploaded

> ⚠️ Your passphrase cannot be recovered if lost. Store it in a password manager.

## Project Structure

```
claude-burrow/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── commands/                    # Slash command definitions
│   ├── setup.md, push.md, pull.md, status.md
├── scripts/                     # Command implementations
│   ├── setup.js, push.js, pull.js, status.js
│   ├── test-oss.js              # Integration test
│   ├── cleanup-oss.js           # Storage maintenance
│   └── lib/                     # Shared modules
│       ├── config.js            # Configuration + dotenv
│       ├── crypto.js            # AES-256-GCM encryption
│       ├── storage.js           # S3 storage operations
│       ├── index-manager.js     # Session index + ETag locking
│       └── session.js           # Session file parsing
├── docs/dev-log.md              # Development log
├── .env.example                 # Configuration template
├── package.json
└── README.md
```

## Roadmap

- [x] Manual push/pull with AES-256-GCM encryption
- [x] Session index with ETag optimistic locking
- [x] Session title auto-extraction from first message
- [x] Cross-device project path mapping
- [x] Cross-device salt auto-sync via `salt.dat`
- [x] Cross-device end-to-end verification (push → delete local → pull → resume)
- [ ] Marketplace publishing (`/plugin install`)
- [ ] Auto-push via SessionEnd hook (opt-in)
- [ ] Config sync (CLAUDE.md, skills, hooks)
- [ ] OS keychain integration for passphrase caching
- [ ] `/claude-burrow:delete` for managing cloud sessions
- [ ] Incremental sync (only push new messages)

## License

MIT
