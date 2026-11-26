# UI integration guide

How to build the engine's screens in a colouring-core fork. The engine ships no UI
([ADR-0006](decisions/0006-engine-is-a-separate-instance-neutral-service.md)): each instance builds its own
against the [API](api-reference.md). The first host builds the reference UI, and each of its UI tickets
writes one chapter here, so a developer on another fork can follow it without reading the first host's code.

Status: skeleton. No chapter is written yet.

## Before you start

- Your fork runs the engine and routes `/api/query/*` to it ([host setup](host-setup.md)).
- colouring-core's map stack: Leaflet 1.7.1 and react-leaflet 3, built with razzle 4 and webpack 5. The
  chapters assume it.
- The UI talks to the engine over HTTP only. Use the plan JSON Schema and the TypeScript types file attached
  to each engine release (*later*); there is no client package.

## What every chapter contains

1. **Screens and states**: empty, loading, answer, invalid, clarification, error and model unavailable,
   each with a screenshot.
2. **API calls and payloads**: each request the screen sends and each response it handles, with examples.
3. **Map hooks and layers**: the Leaflet and react-leaflet hooks, panes and layers used.
4. **Components touched in a colouring-core fork**: file paths in colouring-core, and what changes in each.
5. **Accessibility**: keyboard operation, screen-reader text and focus order.
6. **Manual test checklist**: steps and expected results a tester can tick off.

## Chapters

| Chapter | Covers | Status |
|---|---|---|
| Analyse mode | the third sidebar mode, the builder, the plan card, results summary | not written |
| Result view | neutral base map, matches overlay, outline, legend, popup, result cards | not written |
| Draw tool | named areas, points and lines; edit, delete, rename | not written |
| Assistant bubble | the bubble, its panel or bottom sheet, clarification chips, model unavailable | not written |
| Share and download | share links, plan files, CSV and metadata download | not written |
