# Phase 3: Chat Panel - Context

## Cross-Phase Decisions

### D-01: react-markdown + rehype-highlight for markdown rendering
Use `react-markdown` with `rehype-highlight` for syntax-highlighted code blocks, `remark-gfm` for tables and task lists. Do NOT use marked, markdown-it, or custom parsers.

### D-02: Chat state lives in a useReducer hook in ChatPanel
Messages array managed via useReducer in ChatPanel.tsx. No external state library. Messages are typed discriminated unions (user | assistant | tool_call | permission_request). State resets on page refresh (session-scoped).

### D-03: claude_message parsing extracts text + tool_use blocks
The bridge sends raw SDK messages as `claude_message`. The frontend parses `message.message.content` array, extracting `text` blocks (append to current assistant message) and `tool_use` blocks (render as collapsible cards). Partial messages (streaming) update the last assistant message in-place.

### D-04: Collapsible tool call cards with JSON parameter display
Tool calls render as cards showing tool name in header, JSON.stringify(input, null, 2) in a collapsible body, and result when available. Use HTML details/summary for collapse — no animation library needed.

### D-05: Permission requests render inline in chat flow
Permission prompts appear as a special message type in the chat stream with Approve/Deny buttons. Clicking sends `permission_response` via WebSocket. Buttons disable after click. 60s timeout shown as countdown.

### D-06: Input uses textarea with Shift+Enter for newline, Enter to send
Default: Enter sends message. Shift+Enter inserts newline. Textarea auto-grows up to 6 lines then scrolls. Send button also available for mouse users.

### D-07: Auto-scroll with scroll-lock on manual scroll-up
Chat auto-scrolls to bottom on new content. If user scrolls up, auto-scroll pauses. Resumes when user scrolls back to bottom (within 50px threshold).

## Architecture

```
dashboard/frontend/src/
  components/
    ChatPanel.tsx          -- Main chat container (message list + input)
    ChatMessage.tsx        -- Renders a single message (user or assistant)
    MarkdownRenderer.tsx   -- react-markdown wrapper with plugins
    ToolCallCard.tsx       -- Collapsible tool call display
    PermissionPrompt.tsx   -- Approve/Deny inline prompt
    ChatInput.tsx          -- Multiline textarea with send button
  types/
    chat.ts               -- Chat message discriminated union types
```

## For Phase 4+ Consumers

- ChatPanel accepts WebSocket send/lastMessage as props (from App.tsx)
- Chat message types are in `frontend/src/types/chat.ts`
- MarkdownRenderer is reusable for any markdown content in other panels
