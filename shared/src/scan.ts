import { slugId, type ComponentKind, type RelationshipKind } from "./model.js";

// Read the shape of a code base from its manifests, not its source: package.json files (and
// the workspace that ties them together), docker-compose services, and the odd go.mod,
// requirements.txt or pom.xml. The result is an as-is architecture: what runs, what it is built
// with, and what it talks to. Heuristic by design; the point is a truthful starting model that
// people and the AI then refine, without a model reading every file in the repository.

export interface RepoFile {
  path: string;
  text: string;
}

export interface ScannedComponent {
  id: string;
  name: string;
  kind: ComponentKind;
  technology?: string;
  description?: string;
  boundary?: string;
}

export interface ScannedRelationship {
  from: string;
  to: string;
  kind: RelationshipKind;
  label?: string;
}

export interface ScanResult {
  components: ScannedComponent[];
  relationships: ScannedRelationship[];
  boundary: { id: string; name: string } | null;
  notes: string[]; // what the scan saw and what it inferred, for the person to check
}

// Well-known dependencies that mean "this package talks to that kind of thing".
const INFRA: { test: RegExp; id: string; name: string; kind: ComponentKind; technology?: string; rel: RelationshipKind; inside: boolean }[] = [
  { test: /^(better-sqlite3|sqlite3|sqlite)$/, id: "sqlite", name: "SQLite", kind: "database", technology: "SQLite", rel: "writes", inside: true },
  { test: /^(pg|postgres|@neondatabase\/serverless|drizzle-orm\/pg|prisma)$/, id: "postgres", name: "PostgreSQL", kind: "database", technology: "PostgreSQL", rel: "writes", inside: true },
  { test: /^(mysql2?|mariadb)$/, id: "mysql", name: "MySQL", kind: "database", technology: "MySQL", rel: "writes", inside: true },
  { test: /^(mongodb|mongoose)$/, id: "mongodb", name: "MongoDB", kind: "database", technology: "MongoDB", rel: "writes", inside: true },
  { test: /^(ioredis|redis)$/, id: "redis", name: "Redis", kind: "database", technology: "Redis", rel: "reads", inside: true },
  { test: /^(kafkajs|node-rdkafka)$/, id: "kafka", name: "Kafka", kind: "queue", technology: "Kafka", rel: "publishes", inside: true },
  { test: /^(amqplib|amqp-connection-manager)$/, id: "rabbitmq", name: "RabbitMQ", kind: "queue", technology: "RabbitMQ", rel: "publishes", inside: true },
  { test: /^@aws-sdk\/client-sqs$/, id: "sqs", name: "SQS", kind: "queue", technology: "AWS SQS", rel: "publishes", inside: false },
  { test: /^@aws-sdk\/client-s3$/, id: "s3", name: "S3", kind: "storage", technology: "AWS S3", rel: "writes", inside: false },
  { test: /^@github\/copilot(-sdk)?$/, id: "copilot-runtime", name: "GitHub Copilot runtime", kind: "external", technology: "Copilot SDK", rel: "calls", inside: false },
  { test: /^@modelcontextprotocol\/sdk$/, id: "mcp-servers", name: "MCP servers", kind: "external", technology: "Model Context Protocol", rel: "calls", inside: false },
  { test: /^(openai|@anthropic-ai\/sdk|@google\/generative-ai)$/, id: "llm-api", name: "LLM API", kind: "external", rel: "calls", inside: false },
  { test: /^stripe$/, id: "stripe", name: "Stripe", kind: "external", technology: "Stripe", rel: "calls", inside: false },
  { test: /^(nodemailer|@sendgrid\/mail|postmark)$/, id: "email", name: "Email service", kind: "external", rel: "calls", inside: false },
];

const UI_DEPS = /^(react|react-dom|vue|svelte|next|nuxt|@angular\/core|solid-js|preact)$/;
const SERVER_DEPS = /^(fastify|express|koa|@hapi\/hapi|@nestjs\/core|hono|restify|apollo-server|graphql-yoga)$/;
const SERVER_TECH: Record<string, string> = { fastify: "Fastify", express: "Express", koa: "Koa", "@hapi/hapi": "Hapi", "@nestjs/core": "NestJS", hono: "Hono", restify: "Restify" };
const UI_TECH: Record<string, string> = { react: "React", "react-dom": "React", vue: "Vue", svelte: "Svelte", next: "Next.js", nuxt: "Nuxt", "@angular/core": "Angular", "solid-js": "Solid", preact: "Preact" };

const IMAGE_KIND: { test: RegExp; kind: ComponentKind; technology: string }[] = [
  { test: /postgres/i, kind: "database", technology: "PostgreSQL" },
  { test: /mysql|mariadb/i, kind: "database", technology: "MySQL" },
  { test: /mongo/i, kind: "database", technology: "MongoDB" },
  { test: /redis|valkey/i, kind: "database", technology: "Redis" },
  { test: /kafka|redpanda/i, kind: "queue", technology: "Kafka" },
  { test: /rabbitmq/i, kind: "queue", technology: "RabbitMQ" },
  { test: /nats/i, kind: "queue", technology: "NATS" },
  { test: /minio/i, kind: "storage", technology: "MinIO" },
  { test: /elasticsearch|opensearch/i, kind: "database", technology: "Elasticsearch" },
  { test: /nginx|traefik|caddy|envoy/i, kind: "service", technology: "reverse proxy" },
];

function baseName(p: string): string {
  return p.split("/").pop() ?? p;
}
function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}
function scopeless(name: string): string {
  return name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
}

// The subset of docker-compose that says what runs and what depends on what.
export function parseCompose(text: string): { name: string; image?: string; build: boolean; dependsOn: string[] }[] {
  const lines = text.split(/\r?\n/);
  const out: { name: string; image?: string; build: boolean; dependsOn: string[] }[] = [];
  let inServices = false;
  let servicesIndent = -1;
  let cur: (typeof out)[number] | null = null;
  let curIndent = -1;
  let inDepends = false;
  let dependsIndent = -1;
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (!inServices) {
      if (/^services:\s*$/.test(line)) {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }
    if (indent <= servicesIndent) {
      inServices = false;
      cur = null;
      continue;
    }
    if (cur === null || indent <= curIndent) {
      const m = line.match(/^([\w.-]+):\s*$/);
      if (m && (cur === null || indent === curIndent)) {
        cur = { name: m[1]!, build: false, dependsOn: [] };
        curIndent = indent;
        inDepends = false;
        out.push(cur);
      }
      continue;
    }
    if (inDepends) {
      if (indent > dependsIndent) {
        const item = line.match(/^-\s*([\w.-]+)/)?.[1] ?? line.match(/^([\w.-]+):/)?.[1];
        if (item) cur.dependsOn.push(item);
        continue;
      }
      inDepends = false;
    }
    const kv = line.match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "image") cur.image = value!.replace(/^["']|["']$/g, "");
    else if (key === "build") cur.build = true;
    else if (key === "depends_on") {
      const inline = value!.match(/^\[(.*)\]$/);
      if (inline) cur.dependsOn.push(...inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
      else {
        inDepends = true;
        dependsIndent = indent;
      }
    }
  }
  return out;
}

export function scanRepo(files: RepoFile[], repoName: string): ScanResult {
  const components = new Map<string, ScannedComponent>();
  const relationships: ScannedRelationship[] = [];
  const notes: string[] = [];
  const boundary = { id: slugId(repoName) || "repo", name: repoName };
  const add = (c: ScannedComponent) => {
    const prev = components.get(c.id);
    components.set(c.id, prev ? { ...prev, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) } : c);
  };
  const rel = (from: string, to: string, kind: RelationshipKind, label?: string) => {
    if (from === to || relationships.some((r) => r.from === from && r.to === to && r.kind === kind)) return;
    relationships.push({ from, to, kind, label });
  };

  // Packages: one component per package.json that names a package (skip node_modules, fixtures).
  const pkgs: { dir: string; name: string; deps: string[]; scripts: Record<string, string>; hasBin: boolean }[] = [];
  for (const f of files) {
    if (baseName(f.path) !== "package.json" || /node_modules|fixtures?|__tests__|examples?\//.test(f.path)) continue;
    try {
      const j = JSON.parse(f.text) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; scripts?: Record<string, string>; bin?: unknown; workspaces?: unknown; private?: boolean };
      const deps = Object.keys({ ...(j.dependencies ?? {}), ...(j.peerDependencies ?? {}) });
      const dir = dirOf(f.path);
      const otherPackages = files.some((x) => baseName(x.path) === "package.json" && dirOf(x.path) !== "" && !/node_modules/.test(x.path));
      const isRootOfWorkspace = dir === "" && (j.workspaces || files.some((x) => baseName(x.path) === "pnpm-workspace.yaml") || (otherPackages && deps.length === 0));
      if (isRootOfWorkspace) continue; // the workspace root is glue, not a component
      pkgs.push({ dir, name: j.name ?? (dir ? baseName(dir) : repoName), deps, scripts: j.scripts ?? {}, hasBin: Boolean(j.bin) });
    } catch {
      notes.push(`${f.path} is not valid JSON; skipped`);
    }
  }
  const pkgIds = new Map<string, string>(); // package name -> component id
  for (const p of pkgs) {
    const short = scopeless(p.name);
    const id = slugId(short);
    const uiDep = p.deps.find((d) => UI_DEPS.test(d));
    const serverDep = p.deps.find((d) => SERVER_DEPS.test(d));
    const dirHint = /(^|\/)(web|ui|frontend|client|app)$/.test(p.dir) ? "ui" : /(^|\/)(server|api|backend|service)$/.test(p.dir) ? "service" : null;
    const kind: ComponentKind = uiDep ? "ui" : serverDep || p.hasBin || p.scripts.start ? "service" : dirHint === "ui" ? "ui" : dirHint === "service" ? "service" : "other";
    const technology = uiDep ? UI_TECH[uiDep] : serverDep ? `Node.js, ${SERVER_TECH[serverDep] ?? serverDep}` : kind === "service" ? "Node.js" : undefined;
    add({ id, name: short, kind, technology, description: kind === "other" ? `Library package ${p.name}${p.dir ? ` (${p.dir}/)` : ""}` : `Package ${p.name}${p.dir ? ` (${p.dir}/)` : ""}`, boundary: boundary.id });
    pkgIds.set(p.name, id);
  }
  for (const p of pkgs) {
    const from = pkgIds.get(p.name)!;
    for (const d of p.deps) {
      const other = pkgIds.get(d);
      if (other) rel(from, other, "depends_on", "workspace dependency");
      const infra = INFRA.find((i) => i.test.test(d));
      if (infra) {
        add({ id: infra.id, name: infra.name, kind: infra.kind, technology: infra.technology, description: `Seen as dependency ${d} of ${p.name}`, boundary: infra.inside ? boundary.id : undefined });
        rel(from, infra.id, infra.rel, d);
      }
    }
  }
  // A UI package next to a service package talks to it over HTTP; that is what they are for.
  const uis = [...components.values()].filter((c) => c.kind === "ui");
  const services = [...components.values()].filter((c) => c.kind === "service" && pkgs.some((p) => pkgIds.get(p.name) === c.id));
  for (const u of uis) for (const s of services) rel(u.id, s.id, "calls", "HTTP");
  if (pkgs.length) notes.push(`${pkgs.length} package${pkgs.length === 1 ? "" : "s"} from package.json: ${pkgs.map((p) => p.name).join(", ")}`);

  // docker-compose: what runs together and what depends on what.
  for (const f of files) {
    if (!/(^|\/)(docker-)?compose[\w.-]*\.ya?ml$/.test(f.path)) continue;
    const services = parseCompose(f.text);
    for (const s of services) {
      const id = slugId(s.name);
      const img = s.image ? IMAGE_KIND.find((k) => k.test.test(s.image!)) : undefined;
      add({ id, name: s.name, kind: img?.kind ?? "service", technology: img?.technology ?? (s.image ? s.image.split(":")[0] : s.build ? "built from this repository" : undefined), description: `Service in ${f.path}${s.image ? ` (image ${s.image})` : ""}`, boundary: boundary.id });
    }
    for (const s of services) for (const d of s.dependsOn) rel(slugId(s.name), slugId(d), "depends_on", "compose depends_on");
    if (services.length) notes.push(`${services.length} service${services.length === 1 ? "" : "s"} from ${f.path}: ${services.map((s) => s.name).join(", ")}`);
  }

  // Other ecosystems: one service for the repository, with the language as technology.
  const single = (test: RegExp, technology: string) => {
    const f = files.find((x) => test.test(x.path) && !x.path.includes("/"));
    if (f && !components.size) add({ id: slugId(repoName) || "app", name: repoName, kind: "service", technology, description: `From ${f.path}`, boundary: boundary.id });
  };
  single(/^go\.mod$/, "Go");
  single(/^(requirements\.txt|pyproject\.toml|Pipfile)$/, "Python");
  single(/^pom\.xml$/, "Java, Maven");
  single(/^build\.gradle(\.kts)?$/, "Java, Gradle");
  single(/^Cargo\.toml$/, "Rust");
  single(/^.*\.csproj$/, ".NET");

  if (files.some((f) => /(^|\/)Dockerfile$/.test(f.path))) notes.push("A Dockerfile is present: the repository builds a container image");
  if (!components.size) notes.push("No manifests recognised (package.json, docker-compose, go.mod, requirements.txt, pom.xml, Cargo.toml); nothing to draw");
  const list = [...components.values()];
  return { components: list, relationships: relationships.filter((r) => components.has(r.from) && components.has(r.to)), boundary: list.some((c) => c.boundary === boundary.id) ? boundary : null, notes };
}

/** Which repository files are worth reading for an as-is scan: manifests only, never the source tree. */
export function manifestPaths(tree: string[], limit = 12): string[] {
  const want = /(^|\/)(package\.json|pnpm-workspace\.yaml|(docker-)?compose[\w.-]*\.ya?ml|Dockerfile|go\.mod|requirements\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|Cargo\.toml|[\w.-]+\.csproj)$/;
  return tree
    .filter((p) => want.test(p) && !/node_modules|\/dist\/|\/build\/|\/\.|^\./.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))
    .slice(0, limit);
}
