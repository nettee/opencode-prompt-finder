# opencode-prompt-finder

基于 Node.js 的命令行工具，用 `fzf` 快速检索 opencode 本地 prompt 历史，并打印或复制选中的 prompt。

默认会优先从 OpenCode SQLite 数据库读取更完整的历史（包括分段存储在 parts 里的文本），如果不可用则自动回退到历史文件。

## 依赖

- Node.js 18+
- `fzf`
- macOS 下复制到剪贴板需要 `pbcopy`

## 安装依赖

项目没有运行时依赖，生成 lockfile 或安装本地包元数据即可：

```bash
npm install
```

## 运行

直接执行：

```bash
node bin/opencode-prompt-finder.js
```

或先链接为本地命令：

```bash
npm link
opencode-prompt-finder
```

## 用法

```bash
opencode-prompt-finder [--source <auto|db|history>] [--agents <list>] [--db-path <file>] [--path <file>] [--limit <n>] [--print]
```

### 参数

- `--source <auto|db|history>`：数据源，默认 `auto`
  - `auto`：优先 SQLite DB，失败时回退到 history 文件
  - `db`：仅使用 SQLite DB
  - `history`：仅使用 history 文件
- `--agents <list>`：仅在 SQLite DB 模式下生效，指定要保留的顶层 agent 列表，逗号分隔。默认 `orchestrator,plan,build`
- `--db-path <file>`：指定 OpenCode SQLite DB 路径，默认 `~/.local/share/opencode/opencode.db`
- `--path <file>`：指定 prompt 历史文件路径，默认 `~/.local/state/opencode/prompt-history.jsonl`
- `--limit <n>`：只读取最近多少条 prompt，默认 `200`
- `--print`：将选中内容打印到 stdout，而不是复制到剪贴板

### SQLite 提取规则

- 仅提取 `message.role = user` 且 `message.agent` 属于 `--agents` 指定列表的消息（默认 `orchestrator` / `plan` / `build`，用于排除明显的内部 delegated/subagent 提示词）
- 逐条消息按稳定顺序拼接其 `part` 中的文本片段
- 只保留文本相关 part，忽略 image/file part

### 示例

打印最近 100 条里筛选到的 prompt：

```bash
node bin/opencode-prompt-finder.js --limit 100 --print
```

强制从 SQLite DB 读取：

```bash
node bin/opencode-prompt-finder.js --source db --db-path ~/.local/share/opencode/opencode.db --print
```

自定义保留的 agent：

```bash
node bin/opencode-prompt-finder.js --source db --agents orchestrator,plan,build --print
```

指定 history 文件（不走 DB）：

```bash
node bin/opencode-prompt-finder.js --source history --path ~/.local/state/opencode/prompt-history.jsonl
```

## 测试

```bash
npm test
```
