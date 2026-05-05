# Roadmap: Venture OS UI

## Overview

Build a web-based operating system interface for managing Jano's multi-venture portfolio. The bridge server is the foundation — everything flows through it. From there, chat and system graph can be built in parallel, followed by workspace integration, process animations, and finally theming and document generation. Each phase delivers a complete, verifiable capability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Bridge Server** - Express/WebSocket bridge wrapping Claude Code CLI with event emission
- [ ] **Phase 2: Shell Layout** - Three-panel resizable layout with panel persistence and keyboard shortcuts
- [ ] **Phase 3: Chat Panel** - Full conversation interface with streaming, markdown, and tool permissions
- [ ] **Phase 4: System Graph** - D3 force-directed visualization of the entire venture ecosystem
- [ ] **Phase 5: Activity Feed** - Real-time event stream from bridge server hooks
- [ ] **Phase 6: Workspace Panel** - Embedded previews, document viewer, and repo access
- [ ] **Phase 7: Process Animations** - Visual feedback mapped to bridge events on the system graph
- [ ] **Phase 8: Theme Engine** - Runtime CSS custom properties with presets and full customization
- [ ] **Phase 9: Document Agent** - Agent definition and document generation pipeline
- [ ] **Phase 10: Startup & Integration** - Single-command launch, self-growing UI, final wiring

## Phase Details

### Phase 1: Foundation & Bridge Server
**Goal**: Claude Code runs as a subprocess accessible via WebSocket from a web client
**Depends on**: Nothing (first phase)
**Requirements**: BRIDGE-01, BRIDGE-02, BRIDGE-03, BRIDGE-04, BRIDGE-05, BRIDGE-06, BRIDGE-07
**Success Criteria** (what must be TRUE):
  1. Running `venture-os` starts the bridge server and opens a browser tab to the web UI
  2. A WebSocket client can send a message and receive streamed Claude Code output
  3. Tool permission prompts from Claude Code appear as WebSocket events that can be approved/denied from the client
  4. Filesystem changes in the vault trigger WebSocket events to connected clients
  5. Hook-emitted tool call events flow through the bridge to connected clients
**Plans**: 3 plans
Plans:
- [ ] 01-01-PLAN.md — Project scaffold, types, Express+WS server skeleton
- [ ] 01-02-PLAN.md — Claude session management, permissions, streaming
- [ ] 01-03-PLAN.md — Hook receiver endpoint, filesystem watcher

### Phase 2: Shell Layout
**Goal**: Users see a three-panel resizable layout that remembers its configuration
**Depends on**: Phase 1
**Requirements**: LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05
**Success Criteria** (what must be TRUE):
  1. User sees three panels (chat left, graph center, workspace right) on page load
  2. User can drag borders between panels to resize them
  3. Panel sizes persist across browser refreshes
  4. Pull-up panels slide from the bottom when triggered
  5. User can collapse/expand any panel with keyboard shortcuts
**Plans**: 2 plans
Plans:
- [ ] 02-01-PLAN.md — Vite React scaffold, CSS tokens, three-panel ShellLayout
- [ ] 02-02-PLAN.md — Keyboard shortcuts, pull-up bottom panel tabs, WebSocket connection, static serving
**UI hint**: yes

### Phase 3: Chat Panel
**Goal**: Users can have a full conversation with Claude through the web UI, identical to terminal
**Depends on**: Phase 1, Phase 2
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
**Success Criteria** (what must be TRUE):
  1. User types a message and sees Claude's response stream in real-time with rendered markdown
  2. Tool calls appear as collapsible cards showing name, parameters, and result
  3. Permission-gated tool calls show Approve/Deny buttons that resolve the call
  4. Chat history is scrollable and persists within the session
  5. User can type multiline input and send with Ctrl+Enter
**Plans**: TBD
**UI hint**: yes

### Phase 4: System Graph
**Goal**: Users see a living visualization of their entire venture ecosystem as a force-directed graph
**Depends on**: Phase 2
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04, GRAPH-05, GRAPH-07
**Success Criteria** (what must be TRUE):
  1. A force-directed graph renders nodes for projects, agents, tools, MCP servers, and vault concepts
  2. Node data is loaded from the actual filesystem (agents/*.md, tools/registry.md, projects/*)
  3. Different node types have distinct visual styles (color, size, shape)
  4. User can zoom, pan, drag nodes, and see hover tooltips
  5. Clicking a node opens a pull-up detail panel with relevant information
**Plans**: TBD
**UI hint**: yes

### Phase 5: Activity Feed
**Goal**: Users see every tool call, file edit, and git operation as it happens
**Depends on**: Phase 1, Phase 2
**Requirements**: FEED-01, FEED-02, FEED-03, FEED-04
**Success Criteria** (what must be TRUE):
  1. A bottom strip shows real-time events as they flow through the bridge
  2. Each entry has a project-colored left border and timestamp
  3. New entries slide-in animate and the feed auto-scrolls to latest
  4. Feed is scrollable to review past events
**Plans**: TBD
**UI hint**: yes

### Phase 6: Workspace Panel
**Goal**: Users can preview running dev servers, view documents, and access repos without leaving the UI
**Depends on**: Phase 1, Phase 2
**Requirements**: WORK-01, WORK-02, WORK-03, WORK-04, WORK-05
**Success Criteria** (what must be TRUE):
  1. An iframe shows the running dev server for the active project
  2. Active ports are auto-detected and shown as tabs
  3. User can switch between preview, documents, and repo access tabs
  4. Documents from outputs/documents/ render in a viewer
  5. Repo access links open the correct GitHub repo for each project
**Plans**: TBD
**UI hint**: yes

### Phase 7: Process Animations
**Goal**: Users see visual feedback on the graph that maps to real system events
**Depends on**: Phase 1, Phase 4
**Requirements**: ANIM-01, ANIM-02, ANIM-03, ANIM-04, ANIM-05, ANIM-06, ANIM-07, GRAPH-06
**Success Criteria** (what must be TRUE):
  1. File reads produce a pulse animation on the source node
  2. Git push produces a ripple outward from the project node
  3. New vault notes trigger a bloom animation and the node appears dynamically
  4. Agent dispatch shows a beam from dispatch center to target, tool invocation glows the edge
  5. Build failures produce a red flicker on the project node
**Plans**: TBD
**UI hint**: yes

### Phase 8: Theme Engine
**Goal**: Users can fully customize the visual identity of their OS
**Depends on**: Phase 2
**Requirements**: THEME-01, THEME-02, THEME-03, THEME-04, THEME-05, THEME-06
**Success Criteria** (what must be TRUE):
  1. All visual tokens (colors, fonts, spacing) are driven by CSS custom properties
  2. User can switch between presets (dark, midnight, terminal, cyberpunk)
  3. User can customize individual colors via a color picker
  4. User can adjust font, spacing, and animation speed/intensity
  5. Theme persists to localStorage and hydrates on startup without flash
**Plans**: TBD
**UI hint**: yes

### Phase 9: Document Agent
**Goal**: Users can generate investor updates, status reports, and slide decks from within the UI
**Depends on**: Phase 3, Phase 6
**Requirements**: DOC-01, DOC-02, DOC-03, DOC-04, DOC-05
**Success Criteria** (what must be TRUE):
  1. A documents.md agent definition exists and is routable via the dispatch protocol
  2. User can ask Claude to generate an investor update and it produces a formatted document
  3. Generated documents render in the workspace document viewer
  4. Documents are saved to outputs/documents/[project]/ with correct naming
**Plans**: TBD

### Phase 10: Startup & Integration
**Goal**: The entire system works as a cohesive OS launched with one command
**Depends on**: All previous phases
**Requirements**: (cross-cutting — validates BRIDGE-07 end-to-end)
**Success Criteria** (what must be TRUE):
  1. `venture-os` command starts bridge, Claude Code, and opens the web UI in one step
  2. New agents/tools/projects added to the filesystem appear in the graph without restart
  3. All panels, feed, graph, chat, and workspace work together in a single session
  4. The system handles a full workflow: chat with Claude, watch tool calls animate on graph, preview result in workspace
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Bridge Server | 0/3 | Not started | - |
| 2. Shell Layout | 0/2 | Not started | - |
| 3. Chat Panel | 0/? | Not started | - |
| 4. System Graph | 0/? | Not started | - |
| 5. Activity Feed | 0/? | Not started | - |
| 6. Workspace Panel | 0/? | Not started | - |
| 7. Process Animations | 0/? | Not started | - |
| 8. Theme Engine | 0/? | Not started | - |
| 9. Document Agent | 0/? | Not started | - |
| 10. Startup & Integration | 0/? | Not started | - |

---
*Roadmap created: 2026-04-14*
*Last updated: 2026-04-14*
