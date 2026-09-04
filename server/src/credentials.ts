import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db, now, schema } from "./db/index.js";
import { seal, unseal } from "./crypto.js";
import { getProvider } from "./providers/index.js";

export interface CredentialView {
  id: string;
  provider: string;
  label: string | null;
  fingerprint: string | null;
  models: string[];
  status: string;
  createdAt: string;
}

export interface RawCredential {
  id: string;
  userId: string;
  provider: string;
  token: string;
  models: string[];
}

export async function storeCredential(userId: string, provider: string, token: string, label: string): Promise<CredentialView> {
  const adapter = getProvider(provider);
  const check = await adapter.validate(token);
  if (!check.ok) throw new Error(check.error ?? "credential rejected");
  const sealed = seal(token);
  const id = ulid();
  // one credential per (user, provider, label); replace if it exists
  const existing = db
    .select()
    .from(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.userId, userId), eq(schema.providerCredentials.provider, provider), eq(schema.providerCredentials.label, label)))
    .get();
  if (existing) db.delete(schema.providerCredentials).where(eq(schema.providerCredentials.id, existing.id)).run();
  db.insert(schema.providerCredentials)
    .values({
      id,
      userId,
      provider,
      label,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      fingerprint: token.slice(-4),
      models: JSON.stringify(check.models),
      status: "active",
      createdAt: now(),
    })
    .run();
  return { id, provider, label, fingerprint: token.slice(-4), models: check.models, status: "active", createdAt: now() };
}

export function listCredentials(userId: string): CredentialView[] {
  return db
    .select()
    .from(schema.providerCredentials)
    .where(eq(schema.providerCredentials.userId, userId))
    .all()
    .map((r) => ({ id: r.id, provider: r.provider, label: r.label, fingerprint: r.fingerprint, models: JSON.parse(r.models ?? "[]"), status: r.status, createdAt: r.createdAt }));
}

export function deleteCredential(userId: string, id: string) {
  db.delete(schema.providerCredentials).where(and(eq(schema.providerCredentials.id, id), eq(schema.providerCredentials.userId, userId))).run();
}

export function loadRawCredential(id: string): RawCredential | null {
  const r = db.select().from(schema.providerCredentials).where(eq(schema.providerCredentials.id, id)).get();
  if (!r || r.status !== "active") return null;
  return { id: r.id, userId: r.userId, provider: r.provider, token: unseal(r.ciphertext, r.iv, r.tag), models: JSON.parse(r.models ?? "[]") };
}

export function findCredentialForUser(userId: string, provider: string): RawCredential | null {
  const r = db
    .select()
    .from(schema.providerCredentials)
    .where(and(eq(schema.providerCredentials.userId, userId), eq(schema.providerCredentials.provider, provider), eq(schema.providerCredentials.status, "active")))
    .get();
  return r ? loadRawCredential(r.id) : null;
}
