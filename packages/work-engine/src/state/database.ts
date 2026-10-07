import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { STATE } from '../lib/paths';
export function database() {
  mkdirSync(STATE, { recursive: true });
  const db = new Database(join(STATE, 'state.sqlite'), { create: true });
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, kind TEXT NOT NULL, path TEXT NOT NULL, used INTEGER NOT NULL, manifest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stages (project TEXT NOT NULL, stage TEXT NOT NULL, key TEXT NOT NULL, outputs TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(project,stage));
    CREATE TABLE IF NOT EXISTS releases (project TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, manifest TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(project,id));
    CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL, birth TEXT NOT NULL, created INTEGER NOT NULL);`);
  return db;
}
