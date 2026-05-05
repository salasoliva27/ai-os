#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// JANUS IA — Vault + memories → Neo4j projector
//
// Reads:
//   - /workspaces/janus-ia/{concepts,learnings,wiki,agents,modules}/**.md
//   - Supabase `memories` table
//
// Writes (MERGE, idempotent):
//   - Nodes with labels derived from source folder / memory type
//   - [:REFERENCES] edges from wikilinks
//   - [:MENTIONS] edges from memory → project
//   - [:BELONGS_TO] edges from agent → core/domain/legal category
//
// Run:
//   set -a; source ~/.env; set +a
//   cd scripts/neo4j && node project-vault.mjs
// ═══════════════════════════════════════════════════════════════

import neo4j from 'neo4j-driver'
import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { createClient } from '@supabase/supabase-js'

const VAULT = '/workspaces/janus-ia'

const must = k => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(1) } return v }
const driver = neo4j.driver(must('NEO4J_URI'), neo4j.auth.basic(must('NEO4J_USER'), must('NEO4J_PASSWORD')))
const supa = createClient(must('SUPABASE_URL'), must('SUPABASE_SERVICE_ROLE_KEY'))

// ─── Folder → label mapping ──────────────────────────────────────
const FOLDER_LABEL = {
  concepts: 'Concept',
  learnings: 'Learning',
  wiki: 'Project',
  'agents/core': 'Agent',
  'agents/domain': 'Agent',
  'agents/legal': 'Agent',
  modules: 'Module'
}

// Memory type → node label
const MEMORY_LABEL = {
  session: 'Session',
  correction: 'Correction',
  feedback: 'Feedback',
  decision: 'Decision',
  learning: 'Learning',
  pattern: 'Pattern',
  outcome: 'Learning'
}

// ─── Helpers ─────────────────────────────────────────────────────
const slugify = s => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')

function* walkMd(dir) {
  if (!fs.existsSync(dir)) return
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) yield* walkMd(p)
    else if (ent.isFile() && ent.name.endsWith('.md')) yield p
  }
}

function labelForPath(absPath) {
  const rel = absPath.replace(VAULT + '/', '')
  // Check multi-segment prefixes first
  for (const [folder, label] of Object.entries(FOLDER_LABEL)) {
    if (rel.startsWith(folder + '/')) return { label, folder }
  }
  return null
}

// Extract all [[wikilinks]] — returns array of raw targets
function extractWikilinks(text) {
  const re = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g
  const out = new Set()
  let m
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim()
    if (raw) out.add(raw)
  }
  return [...out]
}

// Build a map of all vault files so we can resolve unqualified wikilinks
function buildFileIndex() {
  const index = new Map() // slug → { label, id, path }
  for (const folder of Object.keys(FOLDER_LABEL)) {
    const dir = path.join(VAULT, folder)
    for (const file of walkMd(dir)) {
      const base = path.basename(file, '.md')
      const id = slugify(base)
      const label = FOLDER_LABEL[folder]
      const rel = file.replace(VAULT + '/', '')
      index.set(id, { label, id, path: rel, name: base })
      // Also index by full rel path without extension
      const relNoExt = rel.replace(/\.md$/, '')
      index.set(relNoExt, { label, id, path: rel, name: base })
    }
  }
  return index
}

// Resolve a wikilink target (e.g. "concepts/dashboard-shell" or "CLAUDE")
// → {label, id} if known, else null
function resolveLink(raw, index) {
  const lower = raw.toLowerCase()
  // Try exact rel-path match
  if (index.has(lower)) return index.get(lower)
  // Try basename-only
  const base = path.basename(lower)
  if (index.has(base)) return index.get(base)
  const slug = slugify(base)
  if (index.has(slug)) return index.get(slug)
  return null
}

// ─── Projector ───────────────────────────────────────────────────
async function run() {
  const session = driver.session()
  const stats = { nodes: 0, edges: 0, memories: 0, skipped_links: 0 }
  const index = buildFileIndex()
  console.log(`Indexed ${index.size} vault file entries`)

  try {
    // 1. Upsert file nodes from vault
    for (const folder of Object.keys(FOLDER_LABEL)) {
      const dir = path.join(VAULT, folder)
      for (const file of walkMd(dir)) {
        const { label } = labelForPath(file)
        const base = path.basename(file, '.md')
        const id = slugify(base)
        const rel = file.replace(VAULT + '/', '')
        const raw = fs.readFileSync(file, 'utf8')
        const fm = matter(raw)
        const description = String((fm.content.match(/^#\s+(.+)/m)?.[1] || '')).slice(0, 200)
        // YAML may parse dates as Date objects; Neo4j props must be primitive
        const updated = fm.data.updated ? String(fm.data.updated).slice(0, 10) : null
        const tags = (Array.isArray(fm.data.tags) ? fm.data.tags : [])
          .filter(t => typeof t === 'string' || typeof t === 'number')
          .map(t => String(t))
        const fmType = fm.data.type ? String(fm.data.type) : null

        await session.run(
          `MERGE (n:\`${label}\` {id: $id})
           SET n.name = $name, n.path = $path, n.description = $description,
               n.updated = $updated, n.fmType = $fmType, n.sourceFolder = $folder,
               n.lastProjected = datetime()
           WITH n
           UNWIND $tags AS t
             MERGE (tg:Tag {name: toLower(t)})
             MERGE (n)-[:TAGGED]->(tg)`,
          { id, name: base, path: rel, description, updated, fmType, folder, tags }
        )
        stats.nodes++

        // Extract and create REFERENCES edges
        const links = extractWikilinks(fm.content)
        for (const link of links) {
          const target = resolveLink(link, index)
          if (!target) { stats.skipped_links++; continue }
          if (target.id === id && target.label === label) continue // self-link
          await session.run(
            `MATCH (a:\`${label}\` {id: $aid})
             MERGE (b:\`${target.label}\` {id: $bid})
             ON CREATE SET b.name = $bname, b.path = $bpath
             MERGE (a)-[r:REFERENCES]->(b)
             ON CREATE SET r.since = datetime()`,
            { aid: id, bid: target.id, bname: target.name, bpath: target.path }
          )
          stats.edges++
        }
      }
    }

    // 2. Memory nodes from Supabase
    const { data: memories, error } = await supa.from('memories').select('*').order('created_at', { ascending: true })
    if (error) throw error
    console.log(`Pulled ${memories.length} memories from Supabase`)

    for (const m of memories) {
      const label = MEMORY_LABEL[m.type] || 'Learning'
      const id = m.id
      const date = (m.created_at || '').slice(0, 10)
      const preview = (m.content || '').slice(0, 280)
      const rawTags = m.metadata?.tags
      const tags = (Array.isArray(rawTags) ? rawTags : [])
        .filter(t => typeof t === 'string' || typeof t === 'number')
        .map(t => String(t))
      const projectSlug = m.project ? slugify(m.project) : null

      await session.run(
        `MERGE (n:\`${label}\` {id: $id})
         SET n.date = $date, n.workspace = $workspace, n.project = $project,
             n.preview = $preview, n.memoryType = $mtype, n.lastProjected = datetime()
         WITH n
         UNWIND $tags AS t
           MERGE (tg:Tag {name: toLower(t)})
           MERGE (n)-[:TAGGED]->(tg)`,
        { id, date, workspace: m.workspace, project: m.project, preview, mtype: m.type, tags }
      )
      stats.memories++

      // MENTIONS edge → Project node (create placeholder if it doesn't exist yet)
      if (projectSlug) {
        await session.run(
          `MATCH (m:\`${label}\` {id: $mid})
           MERGE (p:Project {id: $pid})
           ON CREATE SET p.name = $pname, p.placeholder = true
           MERGE (m)-[r:MENTIONS]->(p)
           ON CREATE SET r.since = datetime()`,
          { mid: id, pid: projectSlug, pname: m.project }
        )
        stats.edges++
      }
    }

    // 3. Final counts
    const nodeRes = await session.run('MATCH (n) RETURN labels(n)[0] AS l, count(*) AS c ORDER BY c DESC')
    const edgeRes = await session.run('MATCH ()-[r]->() RETURN type(r) AS t, count(*) AS c ORDER BY c DESC')
    console.log('\n=== PROJECTION COMPLETE ===')
    console.log('Stats:', stats)
    console.log('\nNodes by label:')
    nodeRes.records.forEach(r => console.log(`  ${r.get('l').padEnd(12)} ${r.get('c').toNumber()}`))
    console.log('\nEdges by type:')
    edgeRes.records.forEach(r => console.log(`  ${r.get('t').padEnd(16)} ${r.get('c').toNumber()}`))
  } finally {
    await session.close()
    await driver.close()
  }
}

run().catch(e => { console.error('FATAL', e); process.exit(1) })
