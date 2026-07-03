# `~/.claude/` 目录需求分析与兼容性评估

> 这份文档是 ClaudeBurrow 的产品设计原点：从 CC 的用户数据目录出发，分析"跨端同步"这件事到底要同步什么、有什么风险。

## 一、目录全景

`~/.claude/` 是 CC 所有用户级数据的根目录。下面以当前版本（2026.07）的实际内容为例：

```bash
~/.claude/
│
├── ── 用户配置层（跨项目共享）──
│
├── CLAUDE.md                 # 全局个人指令，每个会话都加载
├── settings.json             # 用户设置（权限模式、hooks、模型偏好、env vars）
├── keybindings.json          # 自定义键盘快捷键
│
├── skills/                   # 个人技能（全局可用）
├── commands/                 # 个人命令（全局可用）
├── agents/                   # 个人子代理定义
├── rules/                    # 个人规则（全局生效）
├── workflows/                # 个人工作流脚本
├── output-styles/            # 自定义输出样式
├── themes/                   # 自定义主题
│
├── ── 项目数据层（按项目隔离）──
│
├── projects/
│   └── {project-slug}/       # 每项目一个目录
│       ├── {session-id}.jsonl       # 会话记录
│       ├── {session-id}/            # 子代理会话 + 工具输出
│       ├── memory/                  # 项目自动记忆（auto memory）
│       └── agent-memory/            # 子代理持久记忆
│
├── history.jsonl             # 全局提示历史（每个 prompt 一行）
│
├── ── 系统/运行时层（不应同步）──
│
├── plugins/                  # 已安装插件（通过 marketplace 管理）
├── cache/                    # CC 内部缓存
├── backups/                  # 备份文件
├── file-history/             # 文件编辑前快照（checkpoint restore）
├── paste-cache/              # 粘贴内容缓存
├── shell-snapshots/          # Shell 输出快照
├── session-env/              # 会话环境变量
├── sessions/                 # 会话元数据（CC 运行时状态）
├── tasks/                    # 任务追踪
├── telemetry/                # 遥测数据
├── .last-cleanup             # 上次清理时间戳
└── .last-update-result.json  # 上次更新结果
```

## 二、按需求分层

### 第一层：必须同步（跨设备核心价值）

| 数据 | 路径 | 说明 | 格式 | 大小 |
|------|------|------|------|------|
| **会话记录** | `projects/{proj}/{id}.jsonl` | 对话全文，核心资产 | JSONL | 50KB–3MB/会话 |
| **全局指令** | `CLAUDE.md` | 定义了"我是谁、我要怎么写代码" | Markdown | <10KB |
| **个人技能** | `skills/` | 自定义工具和工作流 | Markdown | <100KB |
| **个人命令** | `commands/` | 自定义斜杠命令 | Markdown | <50KB |
| **个人子代理** | `agents/` | 自定义 AI 角色 | Markdown | <50KB |
| **个人规则** | `rules/` | 全局行为规则 | Markdown | <50KB |
| **项目自动记忆** | `projects/{proj}/memory/` | CC 在对话中自动记住的项目知识 | Markdown | <50KB |

**同步频率**：会话→每次对话结束；配置→变更时手动触发。

### 第二层：建议同步（提升一致性）

| 数据 | 路径 | 说明 | 风险 |
|------|------|------|------|
| **用户设置** | `settings.json` | 权限、hooks、模型、环境变量 | ⚠️ 含机器相关字段 |
| **快捷键** | `keybindings.json` | 纯偏好，无机器依赖 | ✅ 安全 |
| **工作流** | `workflows/` | 多代理编排脚本 | ✅ 安全 |
| **输出样式** | `output-styles/` | 展示偏好 | ✅ 安全 |
| **主题** | `themes/` | 视觉偏好 | ✅ 安全 |

**settings.json 的风险**：可能包含绝对路径（如 hook 脚本路径、项目路径），跨平台直接覆盖会出问题。需要做字段级过滤，只同步通用设置（如 `permissionMode`、`model`、`env`）。

### 第三层：不应同步

| 数据 | 原因 |
|------|------|
| `plugins/` | 通过 CC marketplace 独立管理 |
| `cache/`, `backups/`, `file-history/` | 机器相关缓存，重启后重建 |
| `paste-cache/`, `shell-snapshots/` | 临时运行时数据 |
| `session-env/`, `sessions/`, `tasks/` | CC 内部状态，格式不稳定 |
| `telemetry/` | 遥测数据，机器无关 |
| `history.jsonl` | 383KB 且持续增长，价值低（session 已包含） |

## 三、项目级 `.claude/` 的区别

项目根目录下也可以有 `.claude/`（如 `D:\cc_tool\.claude\`），与 `~/.claude/` 不同：

| | 用户级 `~/.claude/` | 项目级 `./claude/` |
|------|-----|------|
| 作用域 | 所有项目 | 仅当前项目 |
| 版本控制 | 一般不提交 git | 通常提交 git |
| 同步策略 | **ClaudeBurrow 负责** | 项目 git 负责 |
| 典型内容 | 个人偏好、全局指令 | 项目指令、项目级 hooks |

**结论**：ClaudeBurrow 只同步用户级数据。项目级 `.claude/` 本来就该跟代码一起在 git 里。

## 四、跨平台差异

### Windows vs macOS vs Linux

| 差异点 | Windows | macOS / Linux | 影响 |
|--------|---------|---------------|------|
| 根路径 | `C:\Users\xxx\.claude\` | `~/.claude/` → `/Users/xxx/.claude/` | 低——CC 统一用 `~` |
| 项目 slug | `D--cc-tool`（盘符保留） | `-Users-xxx-cc-tool`（前导 `-`） | **已修复** |
| 换行符 | CRLF | LF | 低——JSONL 本身处理 |
| 文件权限 | 无 Unix 权限概念 | 有 `chmod` | 低——不涉及可执行文件 |
| 路径分隔符 | `\` | `/` | 低——Node.js `path.join()` 处理 |

**已验证**：Windows → OSS → macOS 完整链路通过。

### 需要注意的点

1. **settings.json 中的路径**：Windows 路径（`D:\cc_tool`）和 macOS 路径（`/Users/xxx/cc_tool`）无法直接互换。同步 settings.json 时必须过滤或转换。
2. **技能/命令中的路径引用**：用户可能在 SKILL.md 里写了绝对路径。这不归我们管，但应该文档提示。

## 五、CC 版本兼容性风险

### 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| JSONL 格式变化 | 中 | 高——标题提取、消息计数失效 | 防御式解析 + 兜底值 |
| 项目 slug 算法变化 | 低 | 高——session 写入错误目录 | 优先用 CC API 获取 session 目录 |
| 新增重要文件类型 | 中 | 低——新数据漏同步 | 版本检测 + 文档跟进 |
| 目录结构调整 | 低 | 中——路径硬编码失效 | 集中管理路径常量 |
| CC 提供官方 sync API | 低 | 高——插件可能过时 | 关注 CC 路线图，及时切换 |
| CC 自身内置同步功能 | 中 | 极高——插件被替代 | 提供差异化价值（加密、多后端） |

### 已采取的措施

1. **session 解析**：字段名用宽松匹配（`role || type`、`user || human`），失败时兜底 `sessionId` 前 8 位
2. **项目 slug**：不自己发明算法，追踪 CC 实际生成的目录名。已知差异已修复
3. **路径集中管理**：`getProjectSessionDir()`、`getDataDir()` 等集中在 config.js

### 应进一步采取的措施

1. **CC 版本记录**：在 `config.json` 中记录创建时的 CC 版本，便于将来做兼容判断
2. **Session 读取优先用 CC CLI**：`claude -p --resume <id> --output-format json "summarize"` 比直接解析 JSONL 更稳定（但需要 CC 已安装且有 session）
3. **目录发现**：不假设 `~/.claude/projects/` 一定存在，先检查再操作

### 兜底策略

如果 CC 某次升级导致插件无法工作：

1. **标题提取失败** → 用 sessionId 前 8 位（已有此逻辑）
2. **项目 slug 不匹配** → 让用户手动指定目标路径（已有此逻辑）
3. **整个目录结构变了** → 发布新版本适配，旧版本提示用户升级

CC 的 session 格式变化不会导致数据丢失——云端存的是加密的完整 JSONL，解密后仍然是有效数据。最多是插件工具解析不了，但文件本身可用。

## 六、同步架构建议

基于以上分析，推荐的数据模型：

```bash
云端存储（S3 Bucket）
├── salt.dat                          # 明文 salt
├── index/index.json.enc              # 会话索引（加密）
├── sessions/{sessionId}.enc          # 会话文件（加密）
├── config/                           # V0.2 新增
│   ├── CLAUDE.md.enc                 # 全局指令
│   ├── skills.tar.gz.enc             # 技能打包
│   ├── commands.tar.gz.enc           # 命令打包
│   ├── agents.tar.gz.enc             # 子代理打包
│   ├── rules.tar.gz.enc              # 规则打包
│   ├── keybindings.json.enc          # 快捷键
│   └── settings.json.enc             # 用户设置（过滤后）
└── memory/{projectSlug}.tar.gz.enc   # V0.3 新增：项目记忆
```

配置类数据天然适合**整体打包**（体积小、文件多、变更频率低），而非逐文件管理。

## 七、总结

| 问题 | 答案 |
|------|------|
| 跨端同步的数据都在 `.claude/` 里吗？ | 是，用户级数据全在这里 |
| Windows 和 Mac 结构一样吗？ | 核心结构一致，细节差异已修复 |
| CC 版本升级会破坏插件吗？ | JSONL 解析有风险但已防御，不会丢数据 |
| 有官方 sync 方案怎么办？ | 我们的差异化价值：多后端、加密、手动控制 |