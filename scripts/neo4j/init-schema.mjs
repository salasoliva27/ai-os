#!/usr/bin/env node
// Runs schema.cypher against Neo4j. Idempotent (IF NOT EXISTS).
import neo4j from 'neo4j-driver'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const uri = process.env.NEO4J_URI
const user = process.env.NEO4J_USER
const pw = process.env.NEO4J_PASSWORD
if (!uri || !user || !pw) {
  console.error('Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD in env')
  process.exit(1)
}

const cypher = fs.readFileSync(path.join(__dirname, 'schema.cypher'), 'utf8')
// Split on ; and drop empties/comments
const statements = cypher
  .split(/;\s*(?:\r?\n|$)/)
  .map(s => s.replace(/^\s*\/\/.*$/gm, '').trim())
  .filter(Boolean)

const driver = neo4j.driver(uri, neo4j.auth.basic(user, pw))
const session = driver.session()
let ok = 0, fail = 0
for (const stmt of statements) {
  try {
    await session.run(stmt)
    ok++
    const preview = stmt.replace(/\s+/g, ' ').slice(0, 90)
    console.log('✓', preview)
  } catch (e) {
    fail++
    console.error('✗', stmt.slice(0, 60), '—', e.message)
  }
}
await session.close()
await driver.close()
console.log(`\nDone: ${ok} ok, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
