# opencode-prompt-finder

A Node.js command-line tool that uses `fzf` to quickly search local opencode prompt history and print or copy the selected prompt.

[English](./README.md) | [简体中文](./README_zh.md)

## ✨ Features

- 🔎 **Fast prompt search** with `fzf`
- 🗂️ **Multiple data sources**: SQLite DB or prompt history file
- 🎯 **Agent filtering** for top-level user prompts in DB mode
- 📋 **Flexible output**: print to stdout or copy to clipboard

## 🚀 Quick Start

### Requirements

- Node.js 18+
- `fzf`
- `pbcopy` for clipboard copy on macOS

Install dependencies:

```bash
npm install
```

Run directly:

```bash
node bin/opencode-prompt-finder.js
```

Or link it as a local command first:

```bash
npm link
opencode-prompt-finder
```

## 📖 Usage

```bash
opencode-prompt-finder [--source <auto|db|history>] [--agents <list>] [--db-path <file>] [--path <file>] [--limit <n>] [--print]
```

### Examples

Print a prompt selected from the most recent 100 entries:

```bash
node bin/opencode-prompt-finder.js --limit 100 --print
```

Use custom agent filters:

```bash
node bin/opencode-prompt-finder.js --source db --agents orchestrator,plan,build --print
```

## ⚙️ Options

- `--source <auto|db|history>`: data source, default `auto`
  - `auto`: prefer SQLite DB, fall back to history file on failure
  - `db`: use SQLite DB only
  - `history`: use history file only
- `--agents <list>`: only effective in SQLite DB mode; comma-separated top-level agents to keep. Default: `orchestrator,plan,build`
- `--db-path <file>`: path to the OpenCode SQLite DB, default `~/.local/share/opencode/opencode.db`
- `--path <file>`: path to the prompt history file, default `~/.local/state/opencode/prompt-history.jsonl`
- `--limit <n>`: number of recent prompts to read, default `200`
- `--print`: print selected content to stdout instead of copying it to the clipboard

## 🗄️ SQLite Extraction Rules

- Only extract messages where `message.role = user` and `message.agent` is included in `--agents` (default: `orchestrator`, `plan`, `build`), which helps exclude clearly internal delegated/subagent prompts
- Concatenate text parts from each message in stable order
- Keep text-related parts only; ignore image/file parts

## 📄 License

MIT License
