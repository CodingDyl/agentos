"use client";

import React, { forwardRef, useCallback, useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*                            ANIMATED BEAM CORE                              */
/* -------------------------------------------------------------------------- */

export interface AnimatedBeamProps {
  className?: string;
  containerRef: React.RefObject<HTMLElement | null>;
  fromRef: React.RefObject<HTMLElement | null>;
  toRef: React.RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  /** Dash pattern for the static path, e.g. "4 4" for an offline link. */
  pathDasharray?: string;
  /** False draws the static path only. */
  animated?: boolean;
  /** Any CSS colour, including `var(--token)`. Applied via style so tokens resolve. */
  gradientStartColor?: string;
  gradientStopColor?: string;
  delay?: number;
  duration?: number;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
}

export function AnimatedBeam({
  className,
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 2.5,
  delay = 0,
  pathColor = "currentColor",
  pathWidth = 1.5,
  pathOpacity = 0.08,
  pathDasharray,
  animated = true,
  gradientStartColor = "#3b82f6",
  gradientStopColor = "#8b5cf6",
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
}: AnimatedBeamProps) {
  // useId returns ":r0:"-style ids; colons break url(#…) references in some engines.
  const id = useId().replace(/:/g, "");
  const reduceMotion = useReducedMotion();
  const [pathD, setPathD] = useState("");
  const [svgDimensions, setSvgDimensions] = useState({ width: 0, height: 0 });
  const [gradientCoords, setGradientCoords] = useState({
    x1: "0%",
    y1: "0%",
    x2: "100%",
    y2: "0%",
  });

  const updatePath = useCallback(() => {
    if (containerRef.current && fromRef.current && toRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const rectA = fromRef.current.getBoundingClientRect();
      const rectB = toRef.current.getBoundingClientRect();

      setSvgDimensions({
        width: containerRect.width,
        height: containerRect.height,
      });

      const startX = rectA.left - containerRect.left + rectA.width / 2 + startXOffset;
      const startY = rectA.top - containerRect.top + rectA.height / 2 + startYOffset;
      const endX = rectB.left - containerRect.left + rectB.width / 2 + endXOffset;
      const endY = rectB.top - containerRect.top + rectB.height / 2 + endYOffset;

      const controlX = (startX + endX) / 2;
      const controlY = (startY + endY) / 2 - curvature;
      setPathD(`M ${startX},${startY} Q ${controlX},${controlY} ${endX},${endY}`);

      setGradientCoords({
        x1: `${startX}px`,
        y1: `${startY}px`,
        x2: `${endX}px`,
        y2: `${endY}px`,
      });
    }
  }, [containerRef, fromRef, toRef, curvature, startXOffset, startYOffset, endXOffset, endYOffset]);

  useEffect(() => {
    updatePath();
    // Observe the endpoints too: a node can move (list reflow, label change)
    // without the container itself changing size.
    const resizeObserver = new ResizeObserver(() => updatePath());
    for (const element of [containerRef.current, fromRef.current, toRef.current]) {
      if (element) resizeObserver.observe(element);
    }
    window.addEventListener("resize", updatePath);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePath);
    };
  }, [updatePath, containerRef, fromRef, toRef]);

  const showBeam = animated && !reduceMotion && pathD !== "";

  return (
    <svg
      fill="none"
      width={svgDimensions.width}
      height={svgDimensions.height}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={cn("pointer-events-none absolute inset-0 z-0", className)}
      viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`}
    >
      {showBeam ? (
        <defs>
          <linearGradient
            id={id}
            gradientUnits="userSpaceOnUse"
            x1={gradientCoords.x1}
            y1={gradientCoords.y1}
            x2={gradientCoords.x2}
            y2={gradientCoords.y2}
          >
            <stop offset="0%" style={{ stopColor: gradientStartColor, stopOpacity: 0 }} />
            <stop offset="25%" style={{ stopColor: gradientStartColor, stopOpacity: 0.8 }} />
            <stop offset="60%" style={{ stopColor: gradientStopColor, stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: gradientStopColor, stopOpacity: 0 }} />
          </linearGradient>

          <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      ) : null}

      {/* Static subdued baseline path */}
      <path
        d={pathD}
        style={{ stroke: pathColor }}
        strokeWidth={pathWidth}
        strokeOpacity={pathOpacity}
        strokeDasharray={pathDasharray}
        strokeLinecap="round"
      />

      {/* Animated beam, travelling along the same path */}
      {showBeam ? (
        <motion.path
          d={pathD}
          stroke={`url(#${id})`}
          strokeWidth={pathWidth * 1.8}
          strokeLinecap="round"
          strokeDasharray="45 155"
          filter={`url(#glow-${id})`}
          initial={{ strokeDashoffset: reverse ? 0 : 200 }}
          animate={{ strokeDashoffset: reverse ? 200 : 0 }}
          transition={{
            duration,
            delay,
            ease: [0.45, 0.05, 0.55, 0.95],
            repeat: Infinity,
            repeatType: "loop",
          }}
        />
      ) : null}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*                               CIRCLE ELEMENT                               */
/* -------------------------------------------------------------------------- */

/** A node the beams connect. Unstyled beyond layout; the caller supplies the look. */
export const BeamNode = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} {...props} className={cn("relative z-10 flex items-center justify-center", className)}>
      {children}
    </div>
  ),
);

BeamNode.displayName = "BeamNode";
