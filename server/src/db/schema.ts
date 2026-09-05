import { sqliteTable, text, integer, blob, primaryKey, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  githubId: integer("github_id"),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").notNull(),
});

export const providerCredentials = sqliteTable("provider_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(),
  label: text("label"),
  ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
  iv: blob("iv", { mode: "buffer" }).notNull(),
  tag: blob("tag", { mode: "buffer" }).notNull(),
  fingerprint: text("fingerprint"),
  models: text("models"), // JSON string[]
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
});

// Per-user MCP servers: the whole transport config (command, args, env or url, headers) is sealed.
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  transport: text("transport").notNull(), // stdio | http
  ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
  iv: blob("iv", { mode: "buffer" }).notNull(),
  tag: blob("tag", { mode: "buffer" }).notNull(),
  summary: text("summary").notNull(), // non-secret description shown in the UI (command or host)
  tools: text("tools"), // JSON McpToolInfo[] from the last successful test
  allow: text("allow"), // JSON AllowRule[]: writes that run without asking again
  status: text("status").notNull().default("untested"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull(),
  testedAt: text("tested_at"),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  status: text("status").notNull().default("active"),
  policy: text("policy").notNull().default("hybrid"),
  payerMode: text("payer_mode").notNull().default("sponsor"),
  pinnedModel: text("pinned_model").notNull(),
  provider: text("provider").notNull(),
  sponsorCredentialId: text("sponsor_credential_id"),
  forkedFromSessionId: text("forked_from_session_id"),
  forkedAtCommitId: text("forked_at_commit_id"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const participants = sqliteTable(
  "participants",
  {
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("editor"),
    credentialId: text("credential_id"),
    color: text("color").notNull(),
    consentedAt: text("consented_at"),
    joinedAt: text("joined_at").notNull(),
    lastSeenSeq: integer("last_seen_seq").notNull().default(0), // for "since you last looked"
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);

export const invites = sqliteTable("invites", {
  token: text("token").primaryKey(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull().default("editor"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    sessionId: text("session_id").notNull(),
    seq: integer("seq").notNull(),
    id: text("id").notNull(),
    type: text("type").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorUserId: text("actor_user_id"),
    causedBy: text("caused_by").notNull(), // JSON string[]
    turnId: text("turn_id"),
    payload: text("payload").notNull(), // JSON
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.seq] }), index("events_id_idx").on(t.id)],
);

export const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  uploaderUserId: text("uploader_user_id").notNull(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  extractedText: text("extracted_text"),
  createdAt: text("created_at").notNull(),
});

export const yjsDocuments = sqliteTable("yjs_documents", {
  name: text("name").primaryKey(),
  state: blob("state", { mode: "buffer" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});
