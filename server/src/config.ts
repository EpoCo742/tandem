import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable ${name}`);
  }
  return v;
}

const dataDir = path.resolve(env("DATA_DIR", "./data"));
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });
fs.mkdirSync(path.join(dataDir, "copilot"), { recursive: true });

export const config = {
  port: Number(env("PORT", "3000")),
  appUrl: env("APP_URL", "http://localhost:3000"),
  dataDir,
  dbPath: path.join(dataDir, "tandem.db"),
  filesDir: path.join(dataDir, "files"),
  copilotHome: path.join(dataDir, "copilot"),
  sessionSecret: env("SESSION_SECRET", "dev-only-session-secret-change-me-please-32b"),
  masterKeyHex: env("TANDEM_MASTER_KEY", "0".repeat(64)),
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    scopes: process.env.GITHUB_OAUTH_SCOPES?.trim() || "read:user",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  },
  devAuth: env("TANDEM_DEV_AUTH", "0") === "1",
  defaultProvider: env("TANDEM_PROVIDER", "copilot") as "copilot" | "fake",
  defaultModel: env("TANDEM_DEFAULT_MODEL", "claude-opus-5"),
  maxConcurrentTurns: Number(env("TANDEM_MAX_CONCURRENT_TURNS", "3")),
  batchWindowMs: Number(env("TANDEM_BATCH_WINDOW_MS", "1500")),
  batchMaxWindowMs: Number(env("TANDEM_BATCH_MAX_WINDOW_MS", "4000")),
  approvalTimeoutS: Number(env("TANDEM_APPROVAL_TIMEOUT_S", "60")),
  turnTimeoutMs: Number(env("TANDEM_TURN_TIMEOUT_MS", "240000")),
  // Compact once this many messages have fallen out of the transcript window (0 disables).
  compactAfter: Number(env("TANDEM_COMPACT_AFTER", "8")),
  webDist: path.resolve(env("WEB_DIST", "../web/dist")),
  isProd: process.env.NODE_ENV === "production",
};

if (config.masterKeyHex === "0".repeat(64)) {
  console.warn("[tandem] TANDEM_MASTER_KEY is not set; using an insecure development key. Do not store real tokens like this outside a local demo.");
}
