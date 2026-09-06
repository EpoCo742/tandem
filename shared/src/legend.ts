// A legend read off a generated Mermaid diagram: which kinds, boundaries and edge styles it uses.
// Derived from the source text, so it works wherever the diagram is shown (cards, the published
// page, presentation mode) and in exports, without disturbing the layout engine.

export const KIND_CLASSES: Record<string, { label: string; shape: string }> = {
  svc: { label: "service", shape: "rectangle" },
  db: { label: "database or storage", shape: "cylinder" },
  q: { label: "queue or topic", shape: "double-edged box" },
  ext: { label: "external system", shape: "dashed parallelogram" },
  person: { label: "person", shape: "stadium" },
  ui: { label: "user interface", shape: "rounded box" },
  fn: { label: "function or job", shape: "flag" },
  added: { label: "added since as-is", shape: "green outline" },
  removed: { label: "removed since as-is", shape: "red dashed" },
  changed: { label: "changed since as-is", shape: "amber outline" },
  same: { label: "unchanged since as-is", shape: "grey" },
};

export interface Legend {
  kinds: { cls: string; label: string; shape: string }[];
  boundaries: { name: string; color: string }[];
  edges: string[];
  dataClasses: string[];
}

export function mermaidLegend(source: string): Legend {
  const kinds: Legend["kinds"] = [];
  for (const cls of Object.keys(KIND_CLASSES)) if (new RegExp(`:::${cls}\\b`).test(source)) kinds.push({ cls, ...KIND_CLASSES[cls]! });
  const boundaries: Legend["boundaries"] = [];
  const names = new Map<string, string>();
  for (const m of source.matchAll(/subgraph (b_\S+)\["([^"\n]+?)(?:\\n|")/g)) names.set(m[1]!, m[2]!.replace(/#quot;/g, '"'));
  for (const m of source.matchAll(/style (b_\S+) fill:([#0-9a-fA-F]+),stroke:(#[0-9a-fA-F]{6})/g)) {
    const name = names.get(m[1]!);
    if (name && !boundaries.some((b) => b.name === name)) boundaries.push({ name, color: m[3]! });
  }
  const edges: string[] = [];
  if (/ -->/.test(source) || / -\.->/.test(source) || / ==>/.test(source)) edges.push("arrow: the verb on it says what flows");
  if (/ ==>/.test(source)) edges.push("thick arrow: added since as-is");
  if (/ -\.->/.test(source) && /:::removed/.test(source)) edges.push("dashed arrow: removed since as-is");
  if (/linkStyle \d+ stroke:#c0392b/.test(source)) edges.push("red arrow: a classified flow that breaks a constraint");
  if (/^\s*[A-Za-z0-9_]+-[)>]|-->>|->>/m.test(source)) edges.push("solid: call; open head: async message; dashed: reply or read");
  if (/style d_\S+ stroke:#c0392b,stroke-dasharray/.test(source)) edges.push("red dashed box: internet-facing node");
  const dataClasses = [...new Set([...source.matchAll(/\[((?:PII|payment|health|credentials|confidential)(?:, (?:PII|payment|health|credentials|confidential))*)\]/g)].flatMap((m) => m[1]!.split(", ")))];
  return { kinds, boundaries, edges, dataClasses };
}

/** One line for Markdown exports. */
export function legendText(l: Legend): string {
  const parts: string[] = [];
  if (l.kinds.length) parts.push(l.kinds.map((k) => `${k.shape} = ${k.label}`).join(", "));
  if (l.boundaries.length) parts.push(`boundaries: ${l.boundaries.map((b) => b.name).join(", ")}`);
  if (l.edges.length) parts.push(l.edges.join("; "));
  if (l.dataClasses.length) parts.push(`[…] on an edge = data carried (${l.dataClasses.join(", ")})`);
  return parts.length ? `Legend: ${parts.join(". ")}.` : "";
}
