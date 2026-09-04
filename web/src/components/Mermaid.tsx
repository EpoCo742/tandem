import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { usePrefs } from "../state/prefs";

const BASE = { startOnLoad: false, securityLevel: "strict", fontFamily: "IBM Plex Sans, sans-serif" } as const;
let currentTheme: "light" | "dark" | null = null;
function ensureTheme(theme: "light" | "dark") {
  if (currentTheme === theme) return;
  currentTheme = theme;
  mermaid.initialize({ ...BASE, theme: theme === "dark" ? "dark" : "neutral" });
}

let counter = 0;

export function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const resolved = usePrefs((s) => s.resolved);
  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++counter}`;
    ensureTheme(resolved);
    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
        document.getElementById("d" + id)?.remove();
      });
    return () => {
      cancelled = true;
    };
  }, [source, resolved]);
  return (
    <div className="mermaid-box">
      <div ref={ref} />
      {err && <div className="mermaid-err">Mermaid error: {err}{"\n\n"}{source}</div>}
    </div>
  );
}
