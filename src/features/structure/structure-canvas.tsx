import ForceGraph from "force-graph";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

/**
 * The force-directed picture behind the Structure tab, on `force-graph` like
 * the Memory page, but quiet: this is a working diagram, so nothing pulses and
 * nothing moves once the layout settles.
 *
 * Labels are project content. force-graph's built-in tooltip inserts HTML, so
 * it stays off and every label is drawn to the canvas as text.
 */

export interface CanvasNode {
  id: string;
  label: string;
  radius: number;
  color: string;
  x?: number;
  y?: number;
}

export interface CanvasLink {
  source: string | CanvasNode;
  target: string | CanvasNode;
  weight: number;
  /** Resolved by Graphify rather than read from the source. */
  inferred?: boolean;
}

export interface StructureCanvasHandle {
  fit: () => void;
}

/** Repaints a settled graph without reheating the physics: setting the zoom is what marks it as needing a redraw. */
function redraw(graph: ForceGraph<CanvasNode, CanvasLink> | null): void {
  graph?.zoom(graph.zoom());
}

const idOf = (end: string | CanvasNode) => (typeof end === "string" ? end : end.id);

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const StructureCanvas = forwardRef<
  StructureCanvasHandle,
  {
    nodes: readonly CanvasNode[];
    links: readonly CanvasLink[];
    selectedId?: string;
    /** Draw direction: true for real edges, false for aggregated subsystem links. */
    directed: boolean;
    reducedMotion: boolean;
    /** How many labels to show before zooming in: the largest nodes earn theirs. */
    labelFrom: number;
    onSelect: (id: string) => void;
    onBackground: () => void;
  }
>(function StructureCanvas({ nodes, links, selectedId, directed, reducedMotion, labelFrom, onSelect, onBackground }, ref) {
  const element = useRef<HTMLDivElement | null>(null);
  const chart = useRef<ForceGraph<CanvasNode, CanvasLink> | null>(null);

  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (from: string, to: string) => {
      const set = map.get(from);
      if (set) set.add(to);
      else map.set(from, new Set([to]));
    };
    for (const link of links) {
      add(idOf(link.source), idOf(link.target));
      add(idOf(link.target), idOf(link.source));
    }
    return map;
  }, [links]);

  const maxWeight = useMemo(() => links.reduce((max, link) => Math.max(max, link.weight), 1), [links]);

  // The chart outlives renders, so its callbacks read the latest values from here.
  const latest = useRef({ selectedId, hoverId: undefined as string | undefined, neighbours, maxWeight, directed, labelFrom, onSelect, onBackground });
  latest.current = { ...latest.current, selectedId, neighbours, maxWeight, directed, labelFrom, onSelect, onBackground };

  useImperativeHandle(ref, () => ({ fit: () => chart.current?.zoomToFit(300, 48) }), []);

  useEffect(() => {
    const host = element.current;
    if (!host) return undefined;

    const primary = token("--text-primary", "#EEF1F4");
    const secondary = token("--text-secondary", "#ACB5BF");
    const edge = token("--border-control", "#65717D");
    const canvasColor = token("--bg-canvas", "#111315");
    const font = token("--font-ui", "Inter, system-ui, sans-serif");

    const focusOf = () => latest.current.hoverId ?? latest.current.selectedId;
    let placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const touches = (link: CanvasLink, focus: string) => idOf(link.source) === focus || idOf(link.target) === focus;

    const graph = new ForceGraph<CanvasNode, CanvasLink>(host)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .nodeLabel(() => "")
      .linkLabel(() => "")
      .nodeRelSize(1)
      .nodeVal((node) => node.radius * node.radius)
      .minZoom(0.1)
      .maxZoom(8)
      .autoPauseRedraw(true)
      .d3AlphaDecay(0.04)
      .d3VelocityDecay(0.35)
      .linkColor((link) => {
        const focus = focusOf();
        if (!focus) return `${edge}4d`;
        return touches(link, focus) ? primary : `${edge}1f`;
      })
      .linkWidth((link) => {
        const base = 0.5 + 2 * Math.sqrt(link.weight / latest.current.maxWeight);
        const focus = focusOf();
        return focus && touches(link, focus) ? base + 0.5 : base;
      })
      .linkLineDash((link) => (link.inferred ? [3, 3] : null))
      .linkDirectionalArrowLength(() => (latest.current.directed ? 3.5 : 0))
      .linkDirectionalArrowRelPos(1)
      .nodeCanvasObject((node, context, scale) => {
        const { selectedId: selected, neighbours: near, labelFrom: threshold } = latest.current;
        const focus = focusOf();
        const related = !focus || node.id === focus || near.get(focus)?.has(node.id);
        const x = node.x ?? 0;
        const y = node.y ?? 0;

        context.globalAlpha = related ? 1 : 0.35;
        context.beginPath();
        context.arc(x, y, node.radius, 0, 2 * Math.PI);
        context.fillStyle = node.color;
        context.fill();
        // The surface ring keeps overlapping nodes readable as separate things.
        context.lineWidth = 1.5 / scale;
        context.strokeStyle = canvasColor;
        context.stroke();

        if (node.id === selected) {
          context.beginPath();
          context.arc(x, y, node.radius + 3 / scale, 0, 2 * Math.PI);
          context.lineWidth = 2 / scale;
          context.strokeStyle = primary;
          context.stroke();
        }

        const lit = Boolean(focus) && (node.id === focus || near.get(focus as string)?.has(node.id));
        if ((!focus || lit) && (lit || node.radius >= threshold / Math.max(scale, 0.5))) {
          const size = 12 / scale;
          context.font = `${node.id === focus ? 600 : 500} ${size}px ${font}`;
          context.textAlign = "center";
          context.textBaseline = "top";
          const label = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
          const top = y + node.radius + 3 / scale;

          // Larger nodes are drawn first, so they keep their label when two would collide.
          const half = context.measureText(label).width / 2;
          const box = { left: x - half, right: x + half, top, bottom: top + size * 1.3 };
          const taken = node.id !== focus && placed.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
          if (taken) {
            context.globalAlpha = 1;
            return;
          }
          placed.push(box);
          // A halo in the canvas colour keeps text legible over crossing links.
          context.lineJoin = "round";
          context.lineWidth = 3 / scale;
          context.strokeStyle = canvasColor;
          context.strokeText(label, x, top);
          context.fillStyle = node.id === focus ? primary : secondary;
          context.fillText(label, x, top);
        }
        context.globalAlpha = 1;
      })
      .nodePointerAreaPaint((node, color, context) => {
        // Small nodes get a larger target than they draw.
        context.fillStyle = color;
        context.beginPath();
        context.arc(node.x ?? 0, node.y ?? 0, Math.max(node.radius, 7), 0, 2 * Math.PI);
        context.fill();
      })
      .onRenderFramePre(() => {
        placed = [];
      })
      .onNodeHover((node) => {
        latest.current.hoverId = node?.id;
        host.style.cursor = node ? "pointer" : "";
        redraw(chart.current);
      })
      .onNodeClick((node) => latest.current.onSelect(node.id))
      .onBackgroundClick(() => latest.current.onBackground());

    chart.current = graph;

    let sized = false;
    const size = () => {
      graph.width(host.clientWidth);
      graph.height(host.clientHeight);
      // A panel that changed size afterwards should not leave the graph cut off.
      if (sized) graph.zoomToFit(0, 48);
      sized = true;
    };
    size();
    const observer = new ResizeObserver(size);
    observer.observe(host);

    return () => {
      observer.disconnect();
      graph._destructor();
      chart.current = null;
      host.replaceChildren();
    };
  }, []);

  useEffect(() => redraw(chart.current), [selectedId]);

  // New data is a new question, so it gets a fresh layout and a fresh fit.
  useEffect(() => {
    const graph = chart.current;
    if (!graph) return;

    // The map spreads subsystems out to read as regions; inside one, components sit closer.
    const spread = latest.current.directed ? { charge: -90, distance: 26 } : { charge: -420, distance: 70 };
    graph.d3Force("charge")?.strength?.(spread.charge);
    graph.d3Force("link")?.distance?.((link: CanvasLink) => {
      const ends = [link.source, link.target].map((end) => (typeof end === "string" ? 0 : end.radius));
      return spread.distance + ends[0] + ends[1];
    });

    let fitted = false;
    const fit = () => {
      if (fitted) return;
      fitted = true;
      graph.zoomToFit(reducedMotion ? 0 : 300, 48);
    };
    graph
      .warmupTicks(reducedMotion ? 160 : 60)
      .cooldownTicks(reducedMotion ? 0 : 120)
      .onEngineStop(fit)
      .graphData({
        // force-graph writes positions onto what it is given, so hand it copies.
        nodes: [...nodes].sort((a, b) => b.radius - a.radius).map((node) => ({ ...node })),
        links: links.map((link) => ({ ...link, source: idOf(link.source), target: idOf(link.target) })),
      });
    if (reducedMotion) fit();
  }, [nodes, links, reducedMotion]);

  return <div ref={element} className="absolute inset-0" />;
});
