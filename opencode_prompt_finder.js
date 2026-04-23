#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_HISTORY_PATH = '~/.local/state/opencode/prompt-history.jsonl';
const DEFAULT_DB_PATH = '~/.local/share/opencode/opencode.db';
const DEFAULT_CODEX_HISTORY_PATH = '~/.codex/history.jsonl';
const DEFAULT_TOP_LEVEL_AGENTS = ['orchestrator', 'plan', 'build'];
const USAGE = [
  'Usage: opencode-prompt-finder [--source <auto|db|history|codex>] [--agents <list>] [--db-path <file>] [--path <file>] [--limit <n>] [--print]',
  '',
  'Find and copy opencode/codex prompt history via fzf.',
  'Default source is auto: combine opencode + codex prompts (opencode prefers SQLite DB, falls back to opencode history).',
].join('\n');

function parseAgents(value) {
  const agents = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!agents.length) {
    throw new Error('Invalid value for --agents');
  }
  return [...new Set(agents)];
}

function buildSqlitePromptsSql(limit = null, agents = DEFAULT_TOP_LEVEL_AGENTS) {
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const limitClause = hasLimit ? `LIMIT ${limit}` : '';
  const agentList = agents.map((agent) => `'${agent.replace(/'/g, "''")}'`).join(', ');
  return [
    'WITH recent_messages AS (',
    '  SELECT',
    '    m.id,',
    "    json_extract(m.data, '$.role') AS role,",
    "    json_extract(m.data, '$.agent') AS agent,",
    '    m.time_created AS message_created_at',
    '  FROM message m',
    `  WHERE json_extract(m.data, '$.role') = 'user' AND json_extract(m.data, '$.agent') IN (${agentList})`,
    '  ORDER BY m.time_created DESC, m.id DESC',
    hasLimit ? `  ${limitClause}` : '',
    ')',
    'SELECT',
    '  rm.id AS message_id,',
    '  rm.role AS role,',
    '  rm.agent AS agent,',
    '  rm.message_created_at AS message_created_at,',
    '  p.id AS part_id,',
    '  p.time_created AS part_created_at,',
    "  json_extract(p.data, '$.type') AS part_type,",
    "  json_extract(p.data, '$.text') AS part_text,",
    "  json_extract(p.data, '$.synthetic') AS part_synthetic",
    'FROM recent_messages rm',
    'LEFT JOIN part p ON p.message_id = rm.id',
    'ORDER BY rm.message_created_at, rm.id, p.time_created, p.id;',
  ].filter(Boolean).join(' ');
}

function resolvePathWithHome(pathArg, fallbackPath) {
  const raw = pathArg || fallbackPath;
  if (!raw.startsWith('~')) {
    return path.resolve(raw);
  }

  const home = process.env.HOME || os.homedir();
  if (raw === '~') {
    return home;
  }
  if (raw.startsWith('~/')) {
    return path.join(home, raw.slice(2));
  }
  return path.resolve(raw);
}

function resolveHistoryPath(pathArg) {
  return resolvePathWithHome(pathArg, DEFAULT_HISTORY_PATH);
}

function resolveDbPath(pathArg) {
  return resolvePathWithHome(pathArg, DEFAULT_DB_PATH);
}

function resolveCodexHistoryPath(pathArg) {
  return resolvePathWithHome(pathArg, DEFAULT_CODEX_HISTORY_PATH);
}

function sanitizePreview(text) {
  return String(text).trim().split(/\s+/).join(' ');
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        return num < 1e12 ? Math.trunc(num * 1000) : Math.trunc(num);
      }
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function makeEntry(prompt, ts = null, source = null) {
  return { prompt, ts, source };
}

function parseHistoryLines(lines) {
  return parseHistoryEntryLines(lines).map((entry) => entry.prompt);
}

function parseHistoryEntryLines(lines) {
  const entries = [];
  for (const line of lines) {
    const raw = String(line).trim();
    if (!raw) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const value = row.input;
    if (typeof value === 'string' && value.trim()) {
      const ts = normalizeTimestamp(row.ts ?? row.time_created ?? row.created_at ?? row.timestamp);
      entries.push(makeEntry(value, ts, 'history'));
    }
  }
  return entries;
}

function parseCodexHistoryLines(lines) {
  return parseCodexHistoryEntryLines(lines).map((entry) => entry.prompt);
}

function parseCodexHistoryEntryLines(lines) {
  const entries = [];
  for (const line of lines) {
    const raw = String(line).trim();
    if (!raw) {
      continue;
    }
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      continue;
    }
    const value = row.text;
    if (typeof value === 'string' && value.trim()) {
      const ts = normalizeTimestamp(row.ts ?? row.time_created ?? row.created_at ?? row.timestamp);
      entries.push(makeEntry(value, ts, 'codex'));
    }
  }
  return entries;
}

function applyRecentLimit(items, limit = null) {
  if (limit === null || limit === undefined) {
    return items;
  }
  if (limit <= 0) {
    return [];
  }
  return items.slice(-limit);
}

function loadPromptEntries(historyPath, limit = null) {
  const data = fs.readFileSync(historyPath, { encoding: 'utf8' });
  const entries = parseHistoryEntryLines(data.split(/\r?\n/));
  return applyRecentLimit(entries, limit);
}

function loadPrompts(historyPath, limit = null) {
  return loadPromptEntries(historyPath, limit).map((entry) => entry.prompt);
}

function loadCodexPromptEntries(historyPath, limit = null) {
  const data = fs.readFileSync(historyPath, { encoding: 'utf8' });
  const entries = parseCodexHistoryEntryLines(data.split(/\r?\n/));
  return applyRecentLimit(entries, limit);
}

function loadCodexPrompts(historyPath, limit = null) {
  return loadCodexPromptEntries(historyPath, limit).map((entry) => entry.prompt);
}

function isTextPart(row) {
  const isSynthetic = row && (row.part_synthetic === true || row.part_synthetic === 1 || row.part_synthetic === 'true');
  if (isSynthetic) {
    return false;
  }

  const text = row && row.part_text;
  if (typeof text !== 'string' || !text.trim()) {
    return false;
  }

  const partType = typeof row.part_type === 'string' ? row.part_type.toLowerCase() : '';
  if (partType.includes('image') || partType.includes('file')) {
    return false;
  }
  if (!partType) {
    return true;
  }
  return partType.includes('text');
}

function parseDbRowsToPrompts(rows, limit = null, agents = DEFAULT_TOP_LEVEL_AGENTS) {
  return parseDbRowsToPromptEntries(rows, limit, agents).map((entry) => entry.prompt);
}

function parseDbRowsToPromptEntries(rows, limit = null, agents = DEFAULT_TOP_LEVEL_AGENTS) {
  const grouped = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    if (row.role !== 'user' || !agents.includes(row.agent)) {
      continue;
    }
    if (!isTextPart(row)) {
      continue;
    }
    const key = String(row.message_id);
    const existing = grouped.get(key) || { parts: [], ts: normalizeTimestamp(row.message_created_at) };
    existing.parts.push(row.part_text);
    if (existing.ts === null) {
      existing.ts = normalizeTimestamp(row.message_created_at);
    }
    grouped.set(key, existing);
  }

  const entries = Array.from(grouped.values())
    .map(({ parts, ts }) => makeEntry(parts.join(''), ts, 'db'))
    .filter((value) => typeof value.prompt === 'string' && value.prompt.trim());

  return applyRecentLimit(entries, limit);
}

function loadPromptsFromDb(dbPath, limit = null, deps = {}, agents = DEFAULT_TOP_LEVEL_AGENTS) {
  return loadPromptEntriesFromDb(dbPath, limit, deps, agents).map((entry) => entry.prompt);
}

function loadPromptEntriesFromDb(dbPath, limit = null, deps = {}, agents = DEFAULT_TOP_LEVEL_AGENTS) {
  const run = deps.spawnSync || spawnSync;
  const proc = run('sqlite3', ['-json', dbPath, buildSqlitePromptsSql(limit, agents)], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (proc.error && proc.error.code === 'ENOENT') {
    const err = new Error('sqlite3 is not installed or not in PATH.');
    err.code = 'ENOENT';
    throw err;
  }
  if (proc.status !== 0) {
    const stderr = (proc.stderr || '').toString().trim();
    throw new Error(`Failed to query SQLite DB (exit code ${proc.status}): ${stderr}`);
  }

  let rows;
  try {
    rows = JSON.parse((proc.stdout || '').toString() || '[]');
  } catch {
    throw new Error('Failed to parse SQLite query output.');
  }
  if (!Array.isArray(rows)) {
    throw new Error('Unexpected SQLite query output format.');
  }
  return parseDbRowsToPromptEntries(rows, limit, agents);
}

function toPromptEntries(items, source = null) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item) => {
      if (typeof item === 'string') {
        return makeEntry(item, null, source);
      }
      if (item && typeof item === 'object' && typeof item.prompt === 'string') {
        return makeEntry(item.prompt, normalizeTimestamp(item.ts), item.source || source);
      }
      return null;
    })
    .filter((item) => item && item.prompt.trim());
}

function sortEntriesNewestFirst(entries) {
  return entries
    .map((entry, idx) => ({ ...entry, __idx: idx }))
    .sort((a, b) => {
      const aHasTs = a.ts !== null;
      const bHasTs = b.ts !== null;
      if (aHasTs && bHasTs) {
        if (a.ts !== b.ts) {
          return b.ts - a.ts;
        }
        return b.__idx - a.__idx;
      }
      if (aHasTs !== bHasTs) {
        return aHasTs ? -1 : 1;
      }
      return b.__idx - a.__idx;
    })
    .map(({ __idx, ...entry }) => entry);
}

function buildFzfItems(promptsOrEntries, limit) {
  if (limit <= 0) {
    return [];
  }
  const entries = toPromptEntries(promptsOrEntries);
  const selected = sortEntriesNewestFirst(entries).slice(0, limit);
  return selected.map((entry, idx) => ({
    itemId: idx,
    prompt: entry.prompt,
    preview: sanitizePreview(entry.prompt),
  }));
}

function buildFzfInput(items) {
  return items.map((item) => `${item.itemId}\t${item.preview}`).join('\n');
}

function parseSelectedItemId(selectedLine) {
  const [first] = String(selectedLine).split('\t', 1);
  return Number.parseInt(first.trim(), 10);
}

function runFzf(items, deps = {}) {
  if (!items.length) {
    return null;
  }

  const run = deps.spawnSync || spawnSync;
  const proc = run('fzf', ['--delimiter', '\t', '--with-nth', '2..', '--prompt', 'Prompt> '], {
    input: buildFzfInput(items),
    encoding: 'utf8',
  });

  if (proc.error && proc.error.code === 'ENOENT') {
    const err = new Error('fzf is not installed or not in PATH.');
    err.code = 'ENOENT';
    throw err;
  }

  if (proc.status === 130) {
    return null;
  }
  if (proc.status !== 0) {
    const stderr = (proc.stderr || '').toString().trim();
    throw new Error(`fzf failed with exit code ${proc.status}: ${stderr}`);
  }

  const selected = (proc.stdout || '').toString().trim();
  if (!selected) {
    return null;
  }

  const itemId = parseSelectedItemId(selected);
  if (!Number.isInteger(itemId) || itemId < 0 || itemId >= items.length) {
    throw new Error('fzf selection out of range');
  }
  return items[itemId].prompt;
}

function copyToClipboard(text, deps = {}) {
  const run = deps.spawnSync || spawnSync;
  const proc = run('pbcopy', [], { input: text, encoding: 'utf8' });
  if (proc.error && proc.error.code === 'ENOENT') {
    throw new Error('pbcopy is not available on this system. Use --print to output the selected prompt.');
  }
  if (proc.status !== 0) {
    const err = (proc.stderr || '').toString().trim();
    throw new Error(`Failed to copy prompt with pbcopy (exit code ${proc.status}). ${err} Use --print to output instead.`);
  }
}

function parseArgs(argv) {
  const args = {
    path: DEFAULT_HISTORY_PATH,
    dbPath: DEFAULT_DB_PATH,
    source: 'auto',
    agents: [...DEFAULT_TOP_LEVEL_AGENTS],
    printMode: false,
    limit: 200,
    help: false,
  };

  const requireValue = (flag, index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--print') {
      args.printMode = true;
    } else if (arg === '--path') {
      args.path = requireValue(arg, i);
      i += 1;
    } else if (arg === '--db-path') {
      args.dbPath = requireValue(arg, i);
      i += 1;
    } else if (arg === '--agents') {
      args.agents = parseAgents(requireValue(arg, i));
      i += 1;
    } else if (arg === '--source') {
      args.source = requireValue(arg, i);
      i += 1;
    } else if (arg === '--limit') {
      args.limit = Number.parseInt(requireValue(arg, i), 10);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.limit)) {
    throw new Error('Invalid value for --limit');
  }
  if (!['auto', 'db', 'history', 'codex'].includes(args.source)) {
    throw new Error('Invalid value for --source (expected auto, db, history, or codex)');
  }

  return args;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const stderr = deps.stderr || process.stderr;
  const stdout = deps.stdout || process.stdout;
  const existsSync = deps.existsSync || fs.existsSync;
  const loadPromptsFn = deps.loadPrompts || loadPromptEntries;
  const loadCodexPromptsFn = deps.loadCodexPrompts || loadCodexPromptEntries;
  const loadPromptsFromDbFn = deps.loadPromptsFromDb || loadPromptEntriesFromDb;
  const runFzfFn = deps.runFzf || runFzf;
  const copyToClipboardFn = deps.copyToClipboard || copyToClipboard;

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 2;
  }

  if (args.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const historyPath = resolveHistoryPath(args.path);
  const dbPath = resolveDbPath(args.dbPath);
  const codexHistoryPath = resolveCodexHistoryPath();

  let entries = [];
  let fzfLimit = args.limit;
  if (args.source === 'history') {
    if (!existsSync(historyPath)) {
      stderr.write(`History file not found: ${historyPath}\n`);
      return 1;
    }
    entries = toPromptEntries(loadPromptsFn(historyPath, args.limit), 'history');
  } else if (args.source === 'codex') {
    if (!existsSync(codexHistoryPath)) {
      stderr.write(`Codex history file not found: ${codexHistoryPath}\n`);
      return 1;
    }
    entries = toPromptEntries(loadCodexPromptsFn(codexHistoryPath, args.limit), 'codex');
  } else if (args.source === 'db') {
    if (!existsSync(dbPath)) {
      stderr.write(`SQLite DB not found: ${dbPath}\n`);
      return 1;
    }
    try {
      entries = toPromptEntries(loadPromptsFromDbFn(dbPath, args.limit, deps, args.agents), 'db');
    } catch (err) {
      stderr.write(`${err.message}\n`);
      return 1;
    }
  } else {
    let opencodePrompts = [];
    if (existsSync(dbPath)) {
      try {
        opencodePrompts = loadPromptsFromDbFn(dbPath, args.limit, deps, args.agents);
      } catch {
        opencodePrompts = [];
      }
    }
    if (!opencodePrompts.length && existsSync(historyPath)) {
      try {
        opencodePrompts = loadPromptsFn(historyPath, args.limit);
      } catch {
        opencodePrompts = [];
      }
    }

    let codexPrompts = [];
    if (existsSync(codexHistoryPath)) {
      try {
        codexPrompts = loadCodexPromptsFn(codexHistoryPath, args.limit);
      } catch {
        codexPrompts = [];
      }
    }

    entries = toPromptEntries(opencodePrompts, 'opencode').concat(toPromptEntries(codexPrompts, 'codex'));
    fzfLimit = entries.length;

    if (!entries.length) {
      if (!existsSync(historyPath) && !existsSync(codexHistoryPath)) {
        stderr.write(`No prompt source found. Tried DB: ${dbPath}, history: ${historyPath}, codex history: ${codexHistoryPath}\n`);
      } else {
        stderr.write('No valid prompt history found.\n');
      }
      return 1;
    }
  }

  const items = buildFzfItems(entries, fzfLimit);
  if (!items.length) {
    stderr.write('No valid prompt history found.\n');
    return 1;
  }

  let selected;
  try {
    selected = runFzfFn(items);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  if (selected === null) {
    return 130;
  }

  if (args.printMode) {
    stdout.write(`${selected}\n`);
    return 0;
  }

  try {
    copyToClipboardFn(selected);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  return 0;
}

module.exports = {
  DEFAULT_HISTORY_PATH,
  DEFAULT_DB_PATH,
  DEFAULT_CODEX_HISTORY_PATH,
  DEFAULT_TOP_LEVEL_AGENTS,
  parseAgents,
  buildSqlitePromptsSql,
  resolvePathWithHome,
  resolveHistoryPath,
  resolveDbPath,
  resolveCodexHistoryPath,
  sanitizePreview,
  parseHistoryLines,
  parseHistoryEntryLines,
  parseCodexHistoryLines,
  parseCodexHistoryEntryLines,
  normalizeTimestamp,
  makeEntry,
  applyRecentLimit,
  loadPromptEntries,
  loadPrompts,
  loadCodexPromptEntries,
  loadCodexPrompts,
  isTextPart,
  parseDbRowsToPromptEntries,
  parseDbRowsToPrompts,
  loadPromptEntriesFromDb,
  loadPromptsFromDb,
  toPromptEntries,
  sortEntriesNewestFirst,
  buildFzfItems,
  buildFzfInput,
  parseSelectedItemId,
  runFzf,
  copyToClipboard,
  parseArgs,
  USAGE,
  main,
};
