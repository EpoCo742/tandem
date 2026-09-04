import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import * as schema from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export const sqlite = new Database(config.dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export function runMigrations() {
  migrate(db, { migrationsFolder: path.resolve(here, "../../drizzle") });
}

export { schema };
export const now = () => new Date().toISOString();
