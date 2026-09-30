import ForceGraph from "force-graph";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { MemoryGraph, MemoryGraphNode } from "@shared/memory-types";
import { FIELD, groupOf, nodeRadius, type ColorBy, type Legend } from "./memory-model";

/**
 * The vault as a force-directed graph, on a Hermes Blue field.
 *
 * Canvas, via `force-graph` (MIT): pan, zoom and drag come with it, and it
 * stops both the simulation and redrawing once the layout settles, so an idle
 * graph costs nothing. Positions survive refetches — a note edited in
 * Obsidian changes an edge, not the whole picture — and the viewport is only
 * refitted when the question changes (global ↔ local, a new focus), never
 * because the data did.
 */

interface GraphNode extends MemoryGraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  count: number;
  unresolved?: boolean;
}

export interface MemoryGraphHandle {
  fit: () => void;
  reset: () => void;
  zoomBy: (factor: number) => void;
}

export interface MemoryGraphCanvasProps {
  graph: MemoryGraph;
  selectedId?: string;
  colorBy: ColorBy;
  legend: Legend;
  arrows: boolean;
  reducedMotion: boolean;
  /** Changes when the view should be refitted (scope, focus, filters). */
  fitKey: string;
  onSelect: (id: string) => void;
  onBackground?: () => void;
}

const idOf = (end: string | GraphNode) => (typeof end === "string" ? end : end.id);

function fontFamily(): string {
  return getComputedStyle(document.body).getPropertyValue("--os-font-sans").trim() || "Inter, Arial, sans-serif";
}

export const MemoryGraphCanvas = forwardRef<MemoryGraphHandle, MemoryGraphCanvasProps>(function MemoryGraphCanvas(
  { graph, selectedId, colorBy, legend, arrows, reducedMotion, fitKey, onSelect, onBackground },
  handle,
) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<ForceGraph<GraphNode, GraphLink> | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number; vx?: number; vy?: number }>());
  const hover = useRef<string | null>(null);
  const lastFit = useRef<string | null>(null);
  // Set when the question changed; the view is refitted once the layout settles.
  const pendingFit = useRef(false);

  // Everything the draw callbacks read, kept in a ref so the canvas can be set
  // up once and still draw the latest selection, colours and hover.
  const state = useRef({ reducedMotion, selectedId, colorBy, legend, neighbours: new Map<string, Set<string>>(), small: true, font: "" });

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!map.has(edge.source)) map.set(edge.source, new Set());
      if (!map.has(edge.target)) map.set(edge.target, new Set());
      map.get(edge.source)!.add(edge.target);
      map.get(edge.target)!.add(edge.source);
    }
    return map;
  }, [graph.edges]);

  state.current = {
    reducedMotion,
    selectedId,
    colorBy,
    legend,
    neighbours,
    small: graph.nodes.length <= 80,
    font: state.current.font,
  };

  const callbacks = useRef({ onSelect, onBackground });
  callbacks.current = { onSelect, onBackground };

  // Set up once.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    state.current.font = fontFamily();

    const chart = new ForceGraph<GraphNode, GraphLink>(element)
      .backgroundColor(FIELD)
      .nodeId("id")
      .nodeLabel(() => "")
      .nodeRelSize(1)
      .nodeVal((node) => nodeRadius(node.degree) ** 2)
      .linkSource("source")
      .linkTarget("target")
      .cooldownTime(6_000)
      .d3AlphaDecay(0.035)
      .minZoom(0.1)
      .maxZoom(8)
      .autoPauseRedraw(true)
      .nodeCanvasObject((node, context, scale) => {
        const { selectedId: selected, neighbours: near, legend: colours, colorBy: by, small, font } = state.current;
        const focus = hover.current ?? selected ?? null;
        const related = focus ? node.id === focus || near.get(focus)?.has(node.id) : true;
        const radius = nodeRadius(node.degree);
        const x = node.x ?? 0;
        const y = node.y ?? 0;

        context.globalAlpha = related ? 1 : 0.22;

        if (node.unresolved) {
          // A ghost: an outline only, dashed, so it never reads as a real note.
          context.setLineDash([2 / scale, 2 / scale]);
          context.strokeStyle = "#f2f2f2";
          context.lineWidth = 1.2 / scale;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        } else {
          context.fillStyle = colours.colors.get(groupOf(node, by)) ?? "#f2f2f2";
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();
        }

        if (node.id === selected) {
          context.strokeStyle = "#f2f200";
          context.lineWidth = 2.5 / scale;
          context.beginPath();
          context.arc(x, y, radius + 3.5 / scale + 1, 0, Math.PI * 2);
          context.stroke();
        }

        const labelled = node.id === selected || node.id === hover.current || (focus && related && scale > 0.9) || scale > 1.6 || (small && scale > 0.7);
        if (labelled && related) {
          const size = Math.max(10.5 / scale, 2.5);
          context.font = `${node.id === selected ? 600 : 500} ${size}px ${font}`;
          context.textAlign = "center";
          context.textBaseline = "top";
          context.fillStyle = node.unresolved ? "rgba(242,242,242,0.75)" : "#f2f2f2";
          context.fillText(node.title.length > 36 ? `${node.title.slice(0, 34)}…` : node.title, x, y + radius + 3 / scale);
        }
        context.globalAlpha = 1;
      })
      .nodePointerAreaPaint((node, color, context) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.degree) + 3, 0, Math.PI * 2);
        context.fill();
      })
      .linkColor((link) => {
        const focus = hover.current ?? state.current.selectedId ?? null;
        const touches = focus && (idOf(link.source) === focus || idOf(link.target) === focus);
        if (touches) return "#f2f200";
        return focus ? "rgba(242,242,242,0.12)" : "rgba(242,242,242,0.38)";
      })
      .linkWidth((link) => {
        const focus = hover.current ?? state.current.selectedId ?? null;
        const touches = focus && (idOf(link.source) === focus || idOf(link.target) === focus);
        return (touches ? 1.6 : 0.8) + Math.min(1.2, (link.count - 1) * 0.3);
      })
      .linkLineDash((link) => (link.unresolved ? [3, 3] : null))
      .onNodeHover((node) => {
        hover.current = node?.id ?? null;
        element.style.cursor = node ? "pointer" : "grab";
        // Redraw once without reheating the physics.
        instance.current?.resumeAnimation();
      })
      .onNodeClick((node) => {
        if (!node.unresolved) callbacks.current.onSelect(node.id);
      })
      .onNodeDragEnd((node) => {
        node.fx = undefined;
        node.fy = undefined;
      })
      .onBackgroundClick(() => callbacks.current.onBackground?.())
      .onEngineStop(() => {
        if (!pendingFit.current) return;
        pendingFit.current = false;
        chart.zoomToFit(state.current.reducedMotion ? 0 : 400, 48);
      });

    instance.current = chart;

    const resize = new ResizeObserver(([entry]) => {
      chart.width(entry.contentRect.width).height(entry.contentRect.height);
    });
    resize.observe(element);

    return () => {
      resize.disconnect();
      chart._destructor();
      instance.current = null;
      element.replaceChildren();
    };
  }, []);

  // Data: keep positions of notes that were already on screen.
  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;

    const current = chart.graphData().nodes as GraphNode[];
    for (const node of current) {
      if (node.x !== undefined && node.y !== undefined) {
        positions.current.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
      }
    }

    const nodes: GraphNode[] = graph.nodes.map((node) => ({ ...node, ...positions.current.get(node.id) }));
    const links: GraphLink[] = graph.edges.map((edge) => ({ source: edge.source, target: edge.target, count: edge.count, unresolved: edge.unresolved }));
    const known = nodes.filter((node) => node.x !== undefined).length;

    if (reducedMotion) {
      // Lay out off-screen and draw the settled result: no drifting nodes.
      chart.warmupTicks(known === nodes.length ? 0 : 160).cooldownTicks(0);
    } else {
      chart.warmupTicks(0).cooldownTicks(Infinity);
    }

    chart.graphData({ nodes, links });

    if (lastFit.current !== fitKey) {
      lastFit.current = fitKey;
      pendingFit.current = true;
      // A first fit early, so the graph is framed while it settles.
      window.setTimeout(() => chart.zoomToFit(reducedMotion ? 0 : 500, 48), reducedMotion ? 30 : 600);
    }
  }, [graph, fitKey, reducedMotion]);

  // Arrows, and redraws when only the styling inputs change.
  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;
    chart.linkDirectionalArrowLength(arrows ? 4.5 : 0).linkDirectionalArrowRelPos(0.92).linkDirectionalArrowColor(() => "rgba(242,242,242,0.7)");
    chart.resumeAnimation();
  }, [arrows, selectedId, colorBy, legend]);

  useImperativeHandle(handle, () => ({
    fit: () => instance.current?.zoomToFit(reducedMotion ? 0 : 400, 48),
    reset: () => {
      positions.current.clear();
      const chart = instance.current;
      if (!chart) return;
      const { nodes, links } = chart.graphData();
      for (const node of nodes as GraphNode[]) {
        node.x = undefined;
        node.y = undefined;
        node.vx = undefined;
        node.vy = undefined;
      }
      pendingFit.current = true;
      chart.graphData({ nodes: [...nodes], links: [...links] });
      window.setTimeout(() => chart.zoomToFit(reducedMotion ? 0 : 500, 48), reducedMotion ? 30 : 700);
    },
    zoomBy: (factor: number) => {
      const chart = instance.current;
      if (chart) chart.zoom(chart.zoom() * factor, reducedMotion ? 0 : 200);
    },
  }), [reducedMotion]);

  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
});
