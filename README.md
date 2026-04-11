# opencode-prompt-finder

基于 Node.js 的命令行工具，用 `fzf` 快速检索 opencode 本地 prompt 历史，并打印或复制选中的 prompt。

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
opencode-prompt-finder [--path <file>] [--limit <n>] [--print]
```

### 参数

- `--path <file>`：指定 prompt 历史文件，默认 `~/.local/state/opencode/prompt-history.jsonl`
- `--limit <n>`：只读取最近多少条 prompt，默认 `200`
- `--print`：将选中内容打印到 stdout，而不是复制到剪贴板

### 示例

打印最近 100 条里筛选到的 prompt：

```bash
node bin/opencode-prompt-finder.js --limit 100 --print
```

指定历史文件：

```bash
node bin/opencode-prompt-finder.js --path ~/.local/state/opencode/prompt-history.jsonl
```

## 测试

```bash
npm test
```
