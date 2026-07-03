# ClaudeBurrow 🐹

Claude Code 跨端会话同步工具。将对话加密后通过阿里云 OSS、Cloudflare R2 或任意 S3 兼容存储在多台机器间同步。

你在公司电脑上和 Claude 聊了两小时，捋清了架构思路，调好了一堆上下文——下班回家，换台电脑，一切从零开始。ClaudeBurrow 解决的就是这个问题：把你的 Claude Code 会话加密同步到云端，随时随地接着聊，上下文一条不丢。

> ⚠️ **Alpha 阶段** — 目前以本地插件方式（`--plugin-dir`）加载使用，尚未发布到 CC 插件市场。

## 支持的存储后端

| 后端 | 免费额度 |
|------|----------|
| **阿里云 OSS** | 按量付费，国内访问最快 |
| **Cloudflare R2** | 10 GB + 每月千万次操作 |
| **AWS S3** | 5 GB 免费套餐 |
| **自建 S3 兼容** | MinIO、Backblaze B2 等 |

所有后端使用相同的 S3 兼容 API。

## 工作原理

```
机器 A                                  机器 B
─────────────                          ─────────────
CC 会话文件 (.jsonl)                    CC 会话文件 (.jsonl)
    │                                      ▲
    ▼ AES-256-GCM 加密                     │ AES-256-GCM 解密
    │                                      │
    ▼ 上传 ──────────→ ☁️ OSS/R2/S3 ☁️ ←── 下载
                       sessions/{sessionId}.enc
                       index/index.json.enc
```

- **上传前加密** — 云端永远看不到你的对话内容
- **AES-256-GCM** — 带完整性校验的认证加密，PBKDF2-SHA256 密钥派生
- **手动控制** — 你决定什么时候同步，每次输入密码

## 快速上手

### 环境要求

- Node.js ≥ 18
- 一个 S3 兼容的对象存储 bucket（OSS、R2、S3 或自建）
- 已安装 Claude Code

### 第一步：克隆并安装依赖（一次性）

```bash
git clone https://github.com/yourname/claude-burrow.git
cd claude-burrow
npm install        # 安装 @aws-sdk/client-s3 + dotenv 到 node_modules/
```

> `npm install` 只需执行一次，依赖会保存在 `node_modules/` 目录。之后使用无需重复安装。

### 第二步：配置凭证

**方式一：`.env` 文件（推荐）**

```bash
cp .env.example .env
# 用编辑器打开 .env，填入你的存储凭证
```

`.env` 文件已加入 `.gitignore`，不会被提交。所有可配置项见 `.env.example`。

**方式二：在 CC 里运行初始化向导**

启动 CC 后运行 `/claude-burrow:setup`，按交互式引导填写。

### 第三步：启动 CC 并加载插件

```bash
claude --plugin-dir ./claude-burrow
```

> **注意**：`--plugin-dir` **每次启动 CC 都需要带上**，这是会话级加载，不会持久化。等插件发布到 marketplace 后，`/plugin install claude-burrow` 即可永久安装。目前可以加个 alias 省事：`alias cc-burrow='claude --plugin-dir /path/to/claude-burrow'`。

插件以 namespaced 命令加载：`/claude-burrow:push`、`/claude-burrow:pull` 等。修改插件代码后在 CC 中运行 `/reload-plugins` 即可生效。

### 第四步：推送会话

在 CC 中：

```
/claude-burrow:push
```

按提示输入加密密码。当前会话会被加密并上传到你的存储后端。

### 第五步：在另一台机器上拉取

在新机器上重复步骤 1–3（`.env` 里用同样的存储凭证），然后：

```
/claude-burrow:pull
```

浏览云端会话列表，选择要拉取的会话。下载完成后：

```bash
claude --resume <session-id>
```

> **重要**：两台机器必须使用**相同的加密密码**。Salt 会通过云端的 `salt.dat` 自动同步——其他设备在 setup 或首次使用时自动下载，无需手动复制。

### 存储准备

**阿里云 OSS**（国内用户推荐）：
1. 在 [OSS 控制台](https://oss.console.aliyun.com/) 创建 Bucket
2. 在 [RAM 控制台](https://ram.console.aliyun.com/manage/ak) 获取 AccessKey
3. Endpoint 格式：`https://oss-cn-hangzhou.aliyuncs.com`

**Cloudflare R2**（海外用户推荐）：
1. 在 [R2 控制台](https://dash.cloudflare.com/) 创建 Bucket
2. 生成一个有读写权限的 API Token
3. Endpoint 格式：`https://{account-id}.r2.cloudflarestorage.com`

## 命令一览

| 命令 | 说明 |
|------|------|
| `/claude-burrow:setup` | 交互式初始化向导 |
| `/claude-burrow:push` | 加密并推送当前会话 |
| `/claude-burrow:pull` | 列出并下载云端会话 |
| `/claude-burrow:status` | 查看同步状态和存储用量 |

## 配置参考

### .env 变量

| 变量 | 必填 | 示例 |
|------|------|------|
| `CLAUDEBURROW_STORAGE_TYPE` | 是 | `oss`、`r2`、`s3`、`custom` |
| `CLAUDEBURROW_STORAGE_ENDPOINT` | 是 | `https://oss-cn-hangzhou.aliyuncs.com` |
| `CLAUDEBURROW_STORAGE_BUCKET` | 是 | `claude-burrow` |
| `CLAUDEBURROW_STORAGE_ACCESS_KEY_ID` | 是 | 你的 AccessKey |
| `CLAUDEBURROW_STORAGE_SECRET_ACCESS_KEY` | 是 | 你的 SecretKey |
| `CLAUDEBURROW_STORAGE_REGION` | 否 | `oss-cn-hangzhou`（OSS），`auto`（R2） |
| `CLAUDEBURROW_PASSPHRASE` | 否 | 非交互式脚本中使用 |
| `CLAUDEBURROW_SALT` | 否 | Base64 编码的盐（不设则自动生成） |
| `CLAUDEBURROW_DEVICE_NAME` | 否 | 默认用主机名 |

### 各后端 Endpoint 示例

| 后端 | Endpoint |
|------|----------|
| **阿里云 OSS** | `https://oss-cn-hangzhou.aliyuncs.com` |
| **Cloudflare R2** | `https://{account-id}.r2.cloudflarestorage.com` |
| **AWS S3** | `https://s3.us-east-1.amazonaws.com` |

## 数据安全

- **密码不落盘** — 仅在当前操作期间保留在内存中
- **AES-256-GCM 加密** — 带完整性校验的认证加密，防止篡改
- **PBKDF2 密钥派生** — 10 万次迭代 + 唯一随机 salt
- **本地加密** — 数据在离开本机之前就已经是密文
- **云端无明文** — 上传的全部是加密后的二进制数据

> ⚠️ 密码丢失将导致云端数据无法恢复。建议用密码管理器保存。

## 项目结构

```
claude-burrow/
├── .claude-plugin/
│   └── plugin.json              # 插件元数据
├── commands/                    # 斜杠命令定义
│   ├── setup.md, push.md, pull.md, status.md
├── scripts/                     # 命令实现
│   ├── setup.js, push.js, pull.js, status.js
│   ├── test-oss.js              # 集成测试
│   ├── cleanup-oss.js           # 存储清理工具
│   └── lib/                     # 共享模块
│       ├── config.js            # 配置管理 + dotenv
│       ├── crypto.js            # AES-256-GCM 加解密
│       ├── storage.js           # S3 存储操作
│       ├── index-manager.js     # 会话索引 + ETag 锁
│       └── session.js           # 会话文件解析
├── docs/dev-log.md              # 开发日志
├── .env.example                 # 配置模板
├── package.json
└── README.md / README_zh.md
```

## 路线图

- [x] 手动推送/拉取 + AES-256-GCM 加密
- [x] 会话索引 + ETag 乐观锁
- [x] 从首条消息自动提取会话标题
- [x] 跨设备项目路径映射
- [x] salt.dat 云端自动同步（setup 无需密码）
- [x] 跨设备端到端验证（push → 删除本地 → pull → resume）
- [ ] 发布到 CC 插件市场（`/plugin install`）
- [ ] SessionEnd hook 自动推送（可选开启）
- [ ] 配置同步（CLAUDE.md、skills、hooks）
- [ ] 系统钥匙链集成（密码缓存）
- [ ] `/claude-burrow:delete` 云端会话管理
- [ ] 增量同步（仅推送新增消息）

## 许可证

MIT
