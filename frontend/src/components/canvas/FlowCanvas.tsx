"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useFlowStore } from "@/stores/flowStore";
import { nodeTypes } from "@/components/nodes";
import { COMPONENT_DEFS } from "@/lib/componentDefs";
import type { NodeData, NodeType } from "@/types/flow";
import type { Connection, Edge, Node, ReactFlowProps, XYPosition } from "@xyflow/react";

type PaneContextMenuEvent = Parameters<NonNullable<ReactFlowProps["onPaneContextMenu"]>>[0];
type ConnectStartEvent = Parameters<NonNullable<ReactFlowProps["onConnectStart"]>>[0];
type ConnectStartParams = Parameters<NonNullable<ReactFlowProps["onConnectStart"]>>[1];
type ConnectEndEvent = Parameters<NonNullable<ReactFlowProps["onConnectEnd"]>>[0];
type ConnectEndState = Parameters<NonNullable<ReactFlowProps["onConnectEnd"]>>[1];

type PaneContextMenuHandler = (
  event: PaneContextMenuEvent,
  flowPosition: XYPosition
) => void;

type LooseConnectHandler = (payload: {
  sourceNodeId: string;
  sourceHandleId: string | null;
  screenPosition: XYPosition;
  flowPosition: XYPosition;
}) => void;

type LooseConnectionState = ConnectEndState & {
  fromNode?: { id: string } | null;
  fromHandle?: { id: string | null } | null;
  toNode?: { id: string } | null;
};

let idCounter = 1;
function uid() {
  return `node_${idCounter++}`;
}

function collectUpstreamEdgeIds(edges: Edge[], selectedNodeId: string | null) {
  const upstreamEdgeIds = new Set<string>();
  if (!selectedNodeId) return upstreamEdgeIds;

  const visitedNodeIds = new Set<string>();
  const stack = [selectedNodeId];

  while (stack.length > 0) {
    const targetNodeId = stack.pop();
    if (!targetNodeId || visitedNodeIds.has(targetNodeId)) continue;
    visitedNodeIds.add(targetNodeId);

    for (const edge of edges) {
      if (edge.target !== targetNodeId) continue;
      upstreamEdgeIds.add(edge.id);
      stack.push(edge.source);
    }
  }

  return upstreamEdgeIds;
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null ||
    target.closest("[role='textbox']") !== null
  );
}

export function FlowCanvas({
  onPaneContextMenu,
  onPaneClick,
  onLooseConnectEnd,
  showMiniMap = true,
  showConnections = true,
}: {
  onPaneContextMenu?: PaneContextMenuHandler;
  onPaneClick?: ReactFlowProps["onPaneClick"];
  onLooseConnectEnd?: LooseConnectHandler;
  showMiniMap?: boolean;
  showConnections?: boolean;
}) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    addNode,
    undo,
    redo,
    copySelection,
    pasteCopiedSelection,
  } = useFlowStore();
  const { screenToFlowPosition } = useReactFlow();
  const connectionStartRef = useRef<{ nodeId: string | null; handleId: string | null } | null>(null);
  const selectedNodeId = useMemo(() => nodes.find((node) => node.selected)?.id ?? null, [nodes]);
  const upstreamEdgeIds = useMemo(() => collectUpstreamEdgeIds(edges, selectedNodeId), [edges, selectedNodeId]);
  const hasUpstreamHighlight = Boolean(selectedNodeId && upstreamEdgeIds.size > 0);
  const curvedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isUpstream = upstreamEdgeIds.has(edge.id);
        const shouldDim = hasUpstreamHighlight && !isUpstream;
        return {
          ...edge,
          type: "default",
          animated: isUpstream ? true : edge.animated,
          className: [
            edge.className,
            isUpstream ? "studio-upstream-edge" : "",
            shouldDim ? "studio-dim-edge" : "",
          ].filter(Boolean).join(" "),
          style: {
            ...edge.style,
            stroke: isUpstream ? "#5EEBFF" : shouldDim ? "#24263a" : edge.style?.stroke ?? "#3b3b54",
            strokeWidth: isUpstream ? 3 : shouldDim ? 1.4 : edge.style?.strokeWidth ?? 2,
            strokeDasharray: isUpstream ? "9 7" : edge.style?.strokeDasharray,
            opacity: shouldDim ? 0.32 : edge.style?.opacity,
          },
        };
      }),
    [edges, hasUpstreamHighlight, upstreamEdgeIds]
  );

  const emitLooseConnectEnd = useCallback(
    (screenPosition: XYPosition, state?: Partial<LooseConnectionState>) => {
      const startedFrom = connectionStartRef.current;
      const sourceNodeId = state?.fromNode?.id ?? startedFrom?.nodeId;
      const sourceHandleId = state?.fromHandle?.id ?? startedFrom?.handleId ?? null;
      if (!sourceNodeId || state?.toNode) return;

      connectionStartRef.current = null;
      onLooseConnectEnd?.({
        sourceNodeId,
        sourceHandleId,
        screenPosition,
        flowPosition: screenToFlowPosition(screenPosition),
      });
    },
    [onLooseConnectEnd, screenToFlowPosition]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/nodelist-type") as NodeType;
      if (!type) return;

      const def = COMPONENT_DEFS.find((d) => d.type === type);
      if (!def) return;

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const node: Node<NodeData> = {
        id: uid(),
        type,
        position,
        data: {
          label: def.label,
          description: def.description,
          config: { ...def.defaultConfig },
        },
      };
      addNode(node);
    },
    [screenToFlowPosition, addNode]
  );

  const handlePaneContextMenu: ReactFlowProps["onPaneContextMenu"] = useCallback(
    (event: PaneContextMenuEvent) => {
      const flowPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      onPaneContextMenu?.(event, flowPosition);
    },
    [onPaneContextMenu, screenToFlowPosition]
  );

  const handleConnectStart: ReactFlowProps["onConnectStart"] = useCallback((_: ConnectStartEvent, params: ConnectStartParams) => {
    connectionStartRef.current = {
      nodeId: params.nodeId,
      handleId: params.handleId,
    };
  }, []);

  const handleConnect = useCallback(
    (connection: Connection) => {
      connectionStartRef.current = null;
      onConnect(connection);
    },
    [onConnect]
  );

  const handleConnectEnd: ReactFlowProps["onConnectEnd"] = useCallback(
    (event: ConnectEndEvent, connectionState: ConnectEndState) => {
      const looseState = connectionState as LooseConnectionState;
      if (looseState.toNode) {
        connectionStartRef.current = null;
        return;
      }

      const pointer = "changedTouches" in event && event.changedTouches.length > 0
        ? event.changedTouches[0]
        : "clientX" in event
          ? event
          : null;
      if (!pointer) return;

      emitLooseConnectEnd({ x: pointer.clientX, y: pointer.clientY }, looseState);
    },
    [emitLooseConnectEnd]
  );

  useEffect(() => {
    const handleDocumentMouseUp = (event: MouseEvent) => {
      if (!connectionStartRef.current?.nodeId) return;
      const screenPosition = { x: event.clientX, y: event.clientY };
      window.setTimeout(() => emitLooseConnectEnd(screenPosition), 0);
    };

    const handleDocumentTouchEnd = (event: TouchEvent) => {
      if (!connectionStartRef.current?.nodeId || event.changedTouches.length === 0) return;
      const touch = event.changedTouches[0];
      const screenPosition = { x: touch.clientX, y: touch.clientY };
      window.setTimeout(() => emitLooseConnectEnd(screenPosition), 0);
    };

    document.addEventListener("mouseup", handleDocumentMouseUp);
    document.addEventListener("touchend", handleDocumentTouchEnd);
    return () => {
      document.removeEventListener("mouseup", handleDocumentMouseUp);
      document.removeEventListener("touchend", handleDocumentTouchEnd);
    };
  }, [emitLooseConnectEnd]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        const didApply = event.shiftKey ? redo() : undo();
        if (didApply) event.preventDefault();
        return;
      }

      if (key === "y") {
        if (redo()) event.preventDefault();
        return;
      }

      if (key === "c") {
        if (copySelection()) event.preventDefault();
        return;
      }

      if (key === "v") {
        if (pasteCopiedSelection()) event.preventDefault();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [copySelection, pasteCopiedSelection, redo, undo]);

  return (
    <div className="h-full flex-1">
      <ReactFlow
        nodes={nodes}
        edges={showConnections ? curvedEdges : []}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEnd}
        connectionLineType={ConnectionLineType.Bezier}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        defaultEdgeOptions={{
          type: "default",
          style: { stroke: "#3b3b54", strokeWidth: 2 },
        }}
        className="studio-flow bg-[#030306]"
      >
        <Background gap={28} size={1.6} color="#202436" />
        <Controls className="!border-white/10 !bg-[#111118]/90 !text-zinc-200" />
        {showMiniMap && (
          <MiniMap
            nodeColor="#8b5cf6"
            maskColor="rgba(3,3,6,0.68)"
            className="!border-white/10 !bg-[#111118]/90"
          />
        )}
      </ReactFlow>
    </div>
  );
}
