import ForceGraph from "force-graph";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { MemoryGraph, MemoryGraphNode } from "@shared/memory-types";
import { groupOf, nodeRadius, noteColor, withAlpha, type ColorBy, type Legend } from "./memory-model";

/**
 * The vault as a force-directed graph, drawn like a nervous system.
 *
 * Notes are glowing cells, each in its own colour; links are beams of light
 * blended additively, so where many cross the field brightens the way
 * overlapping light does. Small pulses travel the beams — the one continuous
 * motion — and stop entirely under reduced motion, at which point the canvas
 * also stops redrawing once the layout settles.
 *
 * Canvas, via `force-graph` (MIT): pan, zoom and drag come with it. Positions
 * survive refetches — a note edited in Obsidian changes an edge, not the
 * whole picture — and the viewport is only refitted when the question changes
 * (global ↔ local, a new focus), never because the data did.
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
  /** Fixed per link, so which beams carry an ambient pulse never flickers. */
  seed: number;
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
const nodeOf = (end: string | GraphNode) => (typeof end === "string" ? undefined : end);

function hashPair(a: string, b: string): number {
  let hash = 2_166_136_261;
  const text = `${a}\u0000${b}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function fontFamily(): string {
  return getComputedStyle(document.body).getPropertyValue("--os-font-sans").trim() || "Inter, Arial, sans-serif";
}

/** Past this many beams, gradients give way to flat colour to keep frames cheap. */
const GRADIENT_LIMIT = 1_200;
/** Ambient pulses ride roughly one beam in this many. */
const AMBIENT_SHARE = 0.16;

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
  // Whether the current layout has come to rest at least once.
  const settled = useRef(false);
  // Re-reads which beams carry pulses; set once the canvas exists.
  const particles = useRef<() => void>(() => undefined);

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

  const colors = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of graph.nodes) {
      if (node.unresolved) continue;
      map.set(node.id, colorBy === "random" ? noteColor(node.id) : legend.colors.get(groupOf(node, colorBy)) ?? "#f2f2f2");
    }
    return map;
  }, [graph.nodes, colorBy, legend]);

  // Everything the draw callbacks read, kept in a ref so the canvas is set up
  // once and still draws the latest selection, colours and hover.
  const state = useRef({
    reducedMotion,
    selectedId,
    neighbours,
    colors,
    small: true,
    gradients: true,
    font: "",
  });
  state.current = {
    ...state.current,
    reducedMotion,
    selectedId,
    neighbours,
    colors,
    small: graph.nodes.length <= 80,
    gradients: graph.edges.length <= GRADIENT_LIMIT,
  };

  const callbacks = useRef({ onSelect, onBackground });
  callbacks.current = { onSelect, onBackground };

  const focusOf = () => hover.current ?? state.current.selectedId ?? null;
  const touches = (link: GraphLink, focus: string | null) =>
    Boolean(focus && (idOf(link.source) === focus || idOf(link.target) === focus));

  // Set up once.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    state.current.font = fontFamily();

    const chart = new ForceGraph<GraphNode, GraphLink>(element)
      // Transparent: the dark field behind is CSS, so it can move with the page.
      .backgroundColor("rgba(0,0,0,0)")
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
      .linkCanvasObjectMode(() => "replace")
      .linkCanvasObject((link, context, scale) => {
        const source = nodeOf(link.source);
        const target = nodeOf(link.target);
        if (!source || !target || source.x === undefined || target.x === undefined) return;

        const { colors: palette, gradients } = state.current;
        const focus = focusOf();
        const lit = touches(link, focus);
        const dimmed = Boolean(focus) && !lit;
        const x1 = source.x;
        const y1 = source.y ?? 0;
        const x2 = target.x;
        const y2 = target.y ?? 0;

        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";

        if (link.unresolved) {
          context.setLineDash([3 / scale, 3 / scale]);
          context.strokeStyle = `rgb(220 224 255 / ${dimmed ? 0.05 : 0.22})`;
          context.lineWidth = 0.8 / scale;
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          context.stroke();
          context.restore();
          return;
        }

        const from = palette.get(source.id) ?? "#f2f2f2";
        const to = palette.get(target.id) ?? "#f2f2f2";
        const paint = (alpha: number) => {
          if (!gradients && !lit) return withAlpha(from, alpha);
          const gradient = context.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, withAlpha(from, alpha));
          gradient.addColorStop(1, withAlpha(to, alpha));
          return gradient;
        };
        const weight = 1 + Math.min(1, (link.count - 1) * 0.35);
        // Dense graphs dim each beam so thousands of crossings glow, not blow out.
        const density = gradients ? 1 : 0.55;

        // The halo: wide and faint, so crossings bloom.
        context.strokeStyle = paint(dimmed ? 0.02 : lit ? 0.28 : 0.07 * density);
        context.lineWidth = Math.max(3.2 * weight, 5 / scale) * (lit ? 1.6 : 1);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();

        // The core: thin and bright.
        context.strokeStyle = paint(dimmed ? 0.06 : lit ? 0.95 : 0.4 * density);
        context.lineWidth = Math.max(0.6 * weight, (lit ? 1.4 : 0.8) / scale);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
        context.restore();
      })
      .nodeCanvasObject((node, context, scale) => {
        const { selectedId: selected, neighbours: near, colors: palette, small, font } = state.current;
        const focus = focusOf();
        const related = focus ? node.id === focus || near.get(focus)?.has(node.id) : true;
        const radius = nodeRadius(node.degree);
        const x = node.x ?? 0;
        const y = node.y ?? 0;

        context.save();
        context.globalAlpha = related ? 1 : 0.18;

        if (node.unresolved) {
          // A ghost: an outline only, dashed, so it never reads as a real note.
          context.setLineDash([2 / scale, 2 / scale]);
          context.strokeStyle = "rgb(220 224 255 / 0.7)";
          context.lineWidth = 1.1 / scale;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.stroke();
          context.setLineDash([]);
        } else {
          const color = palette.get(node.id) ?? "#f2f2f2";
          const emphasised = node.id === selected || node.id === hover.current;

          // Glow, additive, so neighbouring cells light each other.
          context.globalCompositeOperation = "lighter";
          const glowRadius = radius * (emphasised ? 4.6 : 2.4);
          const glow = context.createRadialGradient(x, y, radius * 0.4, x, y, glowRadius);
          glow.addColorStop(0, withAlpha(color, emphasised ? 0.55 : 0.26));
          glow.addColorStop(1, withAlpha(color, 0));
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, glowRadius, 0, Math.PI * 2);
          context.fill();

          context.globalCompositeOperation = "source-over";
          context.fillStyle = color;
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.fill();

          // A hot centre, like a lit nucleus.
          context.fillStyle = "rgb(255 255 255 / 0.78)";
          context.beginPath();
          context.arc(x, y, radius * 0.38, 0, Math.PI * 2);
          context.fill();

          if (node.id === selected) {
            context.strokeStyle = "rgb(255 255 255 / 0.95)";
            context.lineWidth = 1.6 / scale;
            context.beginPath();
            context.arc(x, y, radius + 4 / scale + 1.5, 0, Math.PI * 2);
            context.stroke();
          }
        }

        const labelled =
          node.id === selected || node.id === hover.current || (focus && related && scale > 0.9) || scale > 1.6 || (small && scale > 0.7);
        if (labelled && related) {
          const size = Math.max(10.5 / scale, 2.5);
          const label = node.title.length > 36 ? `${node.title.slice(0, 34)}…` : node.title;
          const top = y + radius + 4 / scale;
          context.globalCompositeOperation = "source-over";
          context.font = `${node.id === selected ? 600 : 500} ${size}px ${font}`;
          context.textAlign = "center";
          context.textBaseline = "top";
          // A dark keyline under the text keeps it legible over bright beams.
          context.lineJoin = "round";
          context.lineWidth = 3 / scale;
          context.strokeStyle = "rgb(4 5 26 / 0.85)";
          context.strokeText(label, x, top);
          context.fillStyle = node.unresolved ? "rgb(220 224 255 / 0.7)" : "#eef0ff";
          context.fillText(label, x, top);
        }
        context.restore();
      })
      .nodePointerAreaPaint((node, color, context) => {
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node.degree) + 3, 0, Math.PI * 2);
        context.fill();
      })
      .linkDirectionalParticleWidth((link) => (touches(link, focusOf()) ? 2.6 : 1.8))
      .linkDirectionalParticleSpeed((link) => 0.0035 + link.seed * 0.006)
      .linkDirectionalParticleColor((link) => {
        const target = nodeOf(link.target);
        return target ? state.current.colors.get(target.id) ?? "#ffffff" : "#ffffff";
      })
      .onNodeHover((node) => {
        hover.current = node?.id ?? null;
        element.style.cursor = node ? "pointer" : "grab";
        refreshParticles();
        // Redraw without reheating the physics.
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
        settled.current = true;
        if (!pendingFit.current) return;
        pendingFit.current = false;
        chart.zoomToFit(state.current.reducedMotion ? 0 : 400, 56);
      });

    /**
     * Pulses: a steady few on ambient beams, more on the beams touching the
     * note in focus. None at all when motion is reduced, so the canvas can go
     * fully idle.
     */
    function refreshParticles() {
      chart.linkDirectionalParticles((link) => {
        if (state.current.reducedMotion || link.unresolved) return 0;
        if (touches(link, focusOf())) return 3;
        return link.seed < AMBIENT_SHARE ? 1 : 0;
      });
    }
    refreshParticles();
    particles.current = refreshParticles;

    // More room between cells than the defaults, so beams read as beams and
    // not as a solid disc. Charge weakens with distance so hubs don't fling
    // everything to the edges.
    const charge = chart.d3Force("charge") as unknown as { strength: (value: number) => unknown; distanceMax: (value: number) => unknown } | undefined;
    charge?.strength(-150);
    charge?.distanceMax(640);
    const spring = chart.d3Force("link") as unknown as { distance: (value: number) => unknown } | undefined;
    spring?.distance(58);

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
    const links: GraphLink[] = graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      count: edge.count,
      unresolved: edge.unresolved,
      seed: hashPair(edge.source, edge.target),
    }));
    const known = nodes.filter((node) => node.x !== undefined).length;
    if (known < nodes.length) settled.current = false;

    if (reducedMotion) {
      // Lay out off-screen and draw the settled result: no drifting nodes.
      // Also when switching to Still mid-layout, not only for new notes.
      chart.warmupTicks(settled.current ? 0 : 220).cooldownTicks(0);
    } else {
      chart.warmupTicks(0).cooldownTicks(Infinity);
    }

    chart.graphData({ nodes, links });
    particles.current();

    if (lastFit.current !== fitKey) {
      lastFit.current = fitKey;
      pendingFit.current = true;
      // A first fit early, so the graph is framed while it settles.
      window.setTimeout(() => chart.zoomToFit(reducedMotion ? 0 : 500, 56), reducedMotion ? 30 : 600);
    }
  }, [graph, fitKey, reducedMotion]);

  // Arrows, pulses and redraws when only the styling inputs change.
  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;
    chart
      .linkDirectionalArrowLength(arrows ? 4.5 : 0)
      .linkDirectionalArrowRelPos(0.9)
      .linkDirectionalArrowColor(() => "rgb(238 240 255 / 0.75)");
    particles.current();
    chart.resumeAnimation();
  }, [arrows, selectedId, colors, reducedMotion]);

  useImperativeHandle(
    handle,
    () => ({
      fit: () => instance.current?.zoomToFit(reducedMotion ? 0 : 400, 56),
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
        settled.current = false;
        if (reducedMotion) chart.warmupTicks(220).cooldownTicks(0);
        chart.graphData({ nodes: [...nodes], links: [...links] });
        window.setTimeout(() => chart.zoomToFit(reducedMotion ? 0 : 500, 56), reducedMotion ? 30 : 700);
      },
      zoomBy: (factor: number) => {
        const chart = instance.current;
        if (chart) chart.zoom(chart.zoom() * factor, reducedMotion ? 0 : 200);
      },
    }),
    [reducedMotion],
  );

  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
});
