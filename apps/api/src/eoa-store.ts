import { chmodSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { stringify } from "@voxy/chain";
import { parseEther } from "viem";

export const eoaStateDirectory = () =>
  resolve(process.env.VOXY_STATE_DIR || fileURLToPath(new URL("../../../.voxy/", import.meta.url)));
let connection: DatabaseSync | undefined;
export function eoaDB() {
  if (connection) return connection;
  const directory = eoaStateDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = resolve(directory, "eoa.sqlite");
  connection = new DatabaseSync(path);
  chmodSync(path, 0o600);
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS eoa_operations (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, body TEXT NOT NULL, phase TEXT NOT NULL,
      hash TEXT, raw TEXT, nonce INTEGER, fee_cap TEXT, created INTEGER NOT NULL, error TEXT
    );
    CREATE TABLE IF NOT EXISTS eoa_requests (
      id TEXT PRIMARY KEY, account TEXT NOT NULL, controller TEXT NOT NULL, message TEXT NOT NULL,
      guardians TEXT NOT NULL, deadline INTEGER NOT NULL, created INTEGER NOT NULL, arkiv_key TEXT
    );
    CREATE INDEX IF NOT EXISTS eoa_requests_account ON eoa_requests(account);
    CREATE TABLE IF NOT EXISTS eoa_approvals (
      request_id TEXT NOT NULL, guardian TEXT NOT NULL, signature TEXT NOT NULL, arkiv_key TEXT,
      PRIMARY KEY(request_id, guardian)
    );
    CREATE TABLE IF NOT EXISTS eoa_arkiv_reservations (id TEXT PRIMARY KEY, day INTEGER NOT NULL, cap TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS eoa_rate_limits (scope TEXT PRIMARY KEY, count INTEGER NOT NULL, reset INTEGER NOT NULL);
  `);
  return connection;
}
export function attempt(scope: string, limit: number, windowSeconds: number) {
  const db = eoaDB();
  const now = Math.floor(Date.now() / 1000);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT count, reset FROM eoa_rate_limits WHERE scope=?").get(scope) as
      | { count: number; reset: number }
      | undefined;
    if (row && row.reset > now && row.count >= limit)
      throw new Error("Too many attempts. Try again later.");
    db.prepare(
      "INSERT INTO eoa_rate_limits VALUES(?,?,?) ON CONFLICT(scope) DO UPDATE SET count=excluded.count, reset=excluded.reset",
    ).run(
      scope,
      row && row.reset > now ? row.count + 1 : 1,
      row && row.reset > now ? row.reset : now + windowSeconds,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function storedRequest(id: string) {
  const row = eoaDB().prepare("SELECT * FROM eoa_requests WHERE id=?").get(id);
  if (!row) throw new Error("Recovery request not found");
  return {
    id: String(row.id),
    account: String(row.account),
    controller: String(row.controller),
    message: JSON.parse(String(row.message)),
    guardians: JSON.parse(String(row.guardians)) as string[],
    deadline: Number(row.deadline),
    created: Number(row.created),
    arkivKey: row.arkiv_key ? String(row.arkiv_key) : undefined,
  };
}
export function saveRequest(input: {
  id: string;
  account: string;
  controller: string;
  message: unknown;
  guardians: string[];
  deadline: number;
}) {
  const existing = eoaDB().prepare("SELECT message FROM eoa_requests WHERE id=?").get(input.id);
  if (existing && existing.message !== stringify(input.message))
    throw new Error("Request ID conflicts with a different request");
  eoaDB()
    .prepare(
      "INSERT OR IGNORE INTO eoa_requests(id, account, controller, message, guardians, deadline, created) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      input.id,
      input.account,
      input.controller,
      stringify(input.message),
      stringify(input.guardians),
      input.deadline,
      Date.now(),
    );
  return storedRequest(input.id);
}

/** Conservative, persisted budget reservation before any new native Arkiv admission. */
export function reserveArkiv(id: string) {
  const db = eoaDB();
  const day = Math.floor(Date.now() / 86400000);
  const cap = parseEther(process.env.ARKIV_MAX_TX_COST_TGLM || "0.01");
  const maximum = parseEther(process.env.VOXY_ARKIV_DAILY_TGLM || "0.1");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT id FROM eoa_arkiv_reservations WHERE id=?").get(id)) {
      const rows = db.prepare("SELECT cap FROM eoa_arkiv_reservations WHERE day=?").all(day);
      if (
        cap <= 0n ||
        rows.reduce((total, row) => total + BigInt(String(row.cap)), 0n) + cap > maximum
      )
        throw new Error("Daily coordination sponsorship budget reached");
      db.prepare("INSERT INTO eoa_arkiv_reservations VALUES(?,?,?)").run(id, day, cap.toString());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
