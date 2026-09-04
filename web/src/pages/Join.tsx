import { useEffect, useState } from "react";
import { api } from "../api";
import { navigate } from "../App";

export function Join({ token }: { token: string }) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ sessionId: string }>("POST", `/api/v1/invites/${token}/accept`)
      .then((r) => navigate(`/s/${r.sessionId}`))
      .catch((e) => setErr((e as Error).message));
  }, [token]);
  return <div className="page">{err ? <div className="err">{err}</div> : <span className="muted">Joining…</span>}</div>;
}
