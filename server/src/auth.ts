import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { db, now, schema } from "./db/index.js";

// Identity: GitHub OAuth in normal mode; a "dev login" that creates local users
// when TANDEM_DEV_AUTH=1 so two browsers can be demoed before an OAuth App exists.

export interface User {
  id: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  githubId: number | null;
}

const COOKIE = "tandem_sid";
const pendingStates = new Map<string, number>();

export function userFromRequest(req: FastifyRequest): User | null {
  const raw = req.cookies[COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const row = db.select().from(schema.users).where(eq(schema.users.id, unsigned.value)).get();
  return row ? { id: row.id, handle: row.handle, displayName: row.displayName, avatarUrl: row.avatarUrl, githubId: row.githubId } : null;
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): User {
  const u = userFromRequest(req);
  if (!u) {
    reply.code(401).send({ error: "not_authenticated" });
    throw new Error("not_authenticated");
  }
  return u;
}

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie(COOKIE, userId, { path: "/", httpOnly: true, sameSite: "lax", signed: true, maxAge: 60 * 60 * 24 * 30, secure: config.appUrl.startsWith("https") });
}

function upsertGithubUser(gh: { id: number; login: string; name: string | null; avatar_url: string }): User {
  const existing = db.select().from(schema.users).where(eq(schema.users.githubId, gh.id)).get();
  if (existing) {
    db.update(schema.users).set({ handle: gh.login, displayName: gh.name, avatarUrl: gh.avatar_url }).where(eq(schema.users.id, existing.id)).run();
    return { id: existing.id, handle: gh.login, displayName: gh.name, avatarUrl: gh.avatar_url, githubId: gh.id };
  }
  const id = ulid();
  db.insert(schema.users).values({ id, githubId: gh.id, handle: gh.login, displayName: gh.name, avatarUrl: gh.avatar_url, createdAt: now() }).run();
  return { id, handle: gh.login, displayName: gh.name, avatarUrl: gh.avatar_url, githubId: gh.id };
}

// Why the last GitHub sign-in did not yield a Copilot credential, per user, so the UI can say so.
const oauthCredentialErrors = new Map<string, string>();

export async function registerAuthRoutes(app: FastifyInstance) {
  app.get("/auth/me", async (req) => {
    const u = userFromRequest(req);
    return { user: u, devAuth: config.devAuth, githubConfigured: Boolean(config.github.clientId), copilotOauthError: u ? oauthCredentialErrors.get(u.id) ?? null : null };
  });

  app.post("/auth/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  if (config.devAuth) {
    app.post<{ Body: { handle: string; name?: string } }>("/auth/dev", async (req, reply) => {
      const handle = String(req.body?.handle ?? "").trim().toLowerCase().replace(/[^a-z0-9-_]/g, "");
      if (!handle) return reply.code(400).send({ error: "handle required" });
      let row = db.select().from(schema.users).where(eq(schema.users.handle, handle)).get();
      if (!row) {
        const id = ulid();
        db.insert(schema.users).values({ id, githubId: null, handle, displayName: req.body.name ?? handle, avatarUrl: null, createdAt: now() }).run();
        row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()!;
      }
      setSession(reply, row.id);
      return { user: { id: row.id, handle: row.handle, displayName: row.displayName, avatarUrl: row.avatarUrl } };
    });
  }

  app.get("/auth/github", async (req, reply) => {
    if (!config.github.clientId) return reply.code(500).send({ error: "GITHUB_CLIENT_ID not configured" });
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now());
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.github.clientId);
    url.searchParams.set("redirect_uri", `${config.appUrl}/auth/github/callback`);
    // read:org lets Copilot see organisation-assigned seats; without it a Business seat can look absent.
    url.searchParams.set("scope", "read:user read:org");
    url.searchParams.set("state", state);
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string } }>("/auth/github/callback", async (req, reply) => {
    const { code, state } = req.query;
    if (!code || !state || !pendingStates.has(state)) return reply.code(400).send({ error: "invalid oauth state" });
    pendingStates.delete(state);
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code, redirect_uri: `${config.appUrl}/auth/github/callback` }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenJson.access_token) return reply.code(400).send({ error: tokenJson.error ?? "token exchange failed" });
    const ghUser = (await (
      await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${tokenJson.access_token}`, "User-Agent": "tandem-poc" } })
    ).json()) as { id: number; login: string; name: string | null; avatar_url: string };
    const user = upsertGithubUser(ghUser);
    setSession(reply, user.id);
    // Stash the OAuth token as a Copilot credential automatically so the user can fund turns.
    const { storeCredential } = await import("./credentials.js");
    oauthCredentialErrors.delete(user.id);
    await storeCredential(user.id, "copilot", tokenJson.access_token, "GitHub OAuth").catch((e) => {
      const message = (e as Error).message;
      oauthCredentialErrors.set(user.id, message);
      app.log.warn({ err: e }, "could not store copilot credential from oauth");
    });
    return reply.redirect("/");
  });
}
