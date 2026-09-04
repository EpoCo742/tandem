import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict", fontFamily: "IBM Plex Sans, sans-serif" });

let counter = 0;

export function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++counter}`;
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
  }, [source]);
  return (
    <div className="mermaid-box">
      <div ref={ref} />
      {err && <div className="mermaid-err">Mermaid error: {err}{"\n\n"}{source}</div>}
    </div>
  );
}
