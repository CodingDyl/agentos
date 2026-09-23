# AgentOS

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is Dylan, operating a personal agentic workspace. Developers extending the frontend are a secondary audience: they need stable primitives that prevent screen-by-screen visual invention.

## Product Purpose

AgentOS is a focused command surface for coordinating agent-assisted work, project context, and system state. Success means the next useful action is obvious without turning the workspace into a reporting dashboard.

## Positioning

AgentOS translates filesystem-backed context and agent activity into a calm operator interface, combining direct command entry with concise, legible system state.

## Operating Context

AgentOS is used as a desktop-oriented working environment through a Tauri-wrapped React application. The interface will eventually support Home, Projects, Designs, and Agent workflows, but this implementation is limited to their shared visual foundation.

## Capabilities and Constraints

- The current stack is React, TypeScript, Vite, Tailwind CSS v4, shadcn/ui, Lucide, and Tauri.
- V1 is dark mode only.
- This foundation does not connect to real filesystem data, Hermes, GitHub, calendars, approval flows, or Tauri filesystem functionality.
- Components must remain reusable, typed, composable, and free of page-specific assumptions.

## Brand Commitments

The product name is AgentOS. Its voice is concise, calm, technical, and action-oriented. `DESIGN.md` is the visual authority for the Editorial Terminal language.

## Evidence on Hand

The repository contains a detailed V1 design specification in `DESIGN.md`. Showcase project names, activity, and system states on `/design-system` are illustrative component data, not live product claims.

## Product Principles

- Reduce cognitive load before exposing more information.
- Keep one next action visible.
- Translate technical structure into usable product concepts.
- Communicate agent work through meaningful state, not decorative activity.
- Establish shared primitives before production screens.

## Accessibility & Inclusion

Interactive controls require keyboard support and visible focus treatment. State must remain understandable without color alone, and normal text should meet WCAG AA contrast wherever possible.
