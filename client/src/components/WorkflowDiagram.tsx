import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Search, Target, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const NODE_WIDTH = 180;
const NODE_MIDDLE_Y = 52;
const NODE_OUT_X = NODE_WIDTH - 10;
const NODE_IN_X = 10;

type DiagramNode = {
  name: string;
  type: string;
  position: [number, number];
  disabled?: boolean;
  incoming?: string[];
  outgoing?: string[];
};

type DiagramProps = {
  nodes: DiagramNode[];
  connections: Record<string, unknown>;
  selectedNodeName: string | null;
  onSelectNode: (nodeName: string) => void;
  executionNodeStatuses?: Record<string, string>;
};

function nodeStatusClass(status?: string) {
  if (status === "success") return "fill-[#DBF7EA] stroke-[#258B57]";
  if (status === "error") return "fill-[#FFF0E7] stroke-[#BD6338]";
  if (status === "running") return "fill-[#E8ECFF] stroke-[#4355D8]";
  return "fill-white stroke-[#CFD5E6]";
}

function buildEdges(connections: Record<string, unknown>) {
  const edges: Array<{ from: string; to: string }> = [];
  for (const [sourceName, ports] of Object.entries(connections || {})) {
    for (const values of Object.values((ports || {}) as Record<string, unknown>)) {
      if (!Array.isArray(values)) continue;
      for (const lane of values) {
        if (!Array.isArray(lane)) continue;
        for (const connection of lane) {
          const target = String((connection as Record<string, unknown>)?.node || "");
          if (target) edges.push({ from: sourceName, to: target });
        }
      }
    }
  }
  return edges;
}

export default function WorkflowDiagram({ nodes, connections, selectedNodeName, onSelectNode, executionNodeStatuses }: DiagramProps) {
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const lowered = search.trim().toLowerCase();
  const visibleNodes = useMemo(() => nodes.filter((node) => !lowered || node.name.toLowerCase().includes(lowered) || node.type.toLowerCase().includes(lowered)), [nodes, lowered]);
  const visibleNames = new Set((visibleNodes.length ? visibleNodes : nodes).map((node) => node.name));
  const edges = useMemo(() => buildEdges(connections).filter((edge) => visibleNames.has(edge.from) && visibleNames.has(edge.to)), [connections, visibleNames]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes]);
  const renderNodes = visibleNodes.length ? visibleNodes : nodes;

  const layout = useMemo(() => {
    const source = renderNodes;
    if (!source.length) {
      return {
        minX: 0,
        minY: 0,
        width: 1200,
        height: 700,
        offsetX: 140,
        offsetY: 100,
      };
    }
    const xs = source.map((node) => Number(node.position?.[0] || 0));
    const ys = source.map((node) => Number(node.position?.[1] || 0));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return {
      minX,
      minY,
      width: maxX - minX + 520,
      height: maxY - minY + 360,
      offsetX: 140 - minX,
      offsetY: 100 - minY,
    };
  }, [renderNodes]);

  const centerDiagram = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    centerDiagram();
  }, [nodes.length, search]);

  function displayPosition(node: DiagramNode) {
    return {
      x: Number(node.position?.[0] || 0) + layout.offsetX,
      y: Number(node.position?.[1] || 0) + layout.offsetY,
    };
  }

  const viewportHeight = Math.max(560, Math.min(820, layout.height + 80));
  const contentWidth = Math.max(1200, layout.width);
  const contentHeight = Math.max(viewportHeight, layout.height + 40);

  return (
    <div className="rounded-[28px] border border-[#E5E8F2] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#EEF0F6] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#11183D]">Diagrama operacional</p>
          <p className="mt-1 text-xs text-[#667085]">Layout real do n8n com busca, zoom, navegacao e selecao de nodes.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#98A2B3]" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar node" className="h-9 w-[220px] pl-9 text-xs" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setZoom((value) => Math.max(0.4, Number((value - 0.15).toFixed(2))))}><Minus className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setZoom((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))))}><Plus className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={centerDiagram}><Target className="mr-2 h-4 w-4" />Centralizar</Button>
        </div>
      </div>

      <div
        className={`relative overflow-hidden rounded-b-[28px] bg-[radial-gradient(circle_at_top,#F8FAFF,transparent_42%),linear-gradient(180deg,#FCFDFF_0%,#F4F7FC_100%)] select-none ${dragStart ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ height: viewportHeight }}
        onMouseDown={(event) => {
          if ((event.target as HTMLElement)?.closest("button")) return;
          event.preventDefault();
          setDragStart({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
        }}
        onMouseMove={(event) => {
          if (!dragStart) return;
          event.preventDefault();
          setPan({ x: dragStart.panX + event.clientX - dragStart.x, y: dragStart.panY + event.clientY - dragStart.y });
        }}
        onMouseUp={() => setDragStart(null)}
        onMouseLeave={() => setDragStart(null)}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(67,85,216,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(67,85,216,0.05)_1px,transparent_1px)] bg-[size:32px_32px]" />
        <svg className="absolute inset-0 h-full w-full">
          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {edges.map((edge, index) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;
              const fromPosition = displayPosition(from);
              const toPosition = displayPosition(to);
              const fromX = fromPosition.x + NODE_OUT_X;
              const fromY = fromPosition.y + NODE_MIDDLE_Y;
              const toX = toPosition.x + NODE_IN_X;
              const toY = toPosition.y + NODE_MIDDLE_Y;
              const curve = Math.max(40, Math.abs(toX - fromX) / 2);
              return <path key={`${edge.from}-${edge.to}-${index}`} d={`M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`} fill="none" stroke="#8FA0E8" strokeWidth={3} strokeLinecap="round" opacity={0.9} />;
            })}
          </g>
        </svg>

        <div className="absolute inset-0">
          <div style={{ width: contentWidth * zoom + Math.abs(pan.x) + 140, height: contentHeight * zoom + Math.abs(pan.y) + 80 }}>
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
              {renderNodes.map((node) => {
                const status = executionNodeStatuses?.[node.name];
                const selected = selectedNodeName === node.name;
                const position = displayPosition(node);
                return (
                  <button
                    key={node.name}
                    type="button"
                    onClick={() => onSelectNode(node.name)}
                    className={`absolute w-[180px] rounded-2xl border bg-white p-2.5 text-left shadow-[0_6px_16px_rgba(17,24,61,0.08)] transition ${selected ? "border-[#4355D8] ring-2 ring-[#DDE3FF]" : "border-[#D9DEEB]"}`}
                    style={{ left: position.x, top: position.y }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={`grid h-7 w-7 place-items-center rounded-lg border ${nodeStatusClass(status)}`}>
                        <Workflow className="h-3 w-3" />
                      </div>
                      <div className="rounded-full bg-[#F3F5FA] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-[#667085]">
                        {status === "success" ? "sucesso" : status === "error" ? "erro" : status === "running" ? "ao vivo" : node.disabled ? "pausado" : "node"}
                      </div>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[12px] font-semibold leading-4 text-[#11183D]">{node.name}</p>
                    <p className="mt-1 truncate text-[10px] text-[#667085]">{node.type}</p>
                    <div className="mt-2 flex items-center gap-2 text-[9px] text-[#98A2B3]">
                      <span>{node.incoming?.length || 0} entrada(s)</span>
                      <span>{node.outgoing?.length || 0} saida(s)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
