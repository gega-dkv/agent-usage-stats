import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function writeDb(relPath, setup) {
  const full = path.join(__dirname, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) fs.unlinkSync(full);
  const db = new Database(full);
  setup(db);
  db.close();
}

writeDb('goose/valid.db', (db) => {
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    model_config_json TEXT,
    provider_name TEXT,
    created_at TEXT
  )`);
  db.prepare(
    `INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'goose-1',
    1000,
    400,
    1550,
    JSON.stringify({ model_name: 'gpt-4o' }),
    'openai',
    '2026-06-18T10:00:00Z',
  );
});

writeDb('goose/missing-fields.db', (db) => {
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, provider_name TEXT)`);
  db.prepare(`INSERT INTO sessions VALUES (?, ?)`).run('goose-2', 'openai');
});

writeDb('goose/corrupt.db', (db) => {
  db.exec(`CREATE TABLE unrelated (id INTEGER)`);
});

writeDb('hermes/valid.db', (db) => {
  db.exec(`CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    reasoning_tokens INTEGER,
    actual_cost REAL,
    estimated_cost REAL,
    message_count INTEGER
  )`);
  db.prepare(`INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'hermes-1',
    'claude-sonnet',
    900,
    300,
    50,
    10,
    25,
    0.04,
    null,
    4,
  );
});

writeDb('hermes/missing-fields.db', (db) => {
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT)`);
  db.prepare(`INSERT INTO sessions VALUES (?, ?)`).run('hermes-2', 'claude');
});

writeDb('hermes/corrupt.db', (db) => {
  db.exec(`CREATE TABLE misc (x TEXT)`);
});

writeDb('kilo/valid.db', (db) => {
  db.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_creation_tokens INTEGER,
    cost REAL,
    created_at TEXT
  )`);
  db.prepare(
    `INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('m1', 'kilo-1', 'user', 'gpt-4o', 500, 0, 0, 0, 0, '2026-06-18T10:00:00Z');
  db.prepare(
    `INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('m2', 'kilo-1', 'assistant', 'gpt-4o', 0, 220, 15, 5, 0.01, '2026-06-18T10:01:00Z');
});

writeDb('kilo/missing-fields.db', (db) => {
  db.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT, role TEXT)`);
  db.prepare(`INSERT INTO messages VALUES (?, ?, ?)`).run('m3', 'kilo-2', 'user');
});

writeDb('kilo/corrupt.db', (db) => {
  db.exec(`CREATE TABLE empty_table (id INTEGER)`);
});

writeDb('opencode/sqlite/valid.db', (db) => {
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY)`);
  db.exec(`CREATE TABLE message (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    role TEXT,
    model TEXT,
    data TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost REAL
  )`);
  db.prepare(`INSERT INTO session VALUES (?)`).run('oc-1');
  db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'msg-1',
    'oc-1',
    'user',
    'gpt-4o',
    JSON.stringify({ content: 'OpenCode sqlite user message' }),
    400,
    0,
    0,
  );
  db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'msg-2',
    'oc-1',
    'assistant',
    'gpt-4o',
    JSON.stringify({ content: 'OpenCode sqlite assistant reply' }),
    0,
    180,
    0,
  );
});

writeDb('opencode/sqlite/missing-fields.db', (db) => {
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY)`);
  db.exec(`CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, role TEXT, data TEXT)`);
  db.prepare(`INSERT INTO session VALUES (?)`).run('oc-2');
  db.prepare(`INSERT INTO message VALUES (?, ?, ?, ?)`).run(
    'msg-3',
    'oc-2',
    'user',
    JSON.stringify({ content: 'no usage columns' }),
  );
});

fs.writeFileSync(path.join(__dirname, 'opencode/sqlite/corrupt.db'), 'not-a-sqlite-database');

writeDb('cursor/valid.db', (db) => {
  db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`);
  db.prepare(`INSERT INTO ItemTable VALUES (?, ?)`).run(
    'composer.chat.history',
    JSON.stringify({
      role: 'user',
      text: 'Refactor charts for accessibility',
      usage: { input_tokens: 120, output_tokens: 0 },
    }),
  );
  db.prepare(`INSERT INTO ItemTable VALUES (?, ?)`).run(
    'composer.chat.assistant',
    JSON.stringify({
      role: 'assistant',
      content: 'Updated chart components.',
      usage: { input_tokens: 0, output_tokens: 80 },
    }),
  );
});

writeDb('cursor/missing-fields.db', (db) => {
  db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`);
  db.prepare(`INSERT INTO ItemTable VALUES (?, ?)`).run(
    'unrelated.key',
    JSON.stringify({ foo: 'bar' }),
  );
});

fs.writeFileSync(path.join(__dirname, 'cursor/corrupt.db'), 'corrupt');

for (const provider of ['goose', 'hermes', 'kilo']) {
  const readme = `# ${provider} parser fixtures (synthetic sqlite)\n\nGenerated by generate-sqlite-fixtures.mjs.\n`;
  fs.writeFileSync(path.join(__dirname, provider, 'README.md'), readme);
}

console.log('SQLite fixtures generated.');
