#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_HISTORY_PATH = '~/.local/state/opencode/prompt-history.jsonl';
const USAGE = [
  'Usage: opencode-prompt-finder [--path <file>] [--limit <n>] [--print]',
  '',
  'Find and copy opencode prompt history via fzf',
].join('\n');

function resolveHistoryPath(pathArg) {
  const raw = pathArg || DEFAULT_HISTORY_PATH;
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

function sanitizePreview(text) {
  return String(text).trim().split(/\s+/).join(' ');
}

function parseHistoryLines(lines) {
  const prompts = [];
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
      prompts.push(value);
    }
  }
  return prompts;
}

function loadPrompts(historyPath, limit = null) {
  const data = fs.readFileSync(historyPath, { encoding: 'utf8' });
  const prompts = parseHistoryLines(data.split(/\r?\n/));
  if (limit === null || limit === undefined) {
    return prompts;
  }
  if (limit <= 0) {
    return [];
  }
  return prompts.slice(-limit);
}

function buildFzfItems(prompts, limit) {
  if (limit <= 0) {
    return [];
  }
  const selected = prompts.slice(-limit).reverse();
  return selected.map((prompt, idx) => ({
    itemId: idx,
    prompt,
    preview: sanitizePreview(prompt),
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

  return args;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const stderr = deps.stderr || process.stderr;
  const stdout = deps.stdout || process.stdout;
  const existsSync = deps.existsSync || fs.existsSync;
  const loadPromptsFn = deps.loadPrompts || loadPrompts;
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
  if (!existsSync(historyPath)) {
    stderr.write(`History file not found: ${historyPath}\n`);
    return 1;
  }

  const prompts = loadPromptsFn(historyPath, args.limit);
  const items = buildFzfItems(prompts, args.limit);
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
  resolveHistoryPath,
  sanitizePreview,
  parseHistoryLines,
  loadPrompts,
  buildFzfItems,
  buildFzfInput,
  parseSelectedItemId,
  runFzf,
  copyToClipboard,
  parseArgs,
  USAGE,
  main,
};
