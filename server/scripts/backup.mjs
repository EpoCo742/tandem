// Whole-install backup and restore through the operator routes, for a deployment pipeline:
//
//   node scripts/backup.mjs export  --url https://app.example --token $TANDEM_ADMIN_TOKEN --out backup.json
//   node scripts/backup.mjs import  --url https://app.example --token $TANDEM_ADMIN_TOKEN --in backup.json [--mode replace|copy]
//   node scripts/backup.mjs db      --url https://app.example --token $TANDEM_ADMIN_TOKEN --out tandem.db
//
// "export" writes every session (ledger, people, uploads, layout, published pages) as one bundle;
// "import" puts a bundle back, replacing sessions with the same id by default; "db" downloads a
// consistent copy of the SQLite file (accounts, sealed credentials, tool servers too; not the
// uploaded files). The server needs TANDEM_ADMIN_TOKEN set for any of these to answer.
import fs from "node:fs";

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] !== undefined ? rest[i + 1] : dflt;
};
const url = (opt("url", process.env.APP_URL ?? "http://localhost:3000") ?? "").replace(/\/+$/, "");
const token = opt("token", process.env.TANDEM_ADMIN_TOKEN ?? "");
if (!["export", "import", "db"].includes(cmd ?? "") || !token) {
  console.error("usage: backup.mjs export|import|db --url <app url> --token <TANDEM_ADMIN_TOKEN> [--out file] [--in file] [--mode replace|copy]");
  process.exit(2);
}
const headers = { Authorization: `Bearer ${token}` };

async function check(res, what) {
  if (res.ok) return;
  const text = await res.text();
  console.error(`${what} failed: ${res.status} ${text.slice(0, 300)}`);
  process.exit(1);
}

if (cmd === "export") {
  const out = opt("out", `session-zero-${new Date().toISOString().slice(0, 10)}.json`);
  const res = await fetch(`${url}/api/v1/admin/backup`, { headers });
  await check(res, "export");
  const bundle = await res.json();
  fs.writeFileSync(out, JSON.stringify(bundle));
  const uploads = bundle.sessions.reduce((n, s) => n + s.uploads.length, 0);
  console.log(`wrote ${out}: ${bundle.sessions.length} session(s), ${uploads} upload(s), ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
  for (const s of bundle.sessions) console.log(`  ${s.id}  ${s.title}  (${s.events.length} events, ${s.participants.length} people)`);
} else if (cmd === "import") {
  const file = opt("in", "");
  if (!file || !fs.existsSync(file)) {
    console.error("--in <bundle.json> is required");
    process.exit(2);
  }
  const mode = opt("mode", "replace");
  const res = await fetch(`${url}/api/v1/admin/restore?mode=${mode}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: fs.readFileSync(file) });
  await check(res, "import");
  const r = await res.json();
  console.log(`imported as ${r.mode} from a bundle exported ${r.exportedAt}`);
  for (const s of r.sessions) console.log(`  ${s.outcome.padEnd(8)} ${s.sessionId ?? "-"}  ${s.title}${s.reason ? `  (${s.reason})` : ""}`);
} else {
  const out = opt("out", `tandem-${new Date().toISOString().slice(0, 10)}.db`);
  const res = await fetch(`${url}/api/v1/admin/backup.db`, { headers });
  await check(res, "db");
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
