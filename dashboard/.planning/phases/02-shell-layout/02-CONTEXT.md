# Phase 2: Shell Layout - Context

## Cross-Phase Decisions

### D-01: react-resizable-panels (bvaughn) for all panel management
Use `react-resizable-panels` with `autoSaveId` for localStorage persistence. Do NOT use allotment, react-split-pane, or custom drag implementations. This library handles horizontal splits, vertical splits, keyboard accessibility, collapse, and persistence in one package.

### D-02: Vite React frontend served by the bridge server
The bridge Express server serves the built React frontend as static files. In dev mode, Vite runs its own dev server with a proxy to the bridge for /api and WebSocket. The frontend lives in `dashboard/frontend/`.

### D-03: CSS custom properties for all visual tokens
All colors, spacing, borders use CSS custom properties from day one. This prepares for the Theme Engine (Phase 8). Use OKLCH color format. Default theme is dark (#080c10 range backgrounds, cyan accent).

### D-04: Pull-up panels use vertical react-resizable-panels
Bottom panels (brain zoom, project detail, tool registry) use `react-resizable-panels` with `orientation="vertical"` nested inside the center column. Consistent resize behavior, keyboard accessible, persistence for free. NOT framer-motion or custom drag.

### D-05: Keyboard shortcuts via useEffect global handler
Cmd/Ctrl+B toggles chat panel, Cmd/Ctrl+J toggles bottom panel, Cmd/Ctrl+\ toggles workspace panel. Use `ImperativePanelHandle` refs for collapse/expand.

### D-06: Frontend connects to bridge WebSocket on load
On mount, the App component establishes a WebSocket connection to the bridge server. Connection status is shown in the UI. This wires Phase 1 output to Phase 2 input.

### D-07: Placeholder panel content with labels
Each panel (Chat, Graph, Workspace, Bottom) shows a centered label with its name and a subtle border. Real content is wired in Phases 3-6. This keeps the shell testable and visually clear.

## Architecture Summary

```
dashboard/
  frontend/
    index.html          -- Entry point with theme blocking script
    src/
      main.tsx          -- React entry, mounts App
      App.tsx           -- ShellLayout + WebSocket provider
      components/
        ShellLayout.tsx -- Three-panel horizontal + nested vertical
        PanelPlaceholder.tsx -- Labeled placeholder for future content
      hooks/
        useKeyboardShortcuts.ts -- Global shortcut handler
        useWebSocket.ts -- Bridge WS connection
      styles/
        tokens.css      -- CSS custom property definitions
        global.css      -- Base styles referencing tokens
    vite.config.ts      -- Proxy to bridge, React plugin
    package.json        -- React deps + react-resizable-panels
    tsconfig.json
  bridge/               -- (existing from Phase 1)
  bin/                  -- (existing from Phase 1)
  package.json          -- (existing, updated with frontend scripts)
```

## For Phase 3+ Consumers

- Import panel refs from ShellLayout if you need to programmatically resize
- All panels accept children -- replace PanelPlaceholder with real components
- CSS tokens are in `frontend/src/styles/tokens.css` -- use var(--token-name) everywhere
- WebSocket hook provides connection state and message stream
- Bottom panel is inside the center column (graph area), collapsible
