import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  Panel,
  applyNodeChanges,
  useReactFlow,
  ViewportPortal,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import { liveArtifacts, completeness, BLANK_STARTERS, TEMPLATES, isTemplateId, type Artifact } from "@tandem/shared";
import { setCursor, setSelectedArtifact, type Collab, type Layout } from "../collab";
import { useStore } from "../state/store";
import { usePrefs, type GridStyle } from "../state/prefs";
import { ArtifactCard } from "./ArtifactCard";

type ArtNode = Node<{ artifact: Artifact; sessionId: string; sized: boolean; resetSize: (id: string) => void }, "artifact">;

const MIN_W = 220;
const MIN_H = 80;

// A card whose content cannot be rendered (a bad version, an old client) shows an error in its
// place instead of taking the whole session down with it.
class CardBoundary extends Component<{ artifact: Artifact; children: ReactNode }, { error: Error | null; forVersion: string | null }> {
  state = { error: null as Error | null, forVersion: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: { artifact: Artifact }, state: { error: Error | null; forVersion: string | null }) {
    // A newer version of the card gets a fresh chance to render.
    if (state.error && state.forVersion && state.forVersion !== props.artifact.current.versionId) return { error: null, forVersion: null };
    if (state.error && !state.forVersion) return { forVersion: props.artifact.current.versionId };
    return null;
  }
  render() {
    if (!this.state.error) return this.props.children;
    const a = this.props.artifact;
    return (
      <div className="art broken" style={{ borderTopColor: "var(--warn)" }}>
        <div className="art-head">
          <span className="chip" style={{ color: "var(--warn)" }}>{a.type.replace("_", " ")}</span>
          <span className="title">{a.title}</span>
          <span className="mono">v{a.current.versionNo}</span>
        </div>
        <div className="art-body nodrag" style={{ fontSize: 12.5 }}>
          <div style={{ marginBottom: 6 }}>This version of the card cannot be shown. Its content does not match what a {a.type.replace("_", " ")} card needs.</div>
          <div className="muted" style={{ marginBottom: 6 }}>Use <b>History</b> to revert to the commit before this version, or edit the card and restore its previous content.</div>
          <div className="mono muted" style={{ fontSize: 11 }}>{this.state.error.message}</div>
        </div>
      </div>
    );
  }
}

function ArtifactNode({ data, selected }: NodeProps<ArtNode>) {
  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={MIN_W}
        minHeight={MIN_H}
        lineClassName="art-resize-line"
        handleClassName="art-resize-handle"
      />
      <CardBoundary artifact={data.artifact}>
        <ArtifactCard artifact={data.artifact} sessionId={data.sessionId} sized={data.sized} onResetSize={() => data.resetSize(data.artifact.id)} />
      </CardBoundary>
    </>
  );
}

const nodeTypes = { artifact: ArtifactNode };

// Default slots: three columns, and a wide card (alternatives side by side) takes two of them
// so it never lands under its neighbour.
const WIDE_TYPES = new Set<Artifact["type"]>(["alternatives"]);
function defaultPositions(artifacts: Artifact[]): Map<string, { x: number; y: number }> {
  const cols = 3;
  const out = new Map<string, { x: number; y: number }>();
  let col = 0;
  let row = 0;
  for (const a of artifacts) {
    const span = WIDE_TYPES.has(a.type) ? 2 : 1;
    if (col + span > cols) {
      col = 0;
      row += 1;
    }
    out.set(a.id, { x: 40 + col * 460, y: 40 + row * 380 });
    col += span;
    if (col >= cols) {
      col = 0;
      row += 1;
    }
  }
  return out;
}

const GRID_LABEL: Record<GridStyle, string> = { dots: "grid: dots", lines: "grid: lines", off: "grid: off" };

// Viewport animations run on animation frames, which browsers stop for hidden tabs.
const animMs = () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 300 : 0);

// Merge fresh artifact data into the existing node objects. React Flow keeps each node's
// measured size on the object it was given; rebuilding the array from scratch on every
// change threw that away, which made cards render at zero size and the minimap go blank.
function mergeNodes(prev: ArtNode[], artifacts: Artifact[], layout: Record<string, Layout>, sessionId: string, resetSize: (id: string) => void): ArtNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  const defaults = defaultPositions(artifacts);
  return artifacts.map((a) => {
    const l = layout[a.id];
    const pos = l ? { x: l.x, y: l.y } : defaults.get(a.id)!;
    const sized = Boolean(l?.w && l?.h);
    const existing = byId.get(a.id);
    const data = { artifact: a, sessionId, sized, resetSize };
    if (existing) {
      const busy = Boolean(existing.dragging || existing.resizing);
      const samePos = existing.position.x === pos.x && existing.position.y === pos.y;
      const sameSize = existing.width === l?.w && existing.height === l?.h;
      if (existing.data.artifact === a && existing.data.sized === sized && (busy || (samePos && sameSize))) return existing;
      return busy ? { ...existing, data } : { ...existing, data, position: pos, width: l?.w, height: l?.h };
    }
    return { id: a.id, type: "artifact", position: pos, width: l?.w, height: l?.h, data, dragHandle: ".art-head" };
  });
}

function CanvasInner({ sessionId, collab }: { sessionId: string; collab: Collab }) {
  const state = useStore((s) => s.state);
  const focusArtifactId = useStore((s) => s.focusArtifactId);
  const setFocusArtifact = useStore((s) => s.setFocusArtifact);
  const resolved = usePrefs((s) => s.resolved);
  const grid = usePrefs((s) => s.grid);
  const cycleGrid = usePrefs((s) => s.cycleGrid);
  const palette = resolved === "dark" ? { grid: "#2c353e", node: "#3a444e" } : { grid: "#d3dae0", node: "#c9d1d8" };
  const flow = useReactFlow();
  const cursors = useStore((s) => s.cursors);
  const presenceMode = useStore((s) => s.presenceMode);
  const setComposerDraft = useStore((s) => s.setComposerDraft);

  // My pointer, in flow coordinates, a few times a second; others draw it in my colour.
  const lastSent = useRef(0);
  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const now = Date.now();
      if (now - lastSent.current < 40) return;
      lastSent.current = now;
      const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      setCursor({ x: Math.round(p.x), y: Math.round(p.y) });
    },
    [flow],
  );

  const [layout, setLayout] = useState<Record<string, Layout>>({});
  useEffect(() => {
    const read = () => {
      const out: Record<string, Layout> = {};
      collab.nodes.forEach((v, k) => (out[k] = v));
      setLayout(out);
    };
    read();
    collab.nodes.observe(read);
    return () => collab.nodes.unobserve(read);
  }, [collab]);

  const artifacts = useMemo(() => liveArtifacts(state), [state]);

  // Writing defaults before the server document has synced would race the stored layout
  // (a local set on the same key can win the merge), so wait for the first sync.
  const [synced, setSynced] = useState(Boolean(collab.provider.synced));
  useEffect(() => {
    const on = () => setSynced(true);
    if (collab.provider.synced) setSynced(true);
    collab.provider.on("synced", on);
    return () => {
      collab.provider.off("synced", on);
    };
  }, [collab]);

  // Give every new artifact a slot; the first client to notice writes it.
  useEffect(() => {
    if (!synced) return;
    const defaults = defaultPositions(artifacts);
    for (const a of artifacts) {
      if (!collab.nodes.has(a.id)) collab.nodes.set(a.id, defaults.get(a.id)!);
    }
  }, [artifacts, collab, synced]);

  // Drop the stored size so the card goes back to its natural height and default width.
  const resetSize = useCallback(
    (id: string) => {
      const cur = collab.nodes.get(id);
      if (cur) collab.nodes.set(id, { x: cur.x, y: cur.y });
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, width: undefined, height: undefined, style: undefined } : n)));
    },
    [collab],
  );

  const [nodes, setNodes] = useState<ArtNode[]>([]);
  useEffect(() => {
    setNodes((prev) => mergeNodes(prev, artifacts, layout, sessionId, resetSize));
  }, [artifacts, layout, sessionId, resetSize]);

  // Drag end and resize end both arrive here as node changes; write them to the shared layout.
  const onNodesChange = useCallback(
    (changes: NodeChange<ArtNode>[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns));
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) {
          const cur = collab.nodes.get(c.id) ?? { x: 0, y: 0 };
          collab.nodes.set(c.id, { ...cur, x: Math.round(c.position.x), y: Math.round(c.position.y) });
        } else if (c.type === "dimensions" && c.resizing === false && c.dimensions) {
          const cur = collab.nodes.get(c.id) ?? { x: 0, y: 0 };
          collab.nodes.set(c.id, { ...cur, w: Math.round(c.dimensions.width), h: Math.round(c.dimensions.height) });
        }
      }
    },
    [collab],
  );

  // Fit the view once the first cards have been measured, then leave the viewport alone.
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    if (!nodes.every((n) => n.measured?.width)) return;
    fitted.current = true;
    void flow.fitView({ padding: 0.15, maxZoom: 1 });
  }, [nodes, flow]);

  // "Locate" from the sources list: centre on that card and select it.
  useEffect(() => {
    if (!focusArtifactId) return;
    const n = nodes.find((x) => x.id === focusArtifactId);
    if (!n) return;
    const w = n.width ?? n.measured?.width ?? 420;
    const h = n.height ?? n.measured?.height ?? 300;
    void flow.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.min(1, flow.getZoom()), duration: animMs() });
    setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === focusArtifactId })));
    setFocusArtifact(null);
  }, [focusArtifactId, nodes, flow, setFocusArtifact]);

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setCursor(null)}
      onNodeClick={(_, n) => setSelectedArtifact(n.id)}
      onPaneClick={() => setSelectedArtifact(null)}
      minZoom={0.1}
      maxZoom={4}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      colorMode={resolved}
    >
      {grid !== "off" && (
        <Background
          key={grid}
          variant={grid === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={grid === "lines" ? 40 : 24}
          size={grid === "lines" ? 1 : 1.5}
          color={palette.grid}
        />
      )}
      {artifacts.filter((a) => a.type !== "constraints").length === 0 && (() => {
        const t = state.template && isTemplateId(state.template) ? TEMPLATES[state.template] : null;
        const c = completeness(state);
        const starters = t?.starters ?? BLANK_STARTERS;
        return (
          <Panel position="top-center" className="empty-state">
            <div className="mono">{t ? `${t.name}: start here` : "Start here"}</div>
            <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12.5 }}>{t ? t.summary : "Describe the systems involved, state the limits, and the AI builds the model, the views and the decision registry as you go. Everything it does is attributed and governed."}</p>
            {starters.map((s) => (
              <button key={s} onClick={() => setComposerDraft(s)} title="Put this in the AI composer; edit it before sending">{s}</button>
            ))}
            <div className="muted" style={{ fontSize: 12 }}>Have a diagram already? Once the Architecture model card exists, <b>import…</b> on it takes Mermaid, Structurizr DSL or PlantUML. Or paste it here as a note and say "import this".</div>
            {c && (
              <div className="mono" style={{ marginTop: 8, fontSize: 11 }}>
                the checklist wants first: {c.items.filter((i) => !i.done).slice(0, 3).map((i) => i.title).join(" · ")}
              </div>
            )}
          </Panel>
        );
      })()}
      <Panel position="top-right" className="canvas-tools">
        <button className="icon" onClick={() => void flow.fitView({ padding: 0.15, duration: animMs() })} title="Fit every card in view">
          fit
        </button>
        <button className="icon" onClick={cycleGrid} title="Cycle the canvas backdrop: dots, lines, off">
          {GRID_LABEL[grid]}
        </button>
      </Panel>
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={() => palette.node} />
      {presenceMode !== "hide-others" && (
        <ViewportPortal>
          {cursors.map((c) => (
            <div key={c.user.userId} className="live-cursor" style={{ transform: `translate(${c.x}px, ${c.y}px)`, color: c.user.color }}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 2 L16 8 L9 10 L7 17 Z" fill="currentColor" stroke="#fff" strokeWidth="1" /></svg>
              <span className="live-cursor-name" style={{ background: c.user.color }}>{c.user.name}</span>
            </div>
          ))}
        </ViewportPortal>
      )}
    </ReactFlow>
  );
}

export function Canvas(props: { sessionId: string; collab: Collab }) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
