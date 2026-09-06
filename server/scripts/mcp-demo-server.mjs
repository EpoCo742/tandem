// A tiny MCP server over stdio that stands in for Confluence and Jira during demos and tests.
// Pages and stories are written to JSON files under MCP_DEMO_DIR (default ./data/mcp-demo).
//   node server/scripts/mcp-demo-server.mjs
// Register it in Tandem under credentials -> External tools with:
//   transport stdio, command node, args server/scripts/mcp-demo-server.mjs
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const dir = path.resolve(process.env.MCP_DEMO_DIR ?? "./data/mcp-demo");
fs.mkdirSync(dir, { recursive: true });
const file = (name) => path.join(dir, name);
const read = (name) => (fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), "utf8")) : []);
const write = (name, rows) => fs.writeFileSync(file(name), JSON.stringify(rows, null, 2));

const server = new McpServer({ name: "tandem-demo-atlassian", version: "0.1.0" });

// Read-only repository tools, a stand-in for a GitHub MCP server. Repositories are local
// directories: MCP_DEMO_REPOS is a JSON map of name -> path; by default "tandem" is this checkout.
const repos = (() => {
  try {
    return JSON.parse(process.env.MCP_DEMO_REPOS ?? "{}");
  } catch {
    return {};
  }
})();
if (!repos.tandem) repos.tandem = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SKIP = new Set(["node_modules", ".git", "dist", "build", ".pnpm", "data", "data-smoke", "coverage"]);
function repoRoot(name) {
  const root = repos[name];
  if (!root) throw new Error(`unknown repository ${name}; known: ${Object.keys(repos).join(", ")}`);
  return root;
}
function walk(root, rel, depth, out) {
  if (depth > 3 || out.length > 2000) return;
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
    const p = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, p, depth + 1, out);
    else out.push(p);
  }
}
server.registerTool(
  "repo_tree",
  {
    title: "List repository files",
    description: "List the files of a repository (depth 3, without dependencies and build output). One path per line.",
    inputSchema: { repo: z.string().describe("Repository name, e.g. tandem") },
    annotations: { readOnlyHint: true },
  },
  async ({ repo }) => {
    const out = [];
    walk(repoRoot(repo), "", 0, out);
    return { content: [{ type: "text", text: out.join("\n") }] };
  },
);
server.registerTool(
  "repo_file",
  {
    title: "Read a repository file",
    description: "Return the text of one file in a repository (up to 200k characters).",
    inputSchema: { repo: z.string(), path: z.string().describe("Path inside the repository, e.g. server/package.json") },
    annotations: { readOnlyHint: true },
  },
  async ({ repo, path: rel }) => {
    const root = repoRoot(repo);
    const full = path.resolve(root, rel);
    if (!full.startsWith(path.resolve(root))) throw new Error("path escapes the repository");
    return { content: [{ type: "text", text: fs.readFileSync(full, "utf8").slice(0, 200_000) }] };
  },
);

server.registerTool(
  "slack_post_message",
  {
    title: "Post a Slack message",
    description: "Post a message to a Slack channel. Returns the message timestamp.",
    inputSchema: { channel: z.string().describe("Channel name, e.g. #architecture"), text: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ channel, text }) => {
    const msgs = read("slack.json");
    const ts = `${Date.now() / 1000}`;
    write("slack.json", [...msgs, { channel, text, ts }]);
    return { content: [{ type: "text", text: `Posted to ${channel} (ts ${ts})` }] };
  },
);

server.registerTool(
  "confluence_publish_page",
  {
    title: "Publish a Confluence page",
    description: "Create or update a page in a Confluence space with Markdown body. Returns the page URL.",
    inputSchema: { space: z.string().describe("Space key, e.g. ARCH"), title: z.string(), body: z.string().describe("Markdown body") },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ space, title, body }) => {
    const pages = read("pages.json");
    const existing = pages.find((p) => p.space === space && p.title === title);
    const id = existing?.id ?? pages.length + 1;
    const page = { id, space, title, body, updatedAt: new Date().toISOString(), version: (existing?.version ?? 0) + 1 };
    write("pages.json", [...pages.filter((p) => p.id !== id), page]);
    return { content: [{ type: "text", text: `Published "${title}" to ${space} as version ${page.version}: https://confluence.example/${space}/pages/${id}` }] };
  },
);

server.registerTool(
  "confluence_search",
  {
    title: "Search Confluence",
    description: "Find pages by words in the title or body.",
    inputSchema: { query: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const hits = read("pages.json").filter((p) => `${p.title} ${p.body}`.toLowerCase().includes(q));
    return { content: [{ type: "text", text: hits.length ? hits.map((p) => `${p.space}/${p.title} (v${p.version})`).join("\n") : "No pages match." }] };
  },
);

server.registerTool(
  "jira_create_story",
  {
    title: "Create a Jira story",
    description: "Create a story in a Jira project. Returns the issue key.",
    inputSchema: { project: z.string().describe("Project key, e.g. ORD"), summary: z.string(), description: z.string().optional() },
    annotations: { readOnlyHint: false },
  },
  async ({ project, summary, description }) => {
    const stories = read("stories.json");
    const key = `${project}-${stories.length + 101}`;
    write("stories.json", [...stories, { key, project, summary, description: description ?? "", createdAt: new Date().toISOString() }]);
    return { content: [{ type: "text", text: `Created ${key}: ${summary}` }] };
  },
);

server.registerTool(
  "github_create_or_update_file",
  {
    title: "Create or update a file in a repository",
    description: "Write a file at a path in a GitHub repository (owner/name) with a commit message. Returns the file URL.",
    inputSchema: { repo: z.string().describe("owner/name"), path: z.string(), content: z.string(), message: z.string().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ repo, path: filePath, content, message }) => {
    const target = path.join(dir, "repos", repo.replace(/[^\w.-]+/g, "_"), filePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    const log = read("commits.json");
    write("commits.json", [...log, { repo, path: filePath, message: message ?? "", at: new Date().toISOString() }]);
    return { content: [{ type: "text", text: `Committed ${filePath} to ${repo}: https://github.example/${repo}/blob/main/${filePath}` }] };
  },
);

await server.connect(new StdioServerTransport());
