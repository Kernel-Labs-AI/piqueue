import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { config } from "../config.js";
import * as schema from "./schema.js";
import { mkdirSync } from "fs";
import { dirname } from "path";

// Ensure data directory exists
mkdirSync(dirname(config.databasePath), { recursive: true });

const sqlite = new Database(config.databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// Auto-create tables on import
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,

    awt_task_id TEXT,
    worktree_path TEXT,
    git_branch TEXT,
    output TEXT,
    error TEXT,
    exit_code INTEGER,

    metadata TEXT,

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    archived_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    stream TEXT NOT NULL,
    event_type TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT,
    payload TEXT NOT NULL,
    text_delta TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_task_seq
    ON task_events(task_id, seq);
  CREATE INDEX IF NOT EXISTS idx_task_events_task_created
    ON task_events(task_id, created_at);
`);

// Add new columns to existing databases
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN pull_request_url TEXT;`);
} catch {
  // Column already exists
}
try {
  sqlite.exec(`ALTER TABLE tasks ADD COLUMN archived_at TEXT;`);
} catch {
  // Column already exists
}
try {
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived_at);`);
} catch {
  // Index already exists
}
