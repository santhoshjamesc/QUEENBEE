import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const MIGRATIONS: string[] = [
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, cwd TEXT NOT NULL, model TEXT,
     status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER
   );
   CREATE TABLE events (
     session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts INTEGER NOT NULL,
     type TEXT NOT NULL, subtype TEXT, payload TEXT NOT NULL,
     PRIMARY KEY (session_id, seq)
   );
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
  `ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'plain';
   CREATE TABLE decisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts INTEGER NOT NULL,
     kind TEXT NOT NULL, summary TEXT NOT NULL, outcome TEXT NOT NULL
   );`,
  `CREATE TABLE tasks (
     run_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, scope TEXT NOT NULL, checks TEXT NOT NULL,
     status TEXT NOT NULL, assignee TEXT, summary TEXT, verification TEXT, updated_at INTEGER NOT NULL,
     PRIMARY KEY (run_id, id)
   );
   CREATE TABLE task_deps (run_id TEXT NOT NULL, task_id TEXT NOT NULL, dep_id TEXT NOT NULL, PRIMARY KEY (run_id, task_id, dep_id));
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, ts INTEGER NOT NULL,
     from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL
   );`,
  `CREATE TABLE alerts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, session_id TEXT, task_id TEXT, ts INTEGER NOT NULL,
     rule TEXT NOT NULL, confidence TEXT NOT NULL, response TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
   );
   CREATE TABLE file_activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, ts INTEGER NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
     source TEXT NOT NULL, sessions TEXT NOT NULL, certain INTEGER NOT NULL
   );`,
  `CREATE TABLE skills_index (
     id TEXT PRIMARY KEY, scope TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
     description TEXT NOT NULL, hash TEXT NOT NULL, mtime INTEGER NOT NULL, seen_at INTEGER NOT NULL
   );
   CREATE TABLE skill_versions (
     id INTEGER PRIMARY KEY AUTOINCREMENT, skill_id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL,
     files TEXT NOT NULL, ts INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL
   );
   CREATE UNIQUE INDEX skill_versions_uq ON skill_versions (skill_id, version);
   CREATE TABLE skill_assignments (
     run_id TEXT NOT NULL, task_id TEXT NOT NULL, skill_name TEXT NOT NULL, skill_id TEXT NOT NULL,
     PRIMARY KEY (run_id, task_id, skill_name)
   );`,
  `CREATE TABLE code_files (root TEXT NOT NULL, path TEXT NOT NULL, lang TEXT NOT NULL, hash TEXT NOT NULL, size INTEGER NOT NULL, indexed_at INTEGER NOT NULL, parse_error INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (root, path));
   CREATE TABLE code_symbols (
     id INTEGER PRIMARY KEY AUTOINCREMENT, root TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
     line INTEGER NOT NULL, end_line INTEGER NOT NULL, exported INTEGER NOT NULL, parent TEXT, norm_hash TEXT, exact_hash TEXT, lines INTEGER NOT NULL
   );
   CREATE INDEX code_symbols_name ON code_symbols (root, name);
   CREATE INDEX code_symbols_path ON code_symbols (root, path);
   CREATE TABLE code_refs (root TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, lines TEXT NOT NULL, count INTEGER NOT NULL);
   CREATE INDEX code_refs_name ON code_refs (root, name);
   CREATE INDEX code_refs_path ON code_refs (root, path);
   CREATE TABLE code_imports (root TEXT NOT NULL, path TEXT NOT NULL, spec TEXT NOT NULL, resolved TEXT, names TEXT NOT NULL, line INTEGER NOT NULL);
   CREATE INDEX code_imports_path ON code_imports (root, path);
   CREATE INDEX code_imports_resolved ON code_imports (root, resolved);`,
  // v7: hires (staff of a Queen's run), boss chat log
  `CREATE TABLE hires (
     id TEXT NOT NULL, run_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, look INTEGER NOT NULL,
     cost INTEGER NOT NULL, ts INTEGER NOT NULL, session_id TEXT, PRIMARY KEY (run_id, id)
   );
   CREATE TABLE chat (
     id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, thread TEXT NOT NULL, ts INTEGER NOT NULL,
     from_id TEXT NOT NULL, to_id TEXT NOT NULL, body TEXT NOT NULL
   );
   CREATE INDEX chat_run ON chat (run_id, id);`,
  // v8: configurable hires. The roster is company-wide (shared by every window); run_id is only where the hire was created.
  `ALTER TABLE hires ADD COLUMN focus TEXT NOT NULL DEFAULT '';
   ALTER TABLE hires ADD COLUMN instructions TEXT NOT NULL DEFAULT '';
   ALTER TABLE hires ADD COLUMN allow TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE hires ADD COLUMN deny TEXT NOT NULL DEFAULT '[]';`
]

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)')
  const row = db.prepare('SELECT MAX(v) AS v FROM schema_version').get() as { v: number | null }
  let current = row.v ?? 0
  while (current < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[current])
      current++
      db.prepare('INSERT INTO schema_version (v) VALUES (?)').run(current)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}
