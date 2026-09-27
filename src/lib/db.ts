import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "oyoi.sqlite");

export type MessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  body: string;
  quick_replies: string[] | null;
  created_at: string;
};

export type ActionRunRow = {
  id: string;
  kind: string;
  status:
    | "awaiting_confirmation"
    | "awaiting_change_details"
    | "running"
    | "done"
    | "failed"
    | "cancelled";
  summary: string;
  payload: string;
  result: string | null;
  browser_live_url: string | null;
  created_at: string;
  updated_at: string;
};

type GlobalDb = { __oyoiDb?: Database.Database };

function getDb(): Database.Database {
  const g = globalThis as unknown as GlobalDb;
  if (g.__oyoiDb) return g.__oyoiDb;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS action_runs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload TEXT NOT NULL,
      result TEXT,
      browser_live_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_actions_status ON action_runs(status);
  `);

  const cols = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "quick_replies")) {
    db.exec(`ALTER TABLE messages ADD COLUMN quick_replies TEXT`);
  }

  g.__oyoiDb = db;
  return db;
}

export function resetDb() {
  const g = globalThis as unknown as GlobalDb;
  g.__oyoiDb?.close();
  g.__oyoiDb = undefined;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
  }
}

export function logMessage(msg: {
  id: string;
  direction: MessageRow["direction"];
  from_number: string;
  to_number: string;
  body: string;
  quick_replies?: string[];
}) {
  const created_at = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO messages (id, direction, from_number, to_number, body, quick_replies, created_at)
       VALUES (@id, @direction, @from_number, @to_number, @body, @quick_replies, @created_at)`
    )
    .run({
      ...msg,
      quick_replies: msg.quick_replies?.length ? JSON.stringify(msg.quick_replies) : null,
      created_at,
    });
}

export function listMessages(limit = 100): MessageRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM messages ORDER BY created_at ASC LIMIT ?`)
    .all(limit) as Array<Omit<MessageRow, "quick_replies"> & { quick_replies: string | null }>;
  return rows.map((r) => ({
    ...r,
    quick_replies: r.quick_replies ? (JSON.parse(r.quick_replies) as string[]) : null,
  }));
}

export function createActionRun(input: {
  id: string;
  kind: string;
  status: ActionRunRow["status"];
  summary: string;
  payload: unknown;
  result?: string | null;
  browser_live_url?: string | null;
}): ActionRunRow {
  const now = new Date().toISOString();
  const row: ActionRunRow = {
    id: input.id,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    payload: JSON.stringify(input.payload ?? {}),
    result: input.result ?? null,
    browser_live_url: input.browser_live_url ?? null,
    created_at: now,
    updated_at: now,
  };
  getDb()
    .prepare(
      `INSERT INTO action_runs (id, kind, status, summary, payload, result, browser_live_url, created_at, updated_at)
       VALUES (@id, @kind, @status, @summary, @payload, @result, @browser_live_url, @created_at, @updated_at)`
    )
    .run(row);
  return row;
}

export function updateActionRun(
  id: string,
  patch: Partial<Pick<ActionRunRow, "status" | "summary" | "result" | "browser_live_url" | "payload">>
) {
  const existing = getActionRun(id);
  if (!existing) return null;
  const updated: ActionRunRow = {
    ...existing,
    ...patch,
    payload: patch.payload ?? existing.payload,
    updated_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `UPDATE action_runs SET status=@status, summary=@summary, payload=@payload, result=@result,
       browser_live_url=@browser_live_url, updated_at=@updated_at WHERE id=@id`
    )
    .run(updated);
  return updated;
}

export function getActionRun(id: string): ActionRunRow | undefined {
  return getDb().prepare(`SELECT * FROM action_runs WHERE id = ?`).get(id) as ActionRunRow | undefined;
}

export function listActionRuns(limit = 50): ActionRunRow[] {
  return getDb()
    .prepare(`SELECT * FROM action_runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as ActionRunRow[];
}

const PENDING_STATUSES = `('awaiting_confirmation', 'awaiting_change_details')`;

export function getPendingAction(): ActionRunRow | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM action_runs WHERE status IN ${PENDING_STATUSES} ORDER BY created_at DESC LIMIT 1`
    )
    .get() as ActionRunRow | undefined;
}

export function cancelPendingActions() {
  getDb()
    .prepare(
      `UPDATE action_runs SET status = 'cancelled', updated_at = ? WHERE status IN ${PENDING_STATUSES}`
    )
    .run(new Date().toISOString());
}
