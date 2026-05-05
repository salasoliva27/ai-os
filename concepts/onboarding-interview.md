---
type: concept
tags: [onboarding, interview, template, listening-session]
updated: 2026-05-05
---
# Onboarding interview — the 12-block template

Generic version of the question structure that worked in JP/Ozum's intake
(`outputs/documents/jp-ai/intake_interview_V1_2026-04-16.md`). The
`agents/core/onboarding` agent reads THIS file at `/onboard` time and runs
through the blocks conversationally.

The questions assume a single human user mapping their own work into a
Janus instance. Multi-user instances run this once per seat.

## How the agent runs it

- 60-90 min total, but pace is the user's. Tangents are valuable.
- Conversational only — never present as a form or checklist.
- Auto-detect language from the user's first reply; respond in kind.
- Don't take blocks in strict order; follow the user's energy.
- Listen for the **red flags** at the end of this file — they signal where
  to dig deeper.
- After each block, write a YAML stanza to
  `outputs/onboarding/<instance>/intake_v1_<date>.yaml` so `/onboard
  resume` can pick up if the chat ends mid-flow.

**Opening line (paraphrase in detected language):**
*"I want to understand how you actually work — what you do, what slows
you down, what eats your time, what decisions you make. With that I'll
shape this workspace around you. The more raw and specific, the better."*

---

## Block 1 — Who you are

- What's your role / job title? Where? How long?
- One sentence: what do you actually do day-to-day?
- Are you employed, founding, freelance, mixed?
- What's the language you work in primarily? (Confirms language choice.)

**Follow-ups:** if they undersell — "what would your team say you actually
own?". If they say "many things" — "name the three you'd be in trouble for
dropping."

## Block 2 — A typical week

- Walk me through last week, day by day. What did you actually do?
- When did you start, when did you stop, how many meetings?
- What did you do between meetings?
- Best day of the week and worst day, and why?

**Follow-ups:** firefighting → "what was on fire, who brought it?". Lots
of meetings → "which would survive being async?". Deep work → "when does
it happen and what protects it?".

## Block 3 — What you actually sell / produce / own

- In one sentence, what does your team or company produce?
- What are the 3-5 distinct things you personally output? (deals,
  reports, code, designs, decisions, content)
- What's a "big" win for you vs a normal week?
- Cycle time: from "this thing started" to "this thing was done" — how
  long for each output type?

**Follow-ups:** vague answers → "give me the last three concrete
examples". Cycle varies wildly → "what makes the fast ones fast?".

## Block 4 — The work lifecycle (the deep one)

Pick the user's most important output type from Block 3 and walk through
its full lifecycle:

- Where does it start? (assignment, idea, request, lead)
- Who's involved at each step?
- Where does the work live as it moves? (tools, docs, threads)
- What's the format of the deliverable?
- Who consumes it / signs off?
- What happens after?

**Follow-ups:** every manual step → "how many hours/week does that eat?".
Handoffs → "where do balls get dropped?". Tools → "what do you love and
hate about it?".

## Block 5 — The people around you

- Direct reports / direct manager / peers — names and what they own
- Clients / customers / external dependencies — types and key relationships
- Vendors / partners / suppliers
- Who's your go-to when you're stuck?
- Who chases you vs who do you chase?

**Follow-ups:** bottleneck → "what only YOU can do vs what you keep doing
out of habit?". Repeated names → that person matters; model their role.

## Block 6 — Tools you use today

- What's on your home screen / bookmarks bar?
- Email, calendar, chat — which platforms?
- Docs / spreadsheets / notes — where does your work live?
- Project / ticket tracker — what, if any?
- Industry-specific tools (CRM, design, finance, dev — whatever applies)
- AI tools you already use, for what

For each tool: "what do you open it for?" and "what's the worst part?".
This block is the source for `.mcp.json` patches at synthesis.

**Follow-ups:** "I just use email and Excel" → "which sheet would die if
corrupted? Can you screen-share one?". CRM mentioned → "what % of deals
actually get logged there, honestly?".

## Block 7 — Where time leaks and balls drop

- If I watched you for a week, what would you wish I didn't see?
- What gets forgotten? What do you re-do because someone dropped something?
- What lives in someone's head instead of a system?
- What could be async but isn't?
- What do you do Sunday night so Monday doesn't suck?

**Follow-ups:** every pain → frequency. Reporting → "who asks for what,
how often, in what format?". Status updates → "who chases you?".

## Block 8 — Decisions you make

- What decisions do you make weekly that you wish were easier?
- What do you currently decide on gut that you wish was data-backed?
- What data do you wish you had?
- When you make a bad call, where does the signal usually come from
  afterward?
- A decision you've been putting off?

**Follow-ups:** pricing → "how do you set price today?". Hiring → "what's
the trigger — revenue, burnout, specific gap?".

## Block 9 — Money (skip if hourly employee)

- How do you know you had a good month?
- What's the headline number you watch?
- How far out is pipeline / forecast visible?
- Margin / cost tracking — formal or informal?
- Cash collection cycle?

**Follow-ups:** loose → "last financial surprise that hit you?". Tracking
in a sheet → "how fresh is it?".

## Block 10 — The team / stack you orchestrate (if applicable)

- People you supervise / influence
- What rhythms exist (1:1s, retros, standups, planning)?
- Where you're the bottleneck vs where you've delegated
- If you hired one person tomorrow, what role?

**Follow-ups:** team is small → "what would a virtual junior teammate do?".
Multiple direct reports → "rank them by how much you trust their
autonomy".

## Block 11 — What winning looks like

- End of a great week — what did you accomplish?
- End of a great quarter — what's different?
- 2 years out, if everything goes right — what does your work look like?
- One superpower for your role — what would you pick?
- What do you want to spend MORE time doing?

**Follow-ups:** vague vision → quantify. Personal answer → "what stops
you today from doing more of that?".

## Block 12 — The dashboard wedge (only at the end)

Now (and only now) describe what you're building for them — a single
screen they open every morning. Then ask:

- Five things you'd want to see on that screen first thing each morning?
- Three things you check multiple times a day today?
- What alerts would genuinely help vs add noise?
- What would you want to DO from that screen without switching tabs?

Their answers here drive the dashboard window set at synthesis.

---

## Debrief (agent fills these in private — not asked aloud)

After the interview, write the debrief stanza into the YAML so the
synthesis step has structured raw material:

1. **Their actual job in one sentence:**
2. **Top 3 pains they mentioned (in their words):**
3. **Top 3 decisions they make that deserve a widget:**
4. **Where their data lives (every tool/sheet/doc named):**
5. **Where data is ONLY in their head:**
6. **Work lifecycle stages as they described them:**
7. **What they check multiple times per day:**
8. **What "winning a day" looks like for them:**
9. **People they directly supervise + what each owns:**
10. **Dashboard hypothesis (5 windows, ranked by priority):**
11. **Tool inventory (for `.mcp.json` patches):**
12. **Detected language and any cultural / regional context:**

## Red flags to dig on

- "I'll send it later" → info lives in their head; the dashboard must
  capture it
- "It depends" used a lot → there are hidden rules; surface them
- Nervous laugh about a tool/process → it's broken and they're
  embarrassed; offer to help
- Same name repeatedly → that person is a dependency; model their role
- Long pauses → either unclear question or sensitive area; come back to
  it
- "Just WhatsApp / email / Excel" → they're under-tooled and may resist
  new tools; recommend additive, not replacement

## What to skip / shorten

- If single-person operation: skip Block 5 (people) and Block 10 (team
  orchestration) — collapse into Block 1 follow-ups
- If a non-revenue role (researcher, internal IC): skip Block 9 (money)
- If they're clearly senior/strategic: spend less time on Block 4
  (lifecycle); more on Block 8 (decisions)

## What MUST be captured (don't end interview without)

- Detected language + any explicit preference
- At least 5 tools they use day-to-day (raw material for MCP patches)
- At least 3 named pain points (raw material for agent activations)
- At least 3 decisions they care about (raw material for dashboard
  widgets)
- One concrete "morning screen" answer from Block 12 (raw material for
  window set)
