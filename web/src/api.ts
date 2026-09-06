export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    const msg = (json as { error?: string })?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return json as T;
}

export interface Me {
  user: { id: string; handle: string; displayName: string | null; avatarUrl: string | null } | null;
  devAuth: boolean;
  githubConfigured: boolean;
  copilotOauthError?: string | null;
}

export interface SessionMeta {
  id: string;
  title: string;
  policy: string;
  payerMode: string;
  pinnedModel: string;
  provider: string;
  status: "active" | "archived";
  template: string | null;
  demo: boolean;
  createdBy: string;
  me: { role: string; consented: boolean; hasCredential: boolean; lastSeenSeq: number };
  collabToken: string;
  lastSeq: number;
}

export interface McpToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
}

export interface AllowRule {
  tool: string;
  target: Record<string, string>;
  createdAt: string;
}

export interface McpServerView {
  id: string;
  name: string;
  transport: string;
  summary: string;
  tools: McpToolInfo[];
  allow: AllowRule[];
  status: string;
  lastError: string | null;
  testedAt: string | null;
  createdAt: string;
}

export interface CredentialView {
  id: string;
  provider: string;
  label: string | null;
  fingerprint: string | null;
  models: string[];
  status: string;
}
