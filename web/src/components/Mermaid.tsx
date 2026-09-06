import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import elkLayouts from "@mermaid-js/layout-elk";
import { usePrefs } from "../state/prefs";

// ELK lays flowcharts out with orthogonal edges and evenly spaced layers; dagre stays as the
// fallback if ELK cannot handle a diagram. Sequence diagrams are not affected by the choice.
mermaid.registerLayoutLoaders(elkLayouts);
const BASE = { startOnLoad: false, securityLevel: "strict", fontFamily: "IBM Plex Sans, sans-serif", flowchart: { nodeSpacing: 36, rankSpacing: 56, padding: 10, curve: "basis", htmlLabels: true }, elk: { mergeEdges: false, nodePlacementStrategy: "BRANDES_KOEPF" } } as const;
let current: { theme: "light" | "dark"; layout: "elk" | "dagre" } | null = null;
function ensure(theme: "light" | "dark", layout: "elk" | "dagre") {
  if (current?.theme === theme && current.layout === layout) return;
  current = { theme, layout };
  mermaid.initialize({ ...BASE, ...(layout === "elk" ? { layout: "elk" } : {}), theme: theme === "dark" ? "dark" : "neutral" } as Parameters<typeof mermaid.initialize>[0]);
}

let counter = 0;

export function Mermaid({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const resolved = usePrefs((s) => s.resolved);
  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++counter}`;
    const draw = (layout: "elk" | "dagre") => {
      ensure(resolved, layout);
      return mermaid.render(`${id}-${layout}`, source);
    };
    draw("elk")
      .catch((e) => {
        document.getElementById(`d${id}-elk`)?.remove();
        // Not every diagram type or construct is supported by ELK; dagre draws the rest.
        console.warn("mermaid: elk layout failed, falling back to dagre:", (e as Error).message);
        return draw("dagre");
      })
      .then(({ svg }) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = svg;
        setErr(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr((e as Error).message);
        document.getElementById(`d${id}-dagre`)?.remove();
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
