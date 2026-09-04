import { useCallback, useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type NodeProps, type NodeChange, applyNodeChanges } from "@xyflow/react";
import { liveArtifacts, type Artifact } from "@tandem/shared";
import type { Collab } from "../collab";
import { useStore } from "../state/store";
import { ArtifactCard } from "./ArtifactCard";

type ArtNode = Node<{ artifact: Artifact; sessionId: string }, "artifact">;

function ArtifactNode({ data }: NodeProps<ArtNode>) {
  return <ArtifactCard artifact={data.artifact} sessionId={data.sessionId} />;
}

const nodeTypes = { artifact: ArtifactNode };

function defaultPosition(index: number) {
  const cols = 3;
  return { x: 40 + (index % cols) * 460, y: 40 + Math.floor(index / cols) * 380 };
}

export function Canvas({ sessionId, collab }: { sessionId: string; collab: Collab }) {
  const state = useStore((s) => s.state);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Mirror the Yjs layout map into React state.
  useEffect(() => {
    const read = () => {
      const out: Record<string, { x: number; y: number }> = {};
      collab.nodes.forEach((v, k) => (out[k] = v));
      setPositions(out);
    };
    read();
    collab.nodes.observe(read);
    return () => collab.nodes.unobserve(read);
  }, [collab]);

  const artifacts = useMemo(() => liveArtifacts(state), [state]);

  // Assign a position to any artifact that lacks one (first client to notice writes it).
  useEffect(() => {
    artifacts.forEach((a, i) => {
      if (!collab.nodes.has(a.id)) collab.nodes.set(a.id, defaultPosition(i));
    });
  }, [artifacts, collab]);

  const nodes: ArtNode[] = useMemo(
    () =>
      artifacts.map((a, i) => ({
        id: a.id,
        type: "artifact",
        position: positions[a.id] ?? defaultPosition(i),
        data: { artifact: a, sessionId },
        dragHandle: ".art-head",
      })),
    [artifacts, positions, sessionId],
  );

  const [localNodes, setLocalNodes] = useState<ArtNode[]>(nodes);
  useEffect(() => setLocalNodes(nodes), [nodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<ArtNode>[]) => {
      setLocalNodes((ns) => applyNodeChanges(changes, ns));
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) collab.nodes.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
      }
    },
    [collab],
  );

  return (
    <ReactFlow nodes={localNodes} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView minZoom={0.2} maxZoom={1.5} proOptions={{ hideAttribution: true }}>
      <Background gap={24} color="#d3dae0" />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={() => "#c9d1d8"} />
    </ReactFlow>
  );
}
