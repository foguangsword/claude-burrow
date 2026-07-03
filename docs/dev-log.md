# ClaudeBurrow 开发日志

## 环境信息

- **Node.js**: v22.18.0
- **npm**: 10.9.3
- **OS**: Windows 11 Pro
- **目标 CC 版本**: 最新（2026.07）

## 技术决策记录

### 2026-07-01 — 项目初始化

**存储选型**: 全部数据统一走 S3 兼容对象存储，支持阿里云 OSS、Cloudflare R2、AWS S3、自定义 S3 兼容服务。
- `forcePathStyle` 按存储类型自动设置（R2=true, OSS/S3=false）
- 理由：减少外部依赖，用户只需一个 bucket，无需额外管理 git 仓库和认证。

**同步触发**: MVP 阶段全手动，不做 hook 自动推送。
- 理由：用户希望自己决定何时同步、每次输入密码。后续可加可选的 hook 自动推送。

**Session 标题**: 从 JSONL 文件第一条用户消息提取，截前 60 字符。
- 理由：和网页端 AI 对话列表一致的用户体验。

**跨设备路径**: Pull 时让用户指定本地项目路径，默认值为当前 cwd。
- 理由：MVP 简单直接。后续可自动检测项目结构匹配。

**命令 namespacing**: 接受 CC 的 namespaced 格式（`/claude-burrow:push`），不做别名。
- 理由：CC plugin 系统强制要求。后续可以通过 CC 的 hook 机制注册短别名。

**加密方案**: AES-256-GCM + PBKDF2-SHA256 (100,000 iterations, 16-byte salt)。
- IV 每次加密随机生成
- Salt 首次 setup 时随机生成，上传到云端 `salt.dat`（明文，salt 不保密）
- 其他设备 setup 时自动发现并下载云端 salt，保证跨设备密钥一致
- 密码不持久化，每次 push/pull 时输入

**索引并发**: ETag 乐观锁 + 最多 3 次重试。
- 理由：手动触发、单用户、低频操作，实际冲突概率极低。ETag 机制作为安全兜底。

## 模块说明

| 模块 | 路径 | 职责 |
|------|------|------|
| config | scripts/lib/config.js | 配置读写、路径解析、本地 session 探测 |
| crypto | scripts/lib/crypto.js | PBKDF2 密钥派生、AES-256-GCM 加密/解密 |
| storage | scripts/lib/storage.js | S3 客户端封装（Put/Get/Head/List）、ETag 条件写 |
| index-manager | scripts/lib/index-manager.js | 索引的拉取/合并/推送、session 的 push/pull 高层 API |
| session | scripts/lib/session.js | JSONL 解析、标题提取、格式化工具 |
| setup | scripts/setup.js | 交互式配置向导入口 |
| push | scripts/push.js | 推送命令入口 |
| pull | scripts/pull.js | 拉取命令入口 |
| status | scripts/status.js | 状态查看入口 |

## Smoke Test 结果（2026-07-01）

```
config module:  OK
crypto module:  OK (AES-256-GCM)
deriveKey:      OK (32 bytes)
encrypt/decrypt: OK (round-trip verified)
session parse:  OK (title extraction works)
formatBytes:    OK
```

### 2026-07-01 — OSS 集成测试通过

**测试环境**: 阿里云 OSS（`oss-cn-hangzhou`），Bucket: `claude-burrow`

**结果：8/8 通过**

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | OSS 连接测试 | ✓ |
| 2 | 会话文件加密上传 | ✓ |
| 3 | 索引更新（pushSession） | ✓ |
| 4 | 云端会话列表（listCloudSessions） | ✓ |
| 5 | 下载解密回环验证（内容完全一致） | ✓ |
| 6 | 错误密码被拒绝 | ✓ |
| 7 | 关键词搜索（"payment"） | ✓ |
| 8 | 会话重推 + 索引原地更新 | ✓ |

**发现并修复**：阿里云 OSS 不支持 `If-Match` header（返回 `NotImplemented`）。在 `putObjectIfMatch` 中增加了自动降级逻辑——遇到 NotImplemented 时移除条件头重试普通写入。R2/S3 的条件写入不受影响。

### 2026-07-01 — dotenv 集成

**变更**: 添加 `dotenv` 依赖，支持从 `.env` 文件加载凭证。

- `.env` 文件 gitignored，`.env.example` 提交作为模板
- `config.getEffectiveConfig()`：优先读 `config.json`（setup 向导生成），fallback 到 `.env`（开发模式）
- env 模式下 salt 和 userId 首次自动生成并持久化到 `config.json`，后续复用
- 变量前缀统一为 `CLAUDEBURROW_`

### 2026-07-02 — 移除 userId 多租户隔离

**变更**: 去掉 OSS key 路径中的 `{userId}` 层级。

之前：`sessions/{userId}/{sessionId}.enc` + `index/{userId}/index.json.enc`
之后：`sessions/{sessionId}.enc` + `index/index.json.enc`

**理由**: bucket 本身由用户私有凭证访问，bucket 即租户边界。userId 层不仅冗余，还给跨设备同步制造障碍（需手动同步随机 UUID）。详见 [plan.md](../../plan.md) 讨论。

**影响**: 旧路径下的数据（`index/a341d596-.../` 等）成为孤儿数据，已通过 cleanup-oss.js 清理。

### 2026-07-02 — CC 本地测试通过 + 体验改进

**CC 发现的 4 个 Bug（已修复）**：

| # | 文件 | 问题 | 修复 |
|---|------|------|------|
| 1 | config.js | Windows 盘符被 strip | 保留盘符（`D--cc-tool`） |
| 2 | config.js | 连续横线被合并（`--` → `-`） | 不再合并横线 |
| 3 | session.js | 嵌套 message object → `[object Object]` 标题 | 递归处理嵌套 content |
| 4 | session.js | 标题残留 XML 标签 | 加 `<[^>]*>` strip |

**push → pull 回环测试：通过** ✅

**体验改进**：
- 标题提取跳过纯斜杠命令（<30 字符），找第一条真正对话内容
- Pull 区分 Overwritten vs Downloaded
- Pull 路径提示优化（空输入 = 当前目录）

**已知待改进**：
- （无——上述两项均已在后续迭代中解决）

### 2026-07-02 — OSS 测试数据清理

通过 `cleanup-oss.js` 批量删除了 11 个测试/旧路径孤儿对象。手动删除了残留的 `index/index.json.enc`（密码不匹配导致无法解密和重建）。

### 2026-07-02 — salt.dat 云端同步 + setup 去密码

**问题**: setup 需要输入密码（但之后 push/pull 每次都要输，多余）；salt 随机生成后不跨设备共享，机器 B 无法解密。

**方案 A — salt.dat 明文云端同步**：
- 首次 setup 生成随机 salt → 上传 `salt.dat`（明文）→ 存本地 config
- 其他设备 setup → 测试连接 → 发现 `salt.dat` → 自动下载 → 存本地 config
- salt 本身不保密（只防彩虹表），明文存储没问题
- 密码不在 setup 时输入，只在 push/pull 时输入

**改动**：
- `setup.js`：移除 `--passphrase`，Step 2 改为 salt 云端发现/生成/上传
- `config.js`：`getEffectiveConfig()` 改为 async，缺 salt 时自动 `salt.dat` 下载 → env 变量 → 自动生成
- `index-manager.js`：新增 `fetchSalt()` / `uploadSalt()`，`SALT_KEY = 'salt.dat'`
- `commands/setup.md`：去掉密码步骤
- push/pull/status：`getEffectiveConfig()` 调用加 `await`

**验证**：
```
Machine A: 生成 salt → 上传 salt.dat ✓
Machine B: 删除本地配置 → 云端拉取 salt → 一致 ✓
```

### 2026-07-02 — fetchIndex 解密失败自动重建

**问题**：测试残留的 index 用不同密码加密，导致 push 时报 `Decryption failed` 阻塞（先后发生 3 次）。

**修复**：`fetchIndex()` 遇到 `Decryption failed` 时不再抛异常，而是返回空索引（`etag: null`），由后续 push 覆盖写入新索引。

### 2026-07-02 — 跨设备同步端到端验证 ✅

**测试流程**：
1. 在 CC 中 push 3 个会话到 OSS（含当前 2.7MB 项目会话，35 条用户消息）
2. 删除本地 `~/.claude/projects/d--cc-tool/` 下全部 `.jsonl` 文件
3. 关闭 CC 窗口
4. 新开 CC：`claude --plugin-dir ./claude-burrow`
5. `/claude-burrow:pull` → 从 OSS 下载 `f734ff63` 会话
6. `claude --resume f734ff63` → 恢复对话

**验证结果**：
- 文件大小：2.7MB（与推送前一致）
- 总行数：1259 行
- 用户消息：35 条，全部完好
- 第一条：`"我正在计划一个Claude Code跨端同步工具，plan.md里大致写了一下产品方案和技术方案..."`（2026-07-01 08:02）
- 最后一条：验证恢复效果的消息（2026-07-02 09:06）

**结论：跨设备同步全链路通过** 🎉

### 2026-07-02 — 文档全面更新

同步了 plan.md、README.md、README_zh.md、dev-log.md，去掉了所有过时内容（userId、setup 密码、手动 salt 复制等），路线图标记了 MVP 全部完成项。

### 当前状态

**MVP 完成**：加密 push/pull、salt 云端自动同步、跨设备端到端验证通过。
**云端**：OSS bucket 存储 3 个会话（含当前 2.6MB 项目主会话）。
**下一步**：GitHub 仓库 + Marketplace 发布，进阶功能（auto-push、配置同步等）。

### 2026-07-02 — Mac 跨平台路径修复

**Bug**: Mac 上 pull 后 resume 失败，CC 报 "No conversation found"。原因是 `getProjectSessionDir()` 把 Unix 绝对路径的前导 `-` 去掉了：
- 代码产出：`users-hayashihiroshi-cc-tool`
- CC 实际：`-Users-hayashihiroshi-cc-tool`（前导 `/` → `-`，CC 保留它）

**修复**: `.replace(/^-|-$/g, '')` → `.replace(/-$/, '')`，只去掉尾部横线，保留 Unix 路径产生的前导横线。Windows 路径（如 `D:\cc_tool`）无前导 `/`，不受影响。另外顺手修复了.env和README中环境变量名前缀的拼写错误。
