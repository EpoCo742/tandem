import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const key = Buffer.from(config.masterKeyHex, "hex");
if (key.length !== 32) throw new Error("TANDEM_MASTER_KEY must be 64 hex characters (32 bytes)");

export function seal(plaintext: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function unseal(ciphertext: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// Short-lived HMAC tokens for the collab (Yjs) socket: "sessionId.userId.exp.sig"
export function mintCollabToken(sessionId: string, userId: string, ttlSeconds = 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = `${sessionId}.${userId}.${exp}`;
  const sig = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyCollabToken(token: string): { sessionId: string; userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [sessionId, userId, expStr, sig] = parts as [string, string, string, string];
  const body = `${sessionId}.${userId}.${expStr}`;
  const expected = createHmac("sha256", config.sessionSecret).update(body).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
  return { sessionId, userId };
}
