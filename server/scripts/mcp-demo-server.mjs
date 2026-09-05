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

await server.connect(new StdioServerTransport());
