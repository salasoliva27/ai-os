#!/usr/bin/env node
/**
 * Janus IA — Cross-workspace Memory MCP Server v2
 *
 * Stores and retrieves memories across all project workspaces using
 * Supabase + pgvector. Captures everything: sessions, decisions,
 * learnings, corrections, feedback, outcomes, and patterns.
 *
 * Tools:
 *   remember(content, workspace, project?, type?, metadata?, tags?)
 *   recall(query, workspace?, project?, type?, limit?)
 *   forget(id)
 *   list_memories(workspace?, project?, type?, limit?, offset?)
 *   capture_correction(original, correction, context, workspace, project?)
 *   capture_session_summary(summary, workspace, projects_touched, decisions?, learnings?)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createClient } from '@supabase/supabase-js'
import neo4j from 'neo4j-driver'
import { randomUUID } from 'node:crypto'
import { createServer as createHttpServer } from 'node:http'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const VOYAGE_KEY = process.env.VOYAGE_API_KEY
const VECTOR_DIMS = 512

// Per-server-run id so every tool call made by this memory-MCP process
// shares a session_id in brain_events. Lets the Usage Brain group calls
// into temporal flows without needing the MCP protocol to carry a session.
const BRAIN_SESSION_ID = randomUUID()

async function logBrainEvent(toolName, args, status, resultSummary, errorMessage) {
  try {
    const redactedArgs = {}
    for (const [k, v] of Object.entries(args || {})) {
      if (typeof v === 'string') {
        redactedArgs[k] = v.length > 200 ? v.slice(0, 200) + '…' : v
      } else if (Array.isArray(v) || (v && typeof v === 'object')) {
        const s = JSON.stringify(v)
        redactedArgs[k] = s.length > 400 ? s.slice(0, 400) + '…' : v
      } else {
        redactedArgs[k] = v
      }
    }
    await supabase.from('brain_events').insert({
      workspace: args?.workspace ?? null,
      project: args?.project ?? args?.workspace ?? null,
      tool_name: toolName,
      session_id: BRAIN_SESSION_ID,
      args: redactedArgs,
      result_summary: resultSummary ? String(resultSummary).slice(0, 500) : null,
      status,
      error_message: errorMessage ? String(errorMessage).slice(0, 500) : null,
    })
  } catch {
    // Logging must never break tool calls. Swallow.
  }
}

// Neo4j is optional — the brain graph is a projection of Supabase + vault.
// If creds are missing, graph_query simply errors; the rest of the server
// works normally.
const neo4jDriver = process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD
  ? neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD))
  : null

// Convert Neo4j types to plain JSON (Integer → number, DateTime → ISO string, etc.)
function neo4jValueToJson(v) {
  if (v === null || v === undefined) return v
  if (neo4j.isInt(v)) return v.toNumber()
  if (neo4j.isDate?.(v) || neo4j.isDateTime?.(v) || neo4j.isLocalDateTime?.(v) ||
      neo4j.isTime?.(v) || neo4j.isLocalTime?.(v) || neo4j.isDuration?.(v)) {
    return v.toString()
  }
  if (Array.isArray(v)) return v.map(neo4jValueToJson)
  if (typeof v === 'object') {
    // Neo4j Node / Relationship / Path
    if (v.labels && v.properties) {
      return { _type: 'Node', labels: v.labels, id: neo4jValueToJson(v.identity), properties: neo4jValueToJson(v.properties) }
    }
    if (v.type && v.start && v.end && v.properties) {
      return { _type: 'Rel', type: v.type, start: neo4jValueToJson(v.start), end: neo4jValueToJson(v.end), properties: neo4jValueToJson(v.properties) }
    }
    const out = {}
    for (const [k, val] of Object.entries(v)) out[k] = neo4jValueToJson(val)
    return out
  }
  return v
}

async function generateEmbedding(text) {
  if (!VOYAGE_KEY) return null
  try {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VOYAGE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: 'voyage-3-lite', input: [text] })
    })
    const data = await res.json()
    return data.data?.[0]?.embedding ?? null
  } catch {
    return null
  }
}

const server = new Server(
  { name: 'janus-memory', version: '2.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'remember',
      description: 'Store a memory tagged with workspace, project, and type. Use for any knowledge worth persisting: decisions, learnings, corrections, session summaries, patterns, or outcomes.',
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The memory content to store' },
          workspace: { type: 'string', description: 'Workspace: janus-ia | lool-ai | freelance-system | espacio-bosques | nutria | longevite | jp-ai | mercado-bot' },
          project: { type: 'string', description: 'Sub-project name if different from workspace (optional)' },
          type: {
            type: 'string',
            enum: ['session', 'decision', 'learning', 'outcome', 'correction', 'feedback', 'pattern'],
            description: 'session=conversation summary, decision=architectural/business choice, learning=what worked/failed, outcome=result or metric, correction=user corrected AI behavior, feedback=user preference or style guidance, pattern=cross-project recurring pattern',
            default: 'learning'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Searchable tags (e.g. ["supabase", "rls", "security"])'
          },
          metadata: { type: 'object', description: 'Any extra structured data' }
        },
        required: ['content', 'workspace']
      }
    },
    {
      name: 'recall',
      description: 'Search memories across ALL workspaces and projects. Use at session start, before major decisions, and when the user asks "where did we leave off." Supports semantic search (if Voyage API is configured) with full-text fallback.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for — natural language works best' },
          workspace: { type: 'string', description: 'Limit to a specific workspace (optional)' },
          project: { type: 'string', description: 'Limit to a specific project (optional)' },
          type: { type: 'string', description: 'Limit to a memory type (optional)' },
          limit: { type: 'number', default: 10, description: 'Number of results (default 10)' }
        },
        required: ['query']
      }
    },
    {
      name: 'forget',
      description: 'Delete a specific memory by ID. Use when a memory is outdated, wrong, or superseded.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'UUID of the memory to delete' }
        },
        required: ['id']
      }
    },
    {
      name: 'list_memories',
      description: 'List memories with optional filters. Use to audit what is stored, browse by type/workspace, or check for duplicates before storing new memories.',
      inputSchema: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Filter by workspace' },
          project: { type: 'string', description: 'Filter by project' },
          type: { type: 'string', description: 'Filter by type' },
          limit: { type: 'number', default: 20, description: 'Number of results (default 20)' },
          offset: { type: 'number', default: 0, description: 'Offset for pagination' }
        }
      }
    },
    {
      name: 'capture_correction',
      description: 'Store a user correction as a structured memory. Use EVERY TIME the user corrects your approach, says "no not that", "don\'t do X", or redirects you. These are the highest-value memories.',
      inputSchema: {
        type: 'object',
        properties: {
          original: { type: 'string', description: 'What you did or were about to do' },
          correction: { type: 'string', description: 'What the user said to correct you' },
          context: { type: 'string', description: 'Why this correction matters — what was the user trying to achieve?' },
          workspace: { type: 'string', description: 'Current workspace' },
          project: { type: 'string', description: 'Current project (optional)' }
        },
        required: ['original', 'correction', 'context', 'workspace']
      }
    },
    {
      name: 'graph_query',
      description: 'Run a read-only Cypher query against the Neo4j brain graph (projection of vault + memories). Use for structural questions: "which projects are blocked by which concepts", "patterns referenced by N projects that aren\'t promoted to concepts/ yet", "learnings that contradict each other", "most-connected concept". Read-only — mutating queries (CREATE, MERGE, DELETE, SET, REMOVE) are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          cypher: { type: 'string', description: 'A read-only Cypher query. Common node labels: Project, Concept, Learning, Pattern, Session, Correction, Feedback, Decision, Agent, Module, Tag. Common edges: REFERENCES, MENTIONS, TAGGED.' },
          params: { type: 'object', description: 'Optional parameters for the query (e.g. { project: "lool-ai" })' },
          limit: { type: 'number', default: 50, description: 'Max rows to return (default 50, hard cap 500)' }
        },
        required: ['cypher']
      }
    },
    {
      name: 'capture_session_summary',
      description: 'Store a comprehensive session summary. Call this at the END of every session to capture what happened.',
      inputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'What was accomplished this session' },
          workspace: { type: 'string', description: 'Primary workspace' },
          projects_touched: {
            type: 'array',
            items: { type: 'string' },
            description: 'All projects that were worked on'
          },
          decisions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key decisions made (optional)'
          },
          learnings: {
            type: 'array',
            items: { type: 'string' },
            description: 'Things learned or discovered (optional)'
          },
          next_steps: {
            type: 'array',
            items: { type: 'string' },
            description: 'What should happen next session (optional)'
          },
          corrections: {
            type: 'array',
            items: { type: 'string' },
            description: 'User corrections received this session (optional)'
          }
        },
        required: ['summary', 'workspace', 'projects_touched']
      }
    }
  ]
}))

async function handleTool(name, args) {
  if (name === 'remember') {
    const { content, workspace, type = 'learning', tags = [], metadata = {} } = args
    // Never store NULL project. If caller omits it, default to the workspace name
    // (portfolio-meta convention). Backfilled 2026-04-20 after diagnostic found
    // 64% of rows had NULL project, degrading recall precision.
    const project = args.project || workspace
    const embedding = await generateEmbedding(content)
    const enrichedMetadata = { ...metadata, tags }

    const { data, error } = await supabase
      .from('memories')
      .insert({ content, workspace, project, type, metadata: enrichedMetadata, embedding })
      .select('id')
      .single()

    if (error) throw new Error(`Supabase insert error: ${error.message}`)

    const mode = embedding ? 'semantic' : 'text-search'
    return { content: [{ type: 'text', text: `Memory stored [${mode}] [${type}] [${project}]: ${data.id}` }] }
  }

  if (name === 'recall') {
    const { query, workspace, project, type, limit = 10 } = args

    // Semantic search if embeddings are available
    if (VOYAGE_KEY) {
      const embedding = await generateEmbedding(query)
      if (embedding) {
        const { data, error } = await supabase.rpc('search_memories', {
          query_embedding: embedding,
          filter_workspace: workspace ?? null,
          filter_project: project ?? null,
          filter_type: type ?? null,
          match_count: limit
        })
        if (!error && data?.length) {
          return { content: [{ type: 'text', text: formatResults(data) }] }
        }
      }
    }

    // Full-text search fallback
    let q = supabase
      .from('memories')
      .select('id, workspace, project, type, content, created_at, metadata')
      .textSearch('content_tsv', query, { type: 'websearch', config: 'english' })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (workspace) q = q.eq('workspace', workspace)
    if (project) q = q.eq('project', project)
    if (type) q = q.eq('type', type)

    const { data, error } = await q
    if (error) throw new Error(`Supabase search error: ${error.message}`)

    if (!data?.length) {
      // If text search returns nothing, try ilike as last resort
      let q2 = supabase
        .from('memories')
        .select('id, workspace, project, type, content, created_at, metadata')
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (workspace) q2 = q2.eq('workspace', workspace)
      if (project) q2 = q2.eq('project', project)
      if (type) q2 = q2.eq('type', type)

      const { data: data2, error: error2 } = await q2
      if (error2) throw new Error(`Supabase ilike error: ${error2.message}`)
      return { content: [{ type: 'text', text: formatResults(data2) }] }
    }

    return { content: [{ type: 'text', text: formatResults(data) }] }
  }

  if (name === 'forget') {
    const { id } = args

    // First fetch the memory so we can confirm what was deleted
    const { data: existing } = await supabase
      .from('memories')
      .select('id, workspace, type, content')
      .eq('id', id)
      .single()

    if (!existing) {
      return { content: [{ type: 'text', text: `Memory ${id} not found.` }] }
    }

    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', id)

    if (error) throw new Error(`Supabase delete error: ${error.message}`)

    const preview = existing.content.substring(0, 100)
    return { content: [{ type: 'text', text: `Deleted memory ${id} [${existing.type}]: "${preview}..."` }] }
  }

  if (name === 'list_memories') {
    const { workspace, project, type, limit = 20, offset = 0 } = args

    let q = supabase
      .from('memories')
      .select('id, workspace, project, type, content, created_at, metadata')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (workspace) q = q.eq('workspace', workspace)
    if (project) q = q.eq('project', project)
    if (type) q = q.eq('type', type)

    const { data, error, count } = await q
    if (error) throw new Error(`Supabase list error: ${error.message}`)

    const header = `Showing ${data?.length ?? 0} memories (offset: ${offset})`
    return { content: [{ type: 'text', text: `${header}\n\n${formatResults(data)}` }] }
  }

  if (name === 'capture_correction') {
    const { original, correction, context, workspace } = args
    const project = args.project || workspace
    const content = `CORRECTION:\nOriginal behavior: ${original}\nUser said: ${correction}\nContext: ${context}\nRule: ${correction}`
    const embedding = await generateEmbedding(content)

    const { data, error } = await supabase
      .from('memories')
      .insert({
        content,
        workspace,
        project,
        type: 'correction',
        metadata: { tags: ['correction', 'user-feedback'], original, correction, context },
        embedding
      })
      .select('id')
      .single()

    if (error) throw new Error(`Supabase insert error: ${error.message}`)
    return { content: [{ type: 'text', text: `Correction captured [${project}]: ${data.id}\nWill apply in future sessions.` }] }
  }

  if (name === 'graph_query') {
    if (!neo4jDriver) {
      throw new Error('Neo4j is not configured. Set NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD in the MCP server env.')
    }
    const { cypher, params = {}, limit = 50 } = args
    // Enforce read-only. Reject any mutating keyword at the statement level.
    const forbidden = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|CALL\s+\{[^}]*\b(create|merge|delete|set|remove)|CALL\s+apoc\.(refactor|create|merge|do\.(when|case))|LOAD\s+CSV|USING\s+PERIODIC)\b/i
    if (forbidden.test(cypher)) {
      throw new Error('graph_query is read-only. Use the projector script to mutate the graph.')
    }
    const capped = Math.min(Math.max(1, limit), 500)
    const session = neo4jDriver.session({ defaultAccessMode: neo4j.session.READ })
    try {
      // Append LIMIT if the user didn't (best-effort safety)
      const hasLimit = /\blimit\s+\d+\s*;?\s*$/i.test(cypher.trim())
      const finalCypher = hasLimit ? cypher : `${cypher.replace(/;\s*$/, '')}\nLIMIT ${capped}`
      const res = await session.run(finalCypher, params)
      const rows = res.records.map(r => {
        const o = {}
        r.keys.forEach(k => { o[k] = neo4jValueToJson(r.get(k)) })
        return o
      })
      const summary = `${rows.length} row${rows.length === 1 ? '' : 's'}`
      return { content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(rows, null, 2)}` }] }
    } finally {
      await session.close()
    }
  }

  if (name === 'capture_session_summary') {
    const { summary, workspace, projects_touched, decisions = [], learnings = [], next_steps = [], corrections = [] } = args

    const sections = [`SESSION SUMMARY: ${summary}`]
    if (projects_touched.length) sections.push(`Projects: ${projects_touched.join(', ')}`)
    if (decisions.length) sections.push(`Decisions:\n${decisions.map(d => `- ${d}`).join('\n')}`)
    if (learnings.length) sections.push(`Learnings:\n${learnings.map(l => `- ${l}`).join('\n')}`)
    if (next_steps.length) sections.push(`Next steps:\n${next_steps.map(n => `- ${n}`).join('\n')}`)
    if (corrections.length) sections.push(`Corrections received:\n${corrections.map(c => `- ${c}`).join('\n')}`)

    const content = sections.join('\n\n')
    const embedding = await generateEmbedding(content)

    const { data, error } = await supabase
      .from('memories')
      .insert({
        content,
        workspace,
        project: projects_touched[0] ?? null,
        type: 'session',
        metadata: { tags: ['session-summary'], projects_touched, decisions, learnings, next_steps, corrections },
        embedding
      })
      .select('id')
      .single()

    if (error) throw new Error(`Supabase insert error: ${error.message}`)
    return { content: [{ type: 'text', text: `Session summary stored: ${data.id}` }] }
  }

  throw new Error(`Unknown tool: ${name}`)
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  try {
    const result = await handleTool(name, args)
    const summary = result?.content?.[0]?.text ?? null
    void logBrainEvent(name, args, 'ok', summary, null)
    return result
  } catch (err) {
    void logBrainEvent(name, args, 'error', null, err?.message ?? String(err))
    throw err
  }
})

function formatResults(rows) {
  if (!rows?.length) return 'No memories found.'
  return rows.map(m => {
    const date = m.created_at?.split('T')[0] ?? '?'
    const loc = `${m.workspace}${m.project && m.project !== m.workspace ? '/' + m.project : ''}`
    const tags = m.metadata?.tags?.length ? ` [${m.metadata.tags.join(', ')}]` : ''
    const sim = m.similarity ? ` (${(m.similarity * 100).toFixed(0)}% match)` : ''
    const preview = m.content.length > 500 ? m.content.substring(0, 500) + '…' : m.content
    return `[${date}] [${loc}] [${m.type}]${tags}${sim}\nID: ${m.id}\n${preview}`
  }).join('\n\n---\n\n')
}

// Transport selector. Default stdio (unchanged: Claude Code spawns the process
// and speaks JSON-RPC over stdin/stdout). MCP_TRANSPORT=http flips to
// Streamable HTTP so the bridge can own the server's lifecycle as a sidecar.
const TRANSPORT = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase()

if (TRANSPORT === 'http') {
  const port = Number(process.env.MCP_HTTP_PORT ?? 3211)
  const host = process.env.MCP_HTTP_HOST ?? '127.0.0.1'
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  })
  await server.connect(httpTransport)

  const httpServer = createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', transport: 'http' }))
      return
    }
    if (req.url?.startsWith('/mcp')) {
      httpTransport.handleRequest(req, res).catch(err => {
        if (!res.headersSent) res.writeHead(500)
        res.end(String(err?.message ?? err))
      })
      return
    }
    res.writeHead(404)
    res.end('not found')
  })

  httpServer.listen(port, host, () => {
    console.error(`[janus-memory] HTTP transport listening on ${host}:${port}`)
  })

  const shutdown = () => {
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
} else {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
