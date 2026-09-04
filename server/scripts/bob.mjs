// Drives a second participant ("Bob") through the API for demos where only one
// interactive browser is available. Cookie persists in ./data/bob-cookie.txt.
//   node scripts/bob.mjs login
//   node scripts/bob.mjs join <inviteToken>
//   node scripts/bob.mjs consent <sessionId>
//   node scripts/bob.mjs say <sessionId> "<text>"
//   node scripts/bob.mjs note <sessionId> "<text>"
//   node scripts/bob.mjs edit <sessionId> <artifactId> "<appended mermaid line>"
//   node scripts/bob.mjs vote <sessionId> <decisionPointArtifactId> <optionId>
//   node scripts/bob.mjs state <sessionId>      (prints artifacts and pending proposals)
import fs from "node:fs";

const BASE = process.env.TANDEM_URL ?? "http://localhost:3000";
const COOKIE_FILE = "./data/bob-cookie.txt";
let cookie = fs.existsSync(COOKIE_FILE) ? fs.readFileSync(COOKIE_FILE, "utf8") : "";

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) {
    cookie = set.split(";")[0];
    fs.mkdirSync("./data", { recursive: true });
    fs.writeFileSync(COOKIE_FILE, cookie);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "login":
    console.log(await call("POST", "/auth/dev", { handle: "bob", name: "Bob" }));
    break;
  case "join":
    console.log(await call("POST", `/api/v1/invites/${args[0]}/accept`));
    break;
  case "consent":
    console.log(await call("POST", `/api/v1/sessions/${args[0]}/consent`));
    break;
  case "say":
    console.log(await call("POST", `/api/v1/sessions/${args[0]}/messages`, { text: args[1], mode: "directive" }));
    break;
  case "note":
    console.log(await call("POST", `/api/v1/sessions/${args[0]}/messages`, { text: args[1], mode: "note" }));
    break;
  case "edit": {
    const events = await call("GET", `/api/v1/sessions/${args[0]}/events`);
    const applied = events.filter((e) => e.type === "artifact.applied" && e.payload.artifactId === args[1]).pop();
    const content = { ...applied.payload.content, source: applied.payload.content.source + "\n" + args[2] };
    console.log(await call("POST", `/api/v1/sessions/${args[0]}/artifacts/${args[1]}/versions`, { content, rationale: "Bob's direct edit" }));
    break;
  }
  case "vote":
    console.log(await call("POST", `/api/v1/sessions/${args[0]}/decision-points/${args[1]}/vote`, { optionId: args[2] }));
    break;
  case "state": {
    const events = await call("GET", `/api/v1/sessions/${args[0]}/events`);
    const arts = new Map();
    for (const e of events) if (e.type === "artifact.applied") arts.set(e.payload.artifactId, `${e.payload.artifactType} v${e.payload.versionNo} ${e.payload.title}`);
    for (const [id, d] of arts) console.log(id, d);
    break;
  }
  default:
    console.log("unknown command");
}
