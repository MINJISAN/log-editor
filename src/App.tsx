import React, { useCallback, useMemo, useReducer, useRef, useState, useEffect } from "react";

import ReactFlow, {
  Background,
  Controls,
  //MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  MarkerType,
  ReactFlowProvider,
  type NodeChange,
  type EdgeChange,
  Handle,
  Position,
} from "reactflow";

import type { Node, Edge, Connection } from "reactflow";


import "reactflow/dist/style.css";


/**
 * Outer-Wilds-like Ship Log Editor (MVP)
 * - Node CRUD
 * - Node: title + detail items (count badge)
 * - Node size proportional to details count
 * - Node color label
 * - Edge connect + edge meta details (no count badge)
 * - JSON export/import
 */
const STORAGE_KEY = "ow_shiplog_snapshot_v1";

function safeParseSnapshot(raw: string | null): Snapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.nodes || !parsed?.edges) return null;
    return parsed as Snapshot;
  } catch {
    return null;
  }
}


type ColorLabel = "purple" | "orange" | "green" | "blue" | "gray" | "red" | "yellow" | "teal";

type DetailItem = { id: string; text: string };
type EdgeMetaItem = { id: string; text: string };

type ConceptNodeData = {
  title: string;
  color: ColorLabel;
  details: DetailItem[];
};

type ConceptEdgeData = {
  meta: EdgeMetaItem[];
};

const colorPalette: Record<ColorLabel, { border: string; header: string; badge: string }> = {
  purple: { 
    border: "#8b5cf6", 
    header: "rgba(139,92,246,0.25)", 
    badge: "rgba(139,92,246,0.35)" },

  orange: { 
    border: "#f97316", 
    header: "rgba(249,115,22,0.25)", 
    badge: "rgba(249,115,22,0.35)" },

  green: { 
    border: "#22c55e", 
    header: "rgba(34,197,94,0.25)", 
    badge: "rgba(34,197,94,0.35)" },

  blue: { 
    border: "#3b82f6", 
    header: "rgba(59,130,246,0.25)", 
    badge: "rgba(59,130,246,0.35)" },

  gray: { 
    border: "#9ca3af", 
    header: "rgba(156,163,175,0.18)", 
    badge: "rgba(156,163,175,0.28)" },

  red: {
    border: "#f87171",
    header: "rgba(248,113,113,0.35)",
    badge: "rgba(248,113,113,0.45)",
  },

  yellow: {
    border: "#facc15",
    header: "rgba(250,204,21,0.30)",
    badge: "rgba(250,204,21,0.45)",
  },

  teal: {
    border: "#2dd4bf",
    header: "rgba(45,212,191,0.30)",
    badge: "rgba(45,212,191,0.45)",
  },

};

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function calcNodeSize(_: number) {
  return { width: 220, height: 56 };
}

function ConceptNodeView(props: { data: ConceptNodeData }) {
  const { title, color, details } = props.data;
  const n = details.length;
  const { width, height } = calcNodeSize(n);
  const c = colorPalette[color];

  return (
    <div
      style={{
        position: "relative", // ✅ 추가 (Handle 위치용)
        width,
        height,
        border: `2px solid ${c.border}`,
        borderRadius: 10,
        background: "rgba(10, 18, 32, 0.70)",
        boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ✅ 연결 핸들 2개: 좌(입력), 우(출력) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 10,
          height: 10,
          background: "rgba(220,240,255,0.9)",
          border: "1px solid rgba(0,0,0,0.35)",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 10,
          height: 10,
          background: "rgba(220,240,255,0.9)",
          border: "1px solid rgba(0,0,0,0.35)",
        }}
      />

      <div
        className="drag-handle"
        style={{
          padding: "8px 10px",
          background: c.header,
          fontSize: 12,
          letterSpacing: 0.2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          cursor: "grab",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: 0.4,
            color: "rgba(255,255,255,0.92)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title || "Untitled"}
        </div>

        <div
          title="내부정보 개수"
          style={{
            minWidth: 28,
            textAlign: "center",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            color: "rgba(255,255,255,0.92)",
            background: c.badge,
            border: `1px solid ${c.border}`,
          }}
        >
          {n}
        </div>
      </div>
    </div>
  );
}


type Snapshot = {
  nodes: Node<ConceptNodeData>[];
  edges: Edge<ConceptEdgeData>[];
};

type HistoryState = {
  past: Snapshot[];
  present: Snapshot;
  future: Snapshot[];
};

type HistoryAction =
  | { type: "SET"; snapshot: Snapshot; record?: boolean }
  | { type: "UNDO" }
  | { type: "REDO" };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case "SET": {
      const record = action.record ?? true;
      if (!record) return { ...state, present: action.snapshot };
      return {
        past: [...state.past, state.present],
        present: action.snapshot,
        future: [],
      };
    }
    case "UNDO": {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
      };
    }
    default:
      return state;
  }
}

function AppInner() {
  // 초기 데이터
  const initialSnapshot: Snapshot = useMemo(() => {
    const n1: Node<ConceptNodeData> = {
      id: uid("node"),
      type: "concept",
      position: { x: 150, y: 120 },
      data: { title: "Quantum Moon", color: "purple", details: [{ id: uid("d"), text: "관측과 위치의 상호작용" }] },
    };
    const n2: Node<ConceptNodeData> = {
      id: uid("node"),
      type: "concept",
      position: { x: 520, y: 280 },
      data: { title: "Ash Twin Project", color: "orange", details: [{ id: uid("d"), text: "에너지/시간 루프 관련" }, { id: uid("d"), text: "22분 단위로 리셋" }] },
    };
    const e1: Edge<ConceptEdgeData> = {
      id: uid("edge"),
      source: n1.id,
      target: n2.id,
      type: "default",
      markerEnd: { type: MarkerType.ArrowClosed },
      data: { meta: [{ id: uid("m"), text: "관련 단서 존재" }] },
    };
    return { nodes: [n1, n2], edges: [e1] };
  }, []);
  
  const loadedFromStorage = useMemo(() => {
    return safeParseSnapshot(localStorage.getItem(STORAGE_KEY));
  }, []);

  const initialForApp: Snapshot = loadedFromStorage ?? initialSnapshot;


  const [history, dispatchHistory] = useReducer(historyReducer, {
    past: [],
    present: initialForApp,
    future: [],
  });

  // React Flow 상태 동기화를 위해 present를 source of truth로 둠
  const [nodes, setNodes, onNodesChange] = useNodesState<ConceptNodeData>(history.present.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ConceptEdgeData>(history.present.edges);

  // present 변경 시 nodes/edges도 갱신 (undo/redo)
  React.useEffect(() => {
    setNodes(history.present.nodes);
    setEdges(history.present.edges);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.present));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.present]);

  // 선택 상태
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const rfWrapperRef = useRef<HTMLDivElement | null>(null);

  const nodeTypes = useMemo(
    () => ({
      concept: ConceptNodeView,
    }),
    []
  );

  const syncToHistory = useCallback(
    (nextNodes: Node<ConceptNodeData>[], nextEdges: Edge<ConceptEdgeData>[], record = true) => {
      dispatchHistory({ type: "SET", snapshot: { nodes: nextNodes, edges: nextEdges }, record });
    },
    []
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: Edge<ConceptEdgeData> = {
        id: uid("edge"),
        source: connection.source!,
        target: connection.target!,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { meta: [] },
      };
      const nextEdges = addEdge(newEdge, edges);
      syncToHistory(nodes, nextEdges, true);
    },
    [edges, nodes, syncToHistory]
  );

  const addNodeAtCenter = useCallback(() => {
    // 간단히 화면 중앙 근처에 생성 (정교한 좌표 변환은 나중에 확대 가능)
    const newNode: Node<ConceptNodeData> = {
      id: uid("node"),
      type: "concept",
      position: { x: 280 + Math.random() * 120, y: 160 + Math.random() * 120 },
      data: { title: "New Concept", color: "gray", details: [] },
    };
    syncToHistory([...nodes, newNode], edges, true);
  }, [edges, nodes, syncToHistory]);

  const deleteSelection = useCallback(() => {
    if (selectedNodeId) {
      const nextNodes = nodes.filter((n) => n.id !== selectedNodeId);
      const nextEdges = edges.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId);
      setSelectedNodeId(null);
      syncToHistory(nextNodes, nextEdges, true);
      return;
    }
    if (selectedEdgeId) {
      const nextEdges = edges.filter((e) => e.id !== selectedEdgeId);
      setSelectedEdgeId(null);
      syncToHistory(nodes, nextEdges, true);
    }
  }, [edges, nodes, selectedEdgeId, selectedNodeId, syncToHistory]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((e) => e.id === selectedEdgeId) ?? null, [edges, selectedEdgeId]);

  const updateSelectedNode = useCallback(
    (patch: Partial<ConceptNodeData>) => {
      if (!selectedNode) return;
      const nextNodes = nodes.map((n) => (n.id === selectedNode.id ? { ...n, data: { ...n.data, ...patch } } : n));
      syncToHistory(nextNodes, edges, true);
    },
    [edges, nodes, selectedNode, syncToHistory]
  );

  const addNodeDetail = useCallback(
    (text: string) => {
      if (!selectedNode) return;
      const newItem: DetailItem = { id: uid("d"), text };
      const nextDetails = [...selectedNode.data.details, newItem];
      updateSelectedNode({ details: nextDetails });
    },
    [selectedNode, updateSelectedNode]
  );

  const updateNodeDetail = useCallback(
    (id: string, text: string) => {
      if (!selectedNode) return;
      const nextDetails = selectedNode.data.details.map((d) => (d.id === id ? { ...d, text } : d));
      updateSelectedNode({ details: nextDetails });
    },
    [selectedNode, updateSelectedNode]
  );

  const deleteNodeDetail = useCallback(
    (id: string) => {
      if (!selectedNode) return;
      const nextDetails = selectedNode.data.details.filter((d) => d.id !== id);
      updateSelectedNode({ details: nextDetails });
    },
    [selectedNode, updateSelectedNode]
  );

  const updateSelectedEdge = useCallback(
    (patch: Partial<ConceptEdgeData>) => {
      if (!selectedEdge) return;
      const nextEdges = edges.map((e) => (e.id === selectedEdge.id ? { ...e, data: { ...(e.data ?? { meta: [] }), ...patch } } : e));
      syncToHistory(nodes, nextEdges, true);
    },
    [edges, nodes, selectedEdge, syncToHistory]
  );

  const addEdgeMeta = useCallback(
    (text: string) => {
      if (!selectedEdge) return;
      const cur = selectedEdge.data?.meta ?? [];
      const next = [...cur, { id: uid("m"), text }];
      updateSelectedEdge({ meta: next });
    },
    [selectedEdge, updateSelectedEdge]
  );

  const updateEdgeMeta = useCallback(
    (id: string, text: string) => {
      if (!selectedEdge) return;
      const cur = selectedEdge.data?.meta ?? [];
      const next = cur.map((m) => (m.id === id ? { ...m, text } : m));
      updateSelectedEdge({ meta: next });
    },
    [selectedEdge, updateSelectedEdge]
  );

  const deleteEdgeMeta = useCallback(
    (id: string) => {
      if (!selectedEdge) return;
      const cur = selectedEdge.data?.meta ?? [];
      const next = cur.filter((m) => m.id !== id);
      updateSelectedEdge({ meta: next });
    },
    [selectedEdge, updateSelectedEdge]
  );

  const exportJSON = useCallback(() => {
    const payload: Snapshot = { nodes, edges };
    const text = JSON.stringify(payload, null, 2);

    // navigator.clipboard.writeText(text);
    // alert("JSON이 클립보드에 복사되었습니다.");

    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = `shiplog_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }, [edges, nodes]);

  const importJSON = useCallback(() => {
    // const text = prompt("붙여넣기: nodes/edges JSON");
    // if (!text) return;
    // try {
    //   const parsed = JSON.parse(text) as Snapshot;
    //   if (!parsed?.nodes || !parsed?.edges) throw new Error("Invalid shape");

    //   // 최소 방어: type 미지정 노드에 기본 type 부여
    //   const nextNodes = parsed.nodes.map((n) => ({
    //     ...n,
    //     type: (n as any).type ?? "concept",
    //     data: {
    //       title: (n as any).data?.title ?? "Untitled",
    //       color: (n as any).data?.color ?? "gray",
    //       details: (n as any).data?.details ?? [],
    //     } satisfies ConceptNodeData,
    //   }));

    //   const nextEdges = parsed.edges.map((e) => ({
    //     ...e,
    //     markerEnd: (e as any).markerEnd ?? { type: MarkerType.ArrowClosed },
    //     data: {
    //       meta: (e as any).data?.meta ?? [],
    //     } satisfies ConceptEdgeData,
    //   }));

    //   setSelectedNodeId(null);
    //   setSelectedEdgeId(null);
    //   syncToHistory(nextNodes, nextEdges, true);
    // } catch {
    //   alert("JSON 파싱 실패: 형식을 확인하세요.");
    // }

    const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
        try {
          const text = event.target?.result as string;
          const parsed = JSON.parse(text) as Snapshot;
          if (!parsed?.nodes || !parsed?.edges) throw new Error("Invalid shape");

          const nextNodes = parsed.nodes.map((n) => ({
          ...n,
          type: (n as any).type ?? "concept",
          data: {
            title: (n as any).data?.title ?? "Untitled",
            color: (n as any).data?.color ?? "gray",
            details: (n as any).data?.details ?? [],
          } satisfies ConceptNodeData,
          }));

          const nextEdges = parsed.edges.map((e) => ({
          ...e,
          markerEnd: (e as any).markerEnd ?? { type: MarkerType.ArrowClosed },
          data: {
            meta: (e as any).data?.meta ?? [],
          } satisfies ConceptEdgeData,
          }));

          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          syncToHistory(nextNodes, nextEdges, true);
        } catch {
          alert("JSON 파싱 실패: 형식을 확인하세요.");
        }
        };
        reader.readAsText(file);
      };
      input.click();
  }, [syncToHistory]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  const onNodeClick = useCallback((_evt: any, node: Node) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
  }, []);

  const onEdgeClick = useCallback((_evt: any, edge: Edge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatchHistory({ type: "UNDO" });
        return;
      }
      if ((mod && e.key.toLowerCase() === "z" && e.shiftKey) || (mod && e.key.toLowerCase() === "y")) {
        e.preventDefault();
        dispatchHistory({ type: "REDO" });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        // 입력창에서의 백스페이스는 제외
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key.toLowerCase() === "n") {
        // 폼 입력 중엔 제외
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        addNodeAtCenter();
      }
    },
    [addNodeAtCenter, deleteSelection]
  );

  // 노드 크기 업데이트를 data 변화에 반영하기 위해 style을 계산해 둠 (렌더는 Node 컴포넌트 내부에서)
  const sizedNodes = useMemo(() => {
    return nodes.map((n) => {
      const count = n.data?.details?.length ?? 0;
      const { width, height } = calcNodeSize(count);
      return { ...n, style: { width, height } };
    });
  }, [nodes]);

  return (
    <div
      ref={rfWrapperRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "320px 1fr 360px",
        background: "linear-gradient(180deg, rgb(6,10,20), rgb(4,8,14))",
        color: "rgba(255,255,255,0.9)",
        outline: "none",
      }}
    >
      {/* Left Panel */}
      <div style={{ borderRight: "1px solid rgba(255,255,255,0.08)", padding: 14 }}>
        <div style={{ fontWeight: 800, letterSpacing: 0.4, marginBottom: 10 }}>Ship Log Editor</div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={addNodeAtCenter} style={btnPrimary}>
            + Node (N)
          </button>
          <button onClick={deleteSelection} style={btnDanger}>
            Delete (Del)
          </button>
          <button onClick={() => dispatchHistory({ type: "UNDO" })} style={btn}>
            Undo
          </button>
          <button onClick={() => dispatchHistory({ type: "REDO" })} style={btn}>
            Redo
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={exportJSON} style={btn}>
            Export JSON
          </button>
          <button onClick={importJSON} style={btn}>
            Import JSON
          </button>
        </div>

        <div style={{ opacity: 0.85, fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>사용법</div>
          <div>• 노드 클릭 → 오른쪽에서 제목/라벨/내부정보 편집</div>
          <div>• 노드끼리 드래그 연결 → 화살표 생성</div>
          <div>• 엣지 클릭 → 오른쪽에서 엣지 메타 편집</div>
          <div>• 노드 크기 = 내부정보 개수에 비례</div>
        </div>

        <div style={{ marginTop: 16, opacity: 0.9, fontSize: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Color Labels</div>
          <div style={{ display: "grid", gap: 8 }}>
            {(["purple", "orange", "green", "blue", "gray", "red","yellow","teal",] as ColorLabel[]).map((c) => (
              <div key={c} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: colorPalette[c].border, display: "inline-block" }} />
                <span style={{ textTransform: "uppercase", opacity: 0.85 }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ position: "relative" }}>
        <ReactFlow
          nodes={sizedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes: NodeChange[]) => {
            onNodesChange(changes);
            // onNodesChange는 내부적으로 setNodes만 바꾸므로, 실제 확정은 drag stop 등에서 기록하는 편이 이상적.
            // MVP에서는 change 발생 후 즉시 기록(기록량 많아질 수 있음). 필요한 경우 "onNodeDragStop"로 최적화 가능.
          }}
          onEdgesChange={(changes: EdgeChange[]) => {
            onEdgesChange(changes);
          }}
          onConnect={onConnect}
          onPaneClick={onPaneClick}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          defaultEdgeOptions={{
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { strokeWidth: 2, stroke: "rgba(220,240,255,0.55)" },
          }}
          style={{ background: "transparent" }}
        >
          {/*
          <MiniMap
            nodeStrokeColor={(n: Node) => {
              const c = (n.data as any)?.color as ColorLabel | undefined;
              return c ? colorPalette[c].border : "#9ca3af";
            }}
            nodeColor={(n: Node) => {
              const c = (n.data as any)?.color as ColorLabel | undefined;
              return c ? colorPalette[c].header : "rgba(156,163,175,0.18)";
            }}
            maskColor="rgba(0,0,0,0.35)"
          />
          */}
          <Controls />
          <Background gap={24} size={1} />
        </ReactFlow>
        {/* Bottom Details Panel */}
        {selectedNode ? (
          <div
            style={{
              position: "absolute",
              left: 64,
              right: 16,
              bottom: 16,
              height: 280,
              display: "flex",
              borderRadius: 12,
              flexDirection: "column",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(0,0,0,0.55)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              overflow: "hidden",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ fontWeight: 800, fontSize: 13 }}>
                {selectedNode.data.title} — Details
              </div>
              <button
                style={btn}
                onClick={() => setSelectedNodeId(null)}
              >
                Close
              </button>
            </div>

            <div
              style={{
                padding: 12,
                overflow: "auto",
                fontSize: 13,
                lineHeight: 1.55,
                color: "rgba(255,255,255,0.85)",
                whiteSpace: "pre-wrap", // ✅ 줄바꿈 유지 핵심
              }}
            >
              {selectedNode.data.details.length === 0 ? (
                <div style={{ opacity: 0.85 }}>내부 정보가 없습니다.</div>
              ) : (
                selectedNode.data.details.map((d, i) => (
                  <div key={d.id} style={{ marginBottom: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>
                      #{i + 1}
                    </div>
                    <div>{d.text}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}

      </div>

      {/* Right Panel (Inspector) */}
      <div style={{ borderLeft: "1px solid rgba(255,255,255,0.08)", padding: 14, overflow: "auto" }}>
        <div style={{ fontWeight: 800, letterSpacing: 0.4, marginBottom: 10 }}>Inspector</div>

        {!selectedNode && !selectedEdge ? (
          <div style={{ opacity: 0.75, fontSize: 13, lineHeight: 1.5 }}>
            노드 또는 엣지를 선택하면 상세 편집이 표시됩니다.
          </div>
        ) : null}

        {selectedNode ? (
          <NodeInspector
            node={selectedNode}
            onChange={(patch) => updateSelectedNode(patch)}
            onAddDetail={addNodeDetail}
            onUpdateDetail={updateNodeDetail}
            onDeleteDetail={deleteNodeDetail}
          />
        ) : null}

        {selectedEdge ? (
          <EdgeInspector
            edge={selectedEdge}
            onAddMeta={addEdgeMeta}
            onUpdateMeta={updateEdgeMeta}
            onDeleteMeta={deleteEdgeMeta}
          />
        ) : null}
      </div>
    </div>
  );
}

function NodeInspector(props: {
  node: Node<ConceptNodeData>;
  onChange: (patch: Partial<ConceptNodeData>) => void;
  onAddDetail: (text: string) => void;
  onUpdateDetail: (id: string, text: string) => void;
  onDeleteDetail: (id: string) => void;
}) {
  const { node, onChange, onAddDetail, onUpdateDetail, onDeleteDetail } = props;
  const [newDetail, setNewDetail] = useState("");

  const [localTitle, setLocalTitle] = useState(node.data.title);
  
  useEffect(() => {
    setLocalTitle(node.data.title);
  }, [node.id, node.data.title]);

  const { width, height } = calcNodeSize(node.data.details.length);

  return (
    <div style={panelCard}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontWeight: 800 }}>Node</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          size: {width}×{height}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={label}>Title</div>
        <input
          style={input}
          value={localTitle} // 3. value는 로컬 상태를 바라보게 함
          onChange={(e) => {
            const val = e.target.value;
            setLocalTitle(val); // 로컬 상태 업데이트 (한글 안 씹힘)
            onChange({ title: val }); // 부모 상태 업데이트
          }}
          placeholder="제목"
        />
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={label}>Color Label</div>
      <select
        style={input}
        value={node.data.color}
        onChange={(e) => onChange({ color: e.target.value as ColorLabel })}
      >
        {(Object.keys(colorPalette) as ColorLabel[]).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={label}>Details ({node.data.details.length})</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>노드 배지/크기에 반영됨</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={newDetail}
            onChange={(e) => setNewDetail(e.target.value)}
            placeholder="내부정보 추가"
          />
          <button
            style={btnPrimary}
            onClick={() => {
              const t = newDetail.trim();
              if (!t) return;
              onAddDetail(t);
              setNewDetail("");
            }}
          >
            Add
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {node.data.details.map((d) => (
            <div key={d.id} style={listRow}>
              <input style={{ ...input, flex: 1 }} value={d.text} onChange={(e) => onUpdateDetail(d.id, e.target.value)} />
              <button style={btnDanger} onClick={() => onDeleteDetail(d.id)}>
                Del
              </button>
            </div>
          ))}
          {node.data.details.length === 0 ? <div style={{ opacity: 0.7, fontSize: 12 }}>아직 내부정보가 없습니다.</div> : null}
        </div>
      </div>
    </div>
  );
}

function EdgeInspector(props: {
  edge: Edge<ConceptEdgeData>;
  onAddMeta: (text: string) => void;
  onUpdateMeta: (id: string, text: string) => void;
  onDeleteMeta: (id: string) => void;
}) {
  const { edge, onAddMeta, onUpdateMeta, onDeleteMeta } = props;
  const [newMeta, setNewMeta] = useState("");
  const meta = edge.data?.meta ?? [];

  return (
    <div style={panelCard}>
      <div style={{ fontWeight: 800 }}>Edge</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
        {edge.source} → {edge.target}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={label}>Edge Meta (count 표기 없음)</div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            style={{ ...input, flex: 1 }}
            value={newMeta}
            onChange={(e) => setNewMeta(e.target.value)}
            placeholder="엣지 내부정보 추가"
          />
          <button
            style={btnPrimary}
            onClick={() => {
              const t = newMeta.trim();
              if (!t) return;
              onAddMeta(t);
              setNewMeta("");
            }}
          >
            Add
          </button>
        </div>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {meta.map((m) => (
            <div key={m.id} style={listRow}>
              <input style={{ ...input, flex: 1 }} value={m.text} onChange={(e) => onUpdateMeta(m.id, e.target.value)} />
              <button style={btnDanger} onClick={() => onDeleteMeta(m.id)}>
                Del
              </button>
            </div>
          ))}
          {meta.length === 0 ? <div style={{ opacity: 0.7, fontSize: 12 }}>아직 엣지 메타가 없습니다.</div> : null}
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.9)",
  fontWeight: 700,
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "rgba(59,130,246,0.20)",
  border: "1px solid rgba(59,130,246,0.35)",
};

const btnDanger: React.CSSProperties = {
  ...btn,
  background: "rgba(239,68,68,0.16)",
  border: "1px solid rgba(239,68,68,0.35)",
};

const panelCard: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 12,
  padding: 12,
  background: "rgba(255,255,255,0.04)",
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  opacity: 0.8,
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.18)",
  color: "rgba(255,255,255,0.92)",
  outline: "none",
};

const listRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

export default function App() {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  );
}
