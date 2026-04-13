const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const finder = require('../opencode_prompt_finder');

test('parseHistoryLines skips invalid and keeps input', () => {
  const lines = [
    '',
    'not-json',
    '[]',
    '{"input": "first"}',
    '{"input": "   "}',
    '{"input": 123}',
    '{"mode": "chat"}',
    '{"input": "second\\nline"}',
  ];
  assert.deepEqual(finder.parseHistoryLines(lines), ['first', 'second\nline']);
});

test('sanitizePreview single line', () => {
  assert.equal(finder.sanitizePreview('a\n\tb   c'), 'a b c');
});

test('buildFzfItems recent first and limit', () => {
  const prompts = ['old', 'mid', 'new'];
  const items = finder.buildFzfItems(prompts, 2);
  assert.deepEqual(items.map((i) => i.prompt), ['new', 'mid']);
  assert.deepEqual(items.map((i) => i.itemId), [0, 1]);
});

test('loadPrompts keeps only recent limit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-'));
  const history = path.join(tmp, 'prompt-history.jsonl');
  fs.writeFileSync(history, '{"input":"old"}\n{"input":"mid"}\n{"input":"new"}\n', 'utf8');

  assert.deepEqual(finder.loadPrompts(history, 2), ['mid', 'new']);
});

test('resolveHistoryPath expands home', () => {
  const prevHome = process.env.HOME;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-home-'));
  process.env.HOME = tmp;
  try {
    const out = finder.resolveHistoryPath('~/.local/state/opencode/prompt-history.jsonl');
    assert.equal(out, path.join(tmp, '.local/state/opencode/prompt-history.jsonl'));
  } finally {
    process.env.HOME = prevHome;
  }
});

test('resolveDbPath expands home', () => {
  const prevHome = process.env.HOME;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-home-db-'));
  process.env.HOME = tmp;
  try {
    const out = finder.resolveDbPath('~/.local/share/opencode/opencode.db');
    assert.equal(out, path.join(tmp, '.local/share/opencode/opencode.db'));
  } finally {
    process.env.HOME = prevHome;
  }
});

test('parseAgents parses comma-separated agent list', () => {
  assert.deepEqual(finder.parseAgents('orchestrator, plan,build,plan'), ['orchestrator', 'plan', 'build']);
});

test('parseAgents rejects empty agent list', () => {
  assert.throws(() => finder.parseAgents(' , '), /Invalid value for --agents/);
});

test('parseDbRowsToPrompts keeps top-level user text parts only', () => {
  const rows = [
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'Hello ' },
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'world' },
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'synthetic', part_synthetic: true },
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'image', part_text: 'ignore image' },
    { message_id: '2', role: 'user', agent: 'worker', part_type: 'text', part_text: 'delegated' },
    { message_id: '3', role: 'user', agent: 'orchestrator', part_type: 'file', part_text: 'ignore file' },
    { message_id: '4', role: 'assistant', agent: 'orchestrator', part_type: 'text', part_text: 'assistant text' },
    { message_id: '5', role: 'user', agent: 'orchestrator', part_type: 'input_text', part_text: 'pasted' },
    { message_id: '8', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'normal text', part_synthetic: false },
    { message_id: '9', role: 'user', agent: 'orchestrator', part_type: 'input_text', part_text: 'normal input', part_synthetic: 0 },
    { message_id: '6', role: 'user', agent: 'build', part_type: 'text', part_text: 'build prompt' },
    { message_id: '7', role: 'user', agent: 'plan', part_type: 'text', part_text: 'plan prompt' },
  ];

  assert.deepEqual(finder.parseDbRowsToPrompts(rows), ['Hello world', 'pasted', 'normal text', 'normal input', 'build prompt', 'plan prompt']);
});

test('loadPromptsFromDb parses sqlite3 json output', () => {
  const rows = [
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'a' },
    { message_id: '1', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'b' },
    { message_id: '2', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'c' },
  ];

  const prompts = finder.loadPromptsFromDb('/tmp/does-not-matter.db', 1, {
    spawnSync: () => ({ status: 0, stdout: JSON.stringify(rows), stderr: '' }),
  });

  assert.deepEqual(prompts, ['c']);
});

test('loadPromptsFromDb passes agent list into SQL and filtering', () => {
  let capturedSql = '';
  const rows = [
    { message_id: '1', role: 'user', agent: 'plan', part_type: 'text', part_text: 'plan only' },
    { message_id: '2', role: 'user', agent: 'orchestrator', part_type: 'text', part_text: 'skip orchestrator' },
  ];

  const prompts = finder.loadPromptsFromDb('/tmp/does-not-matter.db', null, {
    spawnSync: (_cmd, args) => {
      capturedSql = args[2];
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    },
  }, ['plan']);

  assert.match(capturedSql, /IN \('plan'\)/);
  assert.match(capturedSql, /\$\.synthetic/);
  assert.deepEqual(prompts, ['plan only']);
});

test('parseArgs accepts source and db-path', () => {
  const args = finder.parseArgs(['--source', 'db', '--db-path', '/tmp/opencode.db', '--limit', '20']);
  assert.equal(args.source, 'db');
  assert.equal(args.dbPath, '/tmp/opencode.db');
  assert.equal(args.limit, 20);
});

test('parseArgs accepts agents', () => {
  const args = finder.parseArgs(['--agents', 'orchestrator,plan,build']);
  assert.deepEqual(args.agents, ['orchestrator', 'plan', 'build']);
});

test('parseArgs rejects invalid source', () => {
  assert.throws(() => finder.parseArgs(['--source', 'weird']), /Invalid value for --source/);
});

test('parseSelectedItemId', () => {
  assert.equal(finder.parseSelectedItemId('12\tpreview text'), 12);
});

test('runFzf cancel returns null', () => {
  const items = [{ itemId: 0, prompt: 'hello', preview: 'hello' }];
  const selected = finder.runFzf(items, {
    spawnSync: () => ({ status: 130, stdout: '', stderr: '' }),
  });
  assert.equal(selected, null);
});

test('runFzf selects prompt', () => {
  const items = [
    { itemId: 0, prompt: 'p0', preview: 'p0' },
    { itemId: 1, prompt: 'p1', preview: 'p1' },
  ];

  const selected = finder.runFzf(items, {
    spawnSync: () => ({ status: 0, stdout: '1\tpreview\n', stderr: '' }),
  });
  assert.equal(selected, 'p1');
});

test('copyToClipboard pbcopy missing', () => {
  assert.throws(
    () => finder.copyToClipboard('x', { spawnSync: () => ({ error: { code: 'ENOENT' } }) }),
    /--print/
  );
});

test('main help prints usage', () => {
  let out = '';
  let err = '';
  const code = finder.main(['--help'], {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });

  assert.equal(code, 0);
  assert.match(out, /Usage: opencode-prompt-finder/);
  assert.equal(err, '');
});

test('main errors when --path value is missing', () => {
  let err = '';
  const code = finder.main(['--path'], {
    stderr: { write: (s) => { err += s; } },
  });

  assert.equal(code, 2);
  assert.match(err, /Missing value for --path/);
});

test('main reports missing fzf', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-fzf-'));
  const history = path.join(tmp, 'prompt-history.jsonl');
  fs.writeFileSync(history, '{"input":"first"}\n', 'utf8');

  let err = '';
  const code = finder.main(['--path', history, '--print'], {
    stderr: { write: (s) => { err += s; } },
    runFzf: () => {
      const error = new Error('fzf is not installed or not in PATH.');
      error.code = 'ENOENT';
      throw error;
    },
  });

  assert.equal(code, 1);
  assert.match(err, /fzf is not installed or not in PATH/);
});

test('main reports pbcopy missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-pbcopy-'));
  const history = path.join(tmp, 'prompt-history.jsonl');
  fs.writeFileSync(history, '{"input":"first"}\n', 'utf8');

  let err = '';
  const code = finder.main(['--path', history], {
    stderr: { write: (s) => { err += s; } },
    runFzf: () => 'first',
    copyToClipboard: () => {
      throw new Error('pbcopy is not available on this system. Use --print to output the selected prompt.');
    },
  });

  assert.equal(code, 1);
  assert.match(err, /pbcopy is not available/);
});

test('main print mode with tempfile', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opf-main-'));
  const history = path.join(tmp, 'prompt-history.jsonl');
  fs.writeFileSync(history, '{"input":"first"}\n{"input":"second"}\n', 'utf8');

  let out = '';
  let err = '';
  const code = finder.main(['--path', history, '--print', '--limit', '1'], {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    runFzf: () => 'second',
  });

  assert.equal(code, 0);
  assert.equal(out.trim(), 'second');
  assert.equal(err, '');
});

test('main db mode prints selected prompt', () => {
  let out = '';
  let err = '';
  const code = finder.main(['--source', 'db', '--db-path', '/tmp/opencode.db', '--print'], {
    existsSync: (p) => p === '/tmp/opencode.db',
    loadPromptsFromDb: () => ['from db'],
    runFzf: () => 'from db',
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });

  assert.equal(code, 0);
  assert.equal(out.trim(), 'from db');
  assert.equal(err, '');
});

test('main auto mode falls back to history when db is unavailable', () => {
  let out = '';
  let err = '';
  const code = finder.main(['--source', 'auto', '--print'], {
    existsSync: (p) => p.endsWith('prompt-history.jsonl'),
    loadPromptsFromDb: () => {
      throw new Error('db query failed');
    },
    loadPrompts: () => ['from history'],
    runFzf: () => 'from history',
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });

  assert.equal(code, 0);
  assert.equal(out.trim(), 'from history');
  assert.equal(err, '');
});
