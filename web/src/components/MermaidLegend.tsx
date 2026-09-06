import { mermaidLegend } from "@tandem/shared";

const SWATCH: Record<string, { bg: string; border: string; radius?: string; dashed?: boolean }> = {
  svc: { bg: "#eaf2fb", border: "#2f7fd4" },
  db: { bg: "#f3eefa", border: "#8e44ad", radius: "40% / 20%" },
  q: { bg: "#fff4e5", border: "#c26b1f" },
  ext: { bg: "#f4f6f8", border: "#7c8893", dashed: true },
  person: { bg: "#e8f6ee", border: "#2e9e5b", radius: "999px" },
  ui: { bg: "#e6f7f9", border: "#178e9e", radius: "6px" },
  fn: { bg: "#fbf3e6", border: "#b7950b" },
  added: { bg: "transparent", border: "#2e9e5b" },
  removed: { bg: "transparent", border: "#c0392b", dashed: true },
  changed: { bg: "transparent", border: "#d4890a" },
  same: { bg: "transparent", border: "#8a949e" },
};

// A small legend under a generated diagram, read off its source: the kinds it draws, the
// boundary tints, and what the edge styles mean. Shown only when there is something to explain.
export function MermaidLegend({ source }: { source: string }) {
  const l = mermaidLegend(source);
  if (l.kinds.length + l.boundaries.length + l.edges.length === 0) return null;
  return (
    <div className="legend">
      {l.kinds.map((k) => {
        const s = SWATCH[k.cls] ?? { bg: "transparent", border: "#8a949e" };
        return (
          <span key={k.cls} className="legend-item" title={`${k.shape}: ${k.label}`}>
            <span className="legend-swatch" style={{ background: s.bg, borderColor: s.border, borderStyle: s.dashed ? "dashed" : "solid", borderRadius: s.radius ?? "2px" }} />
            {k.label}
          </span>
        );
      })}
      {l.boundaries.map((b) => (
        <span key={b.name} className="legend-item" title="A boundary: a system, team or trust zone">
          <span className="legend-swatch" style={{ background: `${b.color}1a`, borderColor: b.color, borderRadius: "3px" }} />
          {b.name}
        </span>
      ))}
      {l.edges.map((e) => <span key={e} className="legend-item legend-edge">{e}</span>)}
      {l.dataClasses.length > 0 && <span className="legend-item legend-edge">[…] on an edge: data carried ({l.dataClasses.join(", ")})</span>}
    </div>
  );
}
