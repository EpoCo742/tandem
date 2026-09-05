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
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import { liveArtifacts, type Artifact } from "@tandem/shared";
import type { Collab, Layout } from "../collab";
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

function defaultPosition(index: number) {
  const cols = 3;
  return { x: 40 + (index % cols) * 460, y: 40 + Math.floor(index / cols) * 380 };
}

const GRID_LABEL: Record<GridStyle, string> = { dots: "grid: dots", lines: "grid: lines", off: "grid: off" };

// Viewport animations run on animation frames, which browsers stop for hidden tabs.
const animMs = () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 300 : 0);

// Merge fresh artifact data into the existing node objects. React Flow keeps each node's
// measured size on the object it was given; rebuilding the array from scratch on every
// change threw that away, which made cards render at zero size and the minimap go blank.
function mergeNodes(prev: ArtNode[], artifacts: Artifact[], layout: Record<string, Layout>, sessionId: string, resetSize: (id: string) => void): ArtNode[] {
  const byId = new Map(prev.map((n) => [n.id, n]));
  return artifacts.map((a, i) => {
    const l = layout[a.id];
    const pos = l ? { x: l.x, y: l.y } : defaultPosition(i);
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
    artifacts.forEach((a, i) => {
      if (!collab.nodes.has(a.id)) collab.nodes.set(a.id, defaultPosition(i));
    });
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
