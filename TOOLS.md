make sure that tool is added to page # TOOLS REGISTRY
## Janus IA — Dynamic Discovery
## Last updated: 2026-03-25

---

## PHILOSOPHY

The tool and skill ecosystems grow by thousands per month. No static list stays current. This system discovers both on demand and learns from real use. **`tools/registry.md` is the single source of truth for MCP verdicts; `skills/registry.md` for skill verdicts.** (The older `learnings/mcp-registry.md` is a deprecated pointer since 2026-04-17 — do not read or update it.)

---

## THE DIFFERENCE: MCP TOOLS vs SKILLS

**MCP Tools** give the active engine access to external systems at runtime — GitHub, Gmail, databases, APIs. The engine uses them to *act on the world*.

**Skills (SKILL.md)** teach the active engine *how to do something* before a task starts — domain expertise, workflows, design systems, security patterns. Like a recipe the engine reads before cooking.

They compose: Sentry's code review skill defines the PR analysis workflow; the Sentry MCP fetches the live error data. MCP is the kitchen. The skill is the recipe.

---

## MCP TOOL DISCOVERY PROTOCOL

When a project or session requires a capability not currently in `.mcp.json`:

### Step 1 — Check the registry
Read `tools/registry.md`:
- **GOOD** → propose immediately with install command
- **BAD** → explain why, search for alternatives
- **UNTESTED** → proceed to Step 2

### Step 2 — Use an MCP registry search
```bash
claude mcp search "[capability]"
```
Claude Code's built-in search is one adapter path. If Codex or another engine
has the active context, use any equivalent registry search and still add the
result to `.mcp.json`.

### Step 3 — Search public repositories
```
"[capability] MCP server GitHub 2026"
"[capability] site:github.com MCP server"
```
Key directories:
- glama.ai/mcp/servers — 13,000+ indexed
- github.com/wong2/awesome-mcp-servers — most maintained community list
- mcpservers.org — curated with install commands
- github.com/jaw9c/awesome-remote-mcp-servers — remote/hosted (no local install)

### Step 4 — Filter
**Stars first** — sort by GitHub stars descending before evaluating anything else.
Stars > 500 preferred · official company repo accepted at any star count · last commit < 6 months · README with install command · not in BAD list
Reference data: mcpmarket.com/leaderboards (star counts) · mcpmanager.ai/blog/most-popular-mcp-servers (search volume)

### Step 5 — Propose to Jano
1-3 options max, top pick with reasoning, exact install command, env var needed. Never add to `.mcp.json` without confirmation.

### Step 6 — Write feedback
After using any new MCP this session: one entry in `tools/registry.md` before ending. Mandatory.

---

## SKILL DISCOVERY PROTOCOL

When a task would benefit from specialized expertise:

### Step 1 — Check what's installed
```bash
ls ~/.claude/skills/
ls /mnt/skills/public/
```

### Step 2 — Use claude-skills-mcp for semantic search
```bash
# Install once if not present
claude mcp add claude-skills -- uvx claude-skills-mcp

# Search from within any session
find_helpful_skills("[describe the task]")
```

### Step 3 — Search public repositories
```
"[capability] SKILL.md coding agent GitHub 2026"
```
Key directories:
- github.com/travisvn/awesome-claude-skills
- github.com/VoltAgent/awesome-agent-skills — official skills from Anthropic, Google, Vercel, Stripe, Sentry, Cloudflare, Figma
- github.com/BehiSecc/awesome-claude-skills
- github.com/alirezarezvani/claude-skills — 192 skills
- `npx antigravity-awesome-skills --list` — 1,234 skills

### Step 4 — Filter
**Stars first** — sort by GitHub stars before evaluating.
Stars > 200 preferred · clear SKILL.md with frontmatter · last updated < 6 months · matches the task
Reference data: openaitoolshub.org/en/blog/best-claude-code-skills-2026 · github.com/alirezarezvani/claude-skills (5,200+ stars, 192 skills)

### Step 5 — Install and invoke
```bash
mkdir -p ~/.claude/skills/[skill-name]
curl -sL [raw-url-to-SKILL.md] -o ~/.claude/skills/[skill-name]/SKILL.md
```
Invoke with `/skill-name` or describe the task for auto-load.

### Step 6 — Write feedback
Same format as MCP feedback, in `skills/registry.md`.

---

## VIDEO GENERATION — REMOTION

**What it is:** React-based programmatic video generation. Write TypeScript/React components → render to MP4. No timeline editor. Video = code = infinitely scalable.

**Install (per project):**
```bash
npm create video@latest
# or add to existing React project:
npm install remotion @remotion/bundler @remotion/renderer
```

**Cloud rendering (Lambda):**
```bash
npm install @remotion/lambda
npx remotion lambda policies print   # shows exact IAM policy needed
npx remotion lambda sites create      # deploys your comp to S3
npx remotion lambda render            # renders via Lambda ($0.01/min)
```

**Keys needed:**

| Env var | Where to get | Status |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM → Users → Access keys | ⬜ Placeholder in dotfiles |
| `AWS_SECRET_ACCESS_KEY` | Same IAM user | ⬜ Placeholder in dotfiles |
| `AWS_REGION` | Set to `us-east-1` | ✅ In dotfiles |

**AWS setup (one-time):**
1. Go to console.aws.amazon.com/iam → Users → Add user
2. Run `npx remotion lambda policies print` → copy the exact policy JSON
3. Attach that policy to your IAM user
4. Generate access key → paste into dotfiles

**Local dev (no keys needed):**
```bash
npm create video@latest my-video
cd my-video && npm start  # preview at localhost:3000
npx remotion render        # renders to out/ locally
```

**Where it fits in the portfolio:**
- `longevite-therapeutics` — therapy explainer reels, clinic promos, Instagram content
- `espacio-bosques` — personalized project update videos for community investors
- `lool-ai` — product demo videos for optical store pitches
- `freelance-system` — "AI Video Generation" as a new service type (~$500–2,000/project)
- New standalone project — vertical video SaaS (see PROJECTS.md when ready)

**Cost:** Free (local) · $0.01/render-minute (Lambda — deferred, AWS subscription not active)

> **Current mode: local only.** `npx remotion render` outputs to `out/` folder. Good enough for all POC and client work. Revisit Lambda when volume justifies it.

---

## CURRENTLY CONFIGURED MCP TOOLS

| Tool | Env var | What it does | Registry status |
|---|---|---|---|
| GitHub | `GITHUB_TOKEN` | Repos, PRs, issues, auto-create repos | GOOD |
| Google Workspace | `GOOGLE_CLIENT_ID/SECRET` | Gmail, Calendar, Drive, Sheets, Slides, Docs, Forms, Tasks, Chat | UNTESTED |
| Brave Search | `BRAVE_API_KEY` | Market research, competitor analysis | GOOD |
| Memory (Supabase) | `SUPABASE_URL/KEY` | Cross-session memory via remember()/recall() | UNTESTED |
| Filesystem | none | Read/write /workspaces | GOOD |
| Fetch | none | HTTP requests, link validation | GOOD |
| Sequential Thinking | none | Multi-step reasoning chains | GOOD |
| Playwright | none | Browser automation, screenshots | GOOD |
| n8n | `N8N_API_KEY/URL` | Build and deploy automations | UNTESTED |
| Cloudflare | `CLOUDFLARE_API_TOKEN/ACCOUNT_ID` | R2, Workers, KV | UNTESTED |

---

## CURRENTLY INSTALLED SKILLS

| Skill | Location | Invoked when |
|---|---|---|
| remotion | npm (per project) | Any video generation task — promos, reels, personalized videos, data viz videos |
| docx | /mnt/skills/public/docx/ | Creating Word documents |
| pdf | /mnt/skills/public/pdf/ | Working with PDF files |
| pptx | /mnt/skills/public/pptx/ | Creating presentations |
| xlsx | /mnt/skills/public/xlsx/ | Creating spreadsheets |
| frontend-design | /mnt/skills/public/frontend-design/ | Building any web UI |
| file-reading | /mnt/skills/public/file-reading/ | Processing uploaded files |
| pdf-reading | /mnt/skills/public/pdf-reading/ | Reading PDF content |
| product-self-knowledge | /mnt/skills/public/product-self-knowledge/ | Questions about Claude/Anthropic |
| skill-creator | /mnt/skills/examples/skill-creator/ | Building new custom skills |
| gsap | ~/.claude/skills/gsap-skills/ | GSAP animations (core, timeline, ScrollTrigger, React, performance) |

---

## STORAGE ROUTING (apply automatically)

```
Code, markdown, CSV, configs → GitHub (project repo)
Research docs, proposals → GitHub (/validation or /gtm)
Client deliverables, PDFs → Google Drive "/Janus_AI/[project]/"  (via scripts/gdrive)
AI-generated images/video (review) → Google Drive "/Janus_AI/_media/[project]/"
Public-facing media (CDN URLs) → Cloudflare R2 /janus-media/[project]/
```

---

## GOOGLE CALENDAR RULES

- Available after 3pm weekdays, weekends flexible
- 30 min buffer between project context switches
- Read calendar before scheduling anything
- Flag when estimated timeline doesn't fit available hours

---

## GMAIL CONTEXT EXTRACTION

1. Search Gmail for threads related to the project
2. Extract: last message date, status, commitments, next action
3. Update the project's GTM tracker
4. Flag any threads needing Jano's response
