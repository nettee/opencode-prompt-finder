---
id: 20260423-codex-history-prompt-support
name: Codex History Prompt Support
status: implemented
created: '2026-04-23'
---

## Overview

- Problem Statement
  - 当前项目的历史 prompt 查找功能需要支持 Codex。
- Goals
  - 让用户能够在现有历史 prompt 查找流程中查询与 Codex 相关的 prompt。
- Scope
  - 在当前项目内扩展历史 prompt 查找能力，覆盖 Codex。
- Success Criteria
  - 历史 prompt 查找功能可以识别并返回 Codex 相关结果。

## Research

### Existing System
- 当前工具只有一个主实现文件，入口是 `bin/opencode-prompt-finder.js`，实际逻辑在 `opencode_prompt_finder.js` 的 `main()` 中完成。Source: `bin/opencode-prompt-finder.js:3`, `opencode_prompt_finder.js:330`
- 当前支持两类 opencode 数据源：历史 JSONL `~/.local/state/opencode/prompt-history.jsonl` 与 SQLite DB `~/.local/share/opencode/opencode.db`，`auto` 模式优先 DB，再回退到 history。Source: `opencode_prompt_finder.js:8-16`, `opencode_prompt_finder.js:352-387`, `README.md:63-69`
- 当前 history 文件解析只读取每行 JSON 的 `input` 字段，符合条件才加入 prompt 列表。Source: `opencode_prompt_finder.js:89-111`
- 当前 DB 查询只选择 `role='user'` 且 `agent IN ('orchestrator','plan','build')` 的消息，再拼接 text part，过滤 synthetic、image、file 类型。Source: `opencode_prompt_finder.js:10`, `opencode_prompt_finder.js:29-58`, `opencode_prompt_finder.js:125-175`
- 当前仓库里还没有 codex / openai provider 识别逻辑。Source: `opencode_prompt_finder.js:1-446`

### Available Approaches
- 方案 A：沿用现有 history 读取路径，新增 Codex history 文件支持。已有开源工具 `ai-hist` 直接从 `~/.codex/history.jsonl` 同步 Codex 历史，并使用 `text`、`ts`、`session_id` 作为关键字段。Source: https://github.com/AgentWorkforce/ai-hist
- 方案 B：支持 Codex sessions 目录扫描。已有工具 `codex-history-viewer` 以 `~/.codex/sessions` 为默认根目录，提供本地 session history 浏览与全文检索。Source: https://github.com/hiztam/codex-history-viewer
- 方案 C：支持 Codex rollout 文件。公开资料显示 Codex CLI session 文件位于 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`，格式为 JSONL。Source: https://dev.to/_46ea277e677b888e0cd13/openai-euphony-a-browser-based-viewer-for-harmony-conversations-and-codex-cli-sessions-5gcn

### Constraints & Dependencies
- 当前 CLI 参数模型围绕单一 source 枚举 `auto|db|history` 和单一 history path 构建，扩展 Codex 时需要决定是新增 source 类型，还是把 Codex 纳入 auto/history 抽象。Source: `opencode_prompt_finder.js:12`, `opencode_prompt_finder.js:275-327`
- 当前 fzf 列表项只保存 prompt 文本与 preview，缺少 source / session 等元数据。如果后续要让 opencode 与 Codex 结果同时可辨识，展示模型需要扩展。Source: `opencode_prompt_finder.js:205-260`
- 当前测试覆盖 opencode history 与 opencode DB 解析，Codex 解析尚无测试夹具。Source: `tests/opencode_prompt_finder.test.js:36-39`, `tests/opencode_prompt_finder.test.js:74-91`, `tests/opencode_prompt_finder.test.js:198-282`
- 当前项目 README 明确宣称目标是 opencode prompt history，文档与 CLI 描述需要同步更新。Source: `README.md:3`, `README.md:10`, `package.json:5`

### Key References
- `opencode_prompt_finder.js:8-10` - 当前默认数据源路径与 agent 白名单
- `opencode_prompt_finder.js:29-58` - SQLite 查询逻辑
- `opencode_prompt_finder.js:89-111` - history JSONL 解析逻辑
- `opencode_prompt_finder.js:125-175` - DB row 过滤与 prompt 拼接逻辑
- `opencode_prompt_finder.js:275-387` - CLI 参数与 source 选择逻辑
- `tests/opencode_prompt_finder.test.js:36-39` - history 解析测试样例
- `tests/opencode_prompt_finder.test.js:74-91` - DB 过滤测试样例
- https://github.com/AgentWorkforce/ai-hist - Codex history 路径与字段
- https://github.com/hiztam/codex-history-viewer - Codex sessions 根目录与本地索引模式
- https://dev.to/_46ea277e677b888e0cd13/openai-euphony-a-browser-based-viewer-for-harmony-conversations-and-codex-cli-sessions-5gcn - rollout 文件路径模式

## Design

### Architecture Overview
```text
CLI args
  -> source selection
  -> source-specific loaders
     - opencode sqlite loader
     - opencode history loader
     - codex history loader
  -> normalized prompt entries
  -> fzf list builder
  -> print / copy selected prompt
```

### Design Decisions
- 决策：本次先支持 Codex `~/.codex/history.jsonl`，暂不实现 `~/.codex/sessions/**/rollout-*.jsonl` 扫描。理由是当前项目已存在“读取单个 history 文件”的实现，Codex `history.jsonl` 也有公开字段约定 `text` / `ts` / `session_id`，实现路径最短。Source: `opencode_prompt_finder.js:89-123`, https://github.com/AgentWorkforce/ai-hist, https://dev.to/_46ea277e677b888e0cd13/openai-euphony-a-browser-based-viewer-for-harmony-conversations-and-codex-cli-sessions-5gcn
- 决策：保留显式 `--source db|history|codex` 的单源语义；`auto` 调整为多源聚合模式：聚合 opencode 侧 + codex 侧。opencode 侧优先 DB，失败/空结果时回退到 opencode history；任一侧不可用、解析失败或空结果均静默跳过。Source: `opencode_prompt_finder.js:12`, `opencode_prompt_finder.js:275-327`, `opencode_prompt_finder.js:352-387`
- 决策：新增独立的 Codex history 默认路径常量与解析函数，沿用当前 opencode history 的“读 JSONL -> 提取 prompt -> recent limit”模式。Source: `opencode_prompt_finder.js:8`, `opencode_prompt_finder.js:77-79`, `opencode_prompt_finder.js:89-123`, https://github.com/AgentWorkforce/ai-hist
- 决策：Codex parser 只提取用户输入 prompt 文本，优先读取 `text` 字段，并忽略无效行与空文本，行为与当前 `parseHistoryLines()` 保持一致。Source: `opencode_prompt_finder.js:89-111`, https://github.com/AgentWorkforce/ai-hist
- 决策：`auto` 模式改为聚合语义：先产出 opencode 侧（DB 优先、history 回退）结果，再叠加 codex 侧结果；仅当两侧都无有效 prompt 才报错。Source: `opencode_prompt_finder.js:15`, `opencode_prompt_finder.js:373-387`
- 决策：聚合结果在进入 fzf 前做“跨来源全局按时间降序”排序（最新在前），不再按来源分组。若缺失时间戳，则排在有时间戳结果之后，并采用稳定的“最近输入优先”兜底顺序。
- 决策：`--agents` 继续仅作用于 SQLite DB 模式，Codex history 模式忽略该参数。Source: `README.md:67`, `tests/opencode_prompt_finder.test.js:107-123`

### Why this design
- 复用现有 JSONL 读取路径，代码改动集中在 source 选择、路径常量、parser、测试和文档。
- 满足“支持 Codex”的核心需求，同时把更复杂的 sessions/rollout 扫描留给后续迭代。
- 保持 CLI 向后兼容，现有 `db` / `history` / `auto` 用户无需调整。

### Implementation Steps
1. 新增 Codex 默认 history 路径解析能力与 JSONL parser。
2. 扩展 CLI 参数解析，支持 `--source codex`。
3. 扩展 `main()` 的 source 选择逻辑，让 `auto` 聚合 opencode 侧与 Codex history 侧结果，并对单侧失败执行静默跳过。
4. 为 Codex parser、CLI source、auto 回退新增测试。
5. 更新 README 与 README_zh，说明 Codex 支持范围和路径。

### Test Strategy
- Parser：增加 `parseCodexHistoryLines()` 单测，覆盖无效 JSON、空字符串、缺失字段、正常 `text` 字段。Source: `tests/opencode_prompt_finder.test.js:9-20`
- Main flow：增加 `auto` 聚合两侧结果、单侧失败静默跳过、双侧都无结果时报错的测试。Source: `tests/opencode_prompt_finder.test.js:251-352`
- Backward compatibility：保留现有 opencode history 与 DB 测试全部通过，确认旧行为稳定。Source: `tests/opencode_prompt_finder.test.js:34-124`, `tests/opencode_prompt_finder.test.js:233-284`

### Pseudocode
Flow:
  parseArgs()
  resolve opencode history path
  resolve opencode db path
  resolve codex history path
  if source == codex:
    load prompts from codex history
  else if source == history:
    load prompts from opencode history
  else if source == db:
    load prompts from opencode db
  else if source == auto:
    load opencode side (db first, fallback history)
    load codex history side
    merge both sides
    if both sides empty -> error
  build fzf items
  select prompt
  print or copy

### File Structure
- `opencode_prompt_finder.js` - 新增 Codex path / parser / source routing
- `tests/opencode_prompt_finder.test.js` - 新增 Codex 解析与主流程测试
- `README.md` - 英文文档更新
- `README_zh.md` - 中文文档更新

### Interfaces / APIs
- `--source <auto|db|history|codex>`
- 可选新增 `resolveCodexHistoryPath(pathArg)`，默认路径 `~/.codex/history.jsonl`
- 可选新增 `parseCodexHistoryLines(lines)` 与 `loadCodexPrompts(historyPath, limit)`

### Edge Cases
- Codex history 文件不存在：`--source codex` 返回清晰错误；`auto` 静默跳过 codex 侧。
- Codex JSONL 行损坏：跳过坏行，保持与现有 history parser 一致。
- `text` 为空或非字符串：跳过。
- 同时存在 opencode 与 Codex 数据：`auto` 聚合两侧结果，显式 source 仍保持单源。

### Plan
- [x] Phase 1: Codex history source support
  - [x] Implement: 增加 Codex 默认路径、parser、loader、CLI source 与 auto 回退
  - [x] Verify: 新增并通过 parser/main 相关测试
- [x] Phase 2: Docs and regression validation
  - [x] Implement: 更新 README 与 README_zh 的参数、路径、示例说明
  - [x] Verify: 运行完整测试并检查 CLI 帮助与文档一致性

## Plan

<!-- Optional: Phase breakdown for complex features that need multiple implementation phases.
     Decided during Design. Checked off during Implement.
     Keep this section compact and phase-based.
     Use markdown checkboxes for all phase items, for example:
     - [ ] Phase 1: Foo
       - [ ] Implement: Foo
       - [ ] Verify: Foo
     - [ ] Phase 2: Bar
       - [ ] Implement: Bar
       - [ ] Verify: Bar
     - [ ] Phase 3: Baz
       - [ ] Implement: Baz
       - [ ] Verify: Baz
     Use a capability-based phase breakdown with reviewable, meaningful increments.
     Good boundaries align with one user-visible workflow, one subsystem/integration boundary, one migration/rollout step, or one stabilization milestone.
     Each implementation phase must include implementation + immediate testing/verification.
     The final phase may focus on overall testing/verification, edge cases, regression coverage, and coverage improvements.
     A phase is complete only when relevant tests pass.
     Size phases so one coding agent can implement + validate in a single session.
     Write each phase to clearly state both implementation scope and verification approach. -->

## Notes

<!-- Optional sections — add what's relevant. -->

### Implementation

<!-- Files created/modified, decisions made during coding, deviations from design -->

- `opencode_prompt_finder.js`
  - 新增 `DEFAULT_CODEX_HISTORY_PATH`（`~/.codex/history.jsonl`）
  - 新增 `resolveCodexHistoryPath()`、`parseCodexHistoryLines()`、`loadCodexPrompts()`
  - `--source` 扩展为 `auto|db|history|codex`
  - `auto` 逻辑调整为：聚合 OpenCode 侧 + Codex 侧；OpenCode 侧为 DB -> OpenCode history 回退；单侧失败静默跳过
  - 内部 prompt 结构升级为 entry（`{prompt, ts, source}`），并在进入 fzf 前统一做全局时间降序排序
  - opencode DB 复用 `message_created_at`；opencode history / codex history 尽量提取 `ts|time_created|created_at|timestamp`
  - 新增 `codex` source 的直接读取分支
  - 更新 usage 文案与导出 API
- `tests/opencode_prompt_finder.test.js`
  - 新增 Codex parser 测试
  - 新增 `resolveCodexHistoryPath` 测试
  - 新增 `parseArgs` 对 `--source codex` 的测试
  - 新增 `main --source codex` 测试
  - 新增 `auto` 聚合/跳过行为测试
  - 新增 auto 混合来源全局排序、单源最新在前、缺失时间戳兜底顺序测试
- `README.md` / `README_zh.md`
  - 更新 source 枚举、auto 聚合与跳过语义、Codex 默认路径说明

### Verification

<!-- How the feature was verified: tests written, manual testing steps, results -->

- 运行：`npm test`
- 结果：全部通过
