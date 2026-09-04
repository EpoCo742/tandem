// Creates .env (repo root) and server/.env with fresh random secrets for a local run.
// Usage: node tools/make-env.mjs [--force]
import { randomBytes } from "node:crypto";
import fs from "node:fs";

const force = process.argv.includes("--force");
const targets = [".env", "server/.env"];
if (!force && targets.some((t) => fs.existsSync(t))) {
  console.log("An .env already exists; pass --force to overwrite.");
  process.exit(0);
}
const env = [
  "PORT=3000",
  "APP_URL=http://localhost:3000",
  "DATA_DIR=./data",
  `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
  `TANDEM_MASTER_KEY=${randomBytes(32).toString("hex")}`,
  "GITHUB_CLIENT_ID=",
  "GITHUB_CLIENT_SECRET=",
  "TANDEM_DEV_AUTH=1",
  "TANDEM_PROVIDER=fake",
  "TANDEM_DEFAULT_MODEL=claude-opus-5",
  "TANDEM_MAX_CONCURRENT_TURNS=3",
  "TANDEM_BATCH_WINDOW_MS=1500",
  "TANDEM_APPROVAL_TIMEOUT_S=60",
  "",
].join("\n");
for (const t of targets) fs.writeFileSync(t, env);
console.log(`wrote ${targets.join(" and ")} (dev auth on, offline provider)`);
