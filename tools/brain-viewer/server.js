const express = require('express');
const { glob } = require('glob');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const chokidar = require('chokidar');

const app = express();
const PORT = 4001;
const VAULT = path.resolve(__dirname, '../../');

// SSE clients for live push
const sseClients = new Set();

// ── Graph builder ─────────────────────────────────────────────────────────────

function extractLinks(content) {
  const links = [];
  // [[wiki links]]
  const wikiRe = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
  let m;
  while ((m = wikiRe.exec(content)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}

function resolveType(frontmatter, filePath) {
  if (frontmatter.type) return frontmatter.type;
  const rel = filePath.replace(VAULT + '/', '');
  if (rel.startsWith('concepts/')) return 'concept';
  if (rel.startsWith('wiki/')) return 'project';
  if (rel.startsWith('learnings/')) return 'learning';
  if (rel.startsWith('agents/')) return 'agent';
  if (rel.startsWith('projects/')) return 'project-status';
  if (rel === 'CLAUDE.md') return 'brain';
  if (rel === 'PROJECTS.md') return 'registry';
  return 'note';
}

function slugify(filePath) {
  return filePath
    .replace(VAULT + '/', '')
    .replace(/\.md$/, '')
    .replace(/\\/g, '/');
}

function resolveLink(linkText, fromFile) {
  // Try to find the file this link points to
  const fromDir = path.dirname(fromFile);
  const candidates = [
    path.join(VAULT, linkText + '.md'),
    path.join(VAULT, linkText.replace(/^wiki\//, 'wiki/') + '.md'),
    path.join(fromDir, linkText + '.md'),
    path.join(VAULT, 'wiki', path.basename(linkText) + '.md'),
    path.join(VAULT, 'learnings', path.basename(linkText) + '.md'),
    path.join(VAULT, 'concepts', path.basename(linkText) + '.md'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return slugify(c);
  }
  // Return the slug anyway — node may be created from another file
  return linkText.replace(/^wiki\//, 'wiki/').toLowerCase();
}

async function buildGraph() {
  const files = await glob('**/*.md', {
    cwd: VAULT,
    ignore: [
      '**/node_modules/**',
      'tools/brain-viewer/**',
      '.git/**',
      'outputs/**',
      'dump/**',
      'projects/*/dashboard/**',
      'mcp-servers/**/node_modules/**',
      'skills/**',
    ],
  });

  const nodes = new Map(); // slug → node
  const edgeSet = new Set(); // "from||to" deduplication
  const edges = [];

  // First pass — collect all nodes
  for (const rel of files) {
    const absPath = path.join(VAULT, rel);
    const raw = fs.readFileSync(absPath, 'utf8');
    let parsed;
    try { parsed = matter(raw); } catch { parsed = { data: {}, content: raw }; }

    const slug = rel.replace(/\.md$/, '').replace(/\\/g, '/');
    const fm = parsed.data || {};
    const type = resolveType(fm, absPath);
    const label = fm.name || path.basename(rel, '.md');
    const tags = fm.tags || [];
    const desc = fm.description || '';

    // Extract preview (first non-frontmatter, non-heading paragraph)
    const lines = parsed.content.split('\n').filter(l => l.trim());
    const preview = lines.find(l => !l.startsWith('#') && l.length > 20) || '';

    nodes.set(slug, {
      id: slug,
      label,
      type,
      tags,
      desc,
      preview: preview.slice(0, 200),
      path: rel,
      linkCount: 0,
    });
  }

  // Second pass — collect edges
  for (const rel of files) {
    const absPath = path.join(VAULT, rel);
    const raw = fs.readFileSync(absPath, 'utf8');
    let parsed;
    try { parsed = matter(raw); } catch { parsed = { data: {}, content: raw }; }

    const fromSlug = rel.replace(/\.md$/, '').replace(/\\/g, '/');
    const links = extractLinks(parsed.content);

    for (const link of links) {
      const toSlug = resolveLink(link, absPath);
      if (fromSlug === toSlug) continue;

      // Ensure target node exists (ghost node if not)
      if (!nodes.has(toSlug)) {
        nodes.set(toSlug, {
          id: toSlug,
          label: path.basename(toSlug),
          type: 'ghost',
          tags: [],
          desc: '',
          preview: '',
          path: toSlug + '.md',
          linkCount: 0,
        });
      }

      const key = `${fromSlug}||${toSlug}`;
      const keyRev = `${toSlug}||${fromSlug}`;
      if (!edgeSet.has(key) && !edgeSet.has(keyRev)) {
        edgeSet.add(key);
        edges.push({ source: fromSlug, target: toSlug });
        nodes.get(fromSlug).linkCount++;
        nodes.get(toSlug).linkCount++;
      }
    }
  }

  // Auto-edges: project-status files → their wiki page
  const wikiSlugs = new Map([
    ['espacio-bosques', 'wiki/espacio-bosques'],
    ['lool-ai', 'wiki/lool-ai'],
    ['nutria', 'wiki/nutria'],
    ['longevite-therapeutics', 'wiki/longevite'],
    ['freelance-system', 'wiki/freelance-system'],
    ['mercado-bot-dev', 'wiki/mercado-bot'],
    ['jp-ai', 'wiki/jp-ai'],
  ]);
  for (const [fromSlug, node] of nodes) {
    if (node.type !== 'project-status') continue;
    // extract project folder name: projects/[name]/...
    const parts = fromSlug.split('/');
    if (parts.length < 2) continue;
    const projFolder = parts[1];
    const wikiTarget = wikiSlugs.get(projFolder);
    if (!wikiTarget || !nodes.has(wikiTarget)) continue;
    const key = `${fromSlug}||${wikiTarget}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ source: fromSlug, target: wikiTarget });
      node.linkCount++;
      nodes.get(wikiTarget).linkCount++;
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges,
    meta: {
      built: new Date().toISOString(),
      vault: VAULT,
      fileCount: files.length,
      edgeCount: edges.length,
    },
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

let graphCache = null;

app.get('/graph.json', async (req, res) => {
  if (!graphCache) graphCache = await buildGraph();
  res.json(graphCache);
});

app.get('/rebuild', async (req, res) => {
  graphCache = await buildGraph();
  // Push to SSE clients
  for (const client of sseClients) {
    client.write(`data: rebuild\n\n`);
  }
  res.json({ ok: true, nodes: graphCache.nodes.length, edges: graphCache.edges.length });
});

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
  // Keep alive
  const iv = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => clearInterval(iv));
});

app.get('/', (req, res) => res.send(HTML));
app.get('/map', (req, res) => res.send(MINDMAP_HTML));

// ── File watcher ──────────────────────────────────────────────────────────────

chokidar.watch('**/*.md', {
  cwd: VAULT,
  ignored: ['**/node_modules/**', 'tools/brain-viewer/**', '.git/**', 'outputs/**', 'dump/**', 'projects/*/dashboard/**', 'mcp-servers/**/node_modules/**'],
  ignoreInitial: true,
}).on('all', async () => {
  graphCache = await buildGraph();
  for (const client of sseClients) {
    client.write(`data: rebuild\n\n`);
  }
  console.log(`[brain] vault changed → graph rebuilt (${graphCache.nodes.length} nodes, ${graphCache.edges.length} edges)`);
});

// ── HTML viewer ───────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Janus IA — Brain Viewer</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0a0f1a;
    color: #e8f4f0;
    font-family: 'SF Mono', 'Fira Code', monospace;
    overflow: hidden;
    height: 100vh;
  }

  #graph-container { width: 100vw; height: 100vh; }

  svg { width: 100%; height: 100%; }

  .node circle {
    cursor: pointer;
    stroke-width: 1.5;
    transition: r 0.2s, opacity 0.2s;
  }
  .node circle:hover { opacity: 0.8; }
  .node text {
    font-size: 10px;
    fill: #cbd5e1;
    pointer-events: none;
    text-shadow: 0 0 4px #0a0f1a, 0 0 4px #0a0f1a;
  }

  .link {
    stroke: #1e3a5f;
    stroke-opacity: 0.6;
    stroke-width: 1;
  }
  .link.highlighted { stroke: #14b8a6; stroke-opacity: 1; stroke-width: 2; }

  /* Panel */
  #panel {
    position: fixed;
    right: 0; top: 0;
    width: 320px; height: 100vh;
    background: rgba(10, 15, 26, 0.95);
    border-left: 1px solid #1e3a5f;
    padding: 20px;
    overflow-y: auto;
    transform: translateX(100%);
    transition: transform 0.3s ease;
    z-index: 100;
  }
  #panel.open { transform: translateX(0); }
  #panel h2 { color: #14b8a6; font-size: 14px; margin-bottom: 8px; line-height: 1.4; }
  #panel .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  #panel .desc { font-size: 11px; color: #94a3b8; margin-bottom: 12px; line-height: 1.5; }
  #panel .preview {
    font-size: 11px; color: #64748b;
    border-left: 2px solid #1e3a5f;
    padding-left: 10px; margin-bottom: 16px;
    line-height: 1.5;
  }
  #panel .connections { font-size: 11px; }
  #panel .connections h3 { color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  #panel .conn-item { padding: 4px 0; color: #94a3b8; cursor: pointer; }
  #panel .conn-item:hover { color: #14b8a6; }
  #panel-close {
    position: absolute; top: 12px; right: 12px;
    background: none; border: none; color: #475569;
    cursor: pointer; font-size: 18px;
  }
  #panel-close:hover { color: #e8f4f0; }

  /* HUD */
  #hud {
    position: fixed;
    top: 16px; left: 16px;
    z-index: 100;
  }
  #hud h1 {
    font-size: 13px;
    color: #14b8a6;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  #hud .stats { font-size: 10px; color: #475569; }
  #hud .live-dot {
    display: inline-block;
    width: 6px; height: 6px;
    background: #14b8a6;
    border-radius: 50%;
    margin-right: 4px;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* Legend */
  #legend {
    position: fixed;
    bottom: 16px; left: 16px;
    z-index: 100;
    font-size: 10px;
  }
  #legend .item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: #64748b; }
  #legend .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* Search */
  #search {
    position: fixed;
    top: 16px; right: 340px;
    z-index: 100;
  }
  #search input {
    background: rgba(10,15,26,0.9);
    border: 1px solid #1e3a5f;
    color: #e8f4f0;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-family: inherit;
    width: 200px;
    outline: none;
  }
  #search input:focus { border-color: #14b8a6; }
</style>
</head>
<body>

<div id="hud">
  <h1>⬡ Janus IA Brain</h1>
  <div class="stats" id="stats">Loading...</div>
  <div class="stats"><span class="live-dot"></span>Live sync</div>
</div>

<div id="search">
  <input type="text" id="search-input" placeholder="Search nodes..." />
</div>

<div id="legend">
  <div class="item"><div class="dot" style="background:#ef4444"></div>brain / orchestrator</div>
  <div class="item"><div class="dot" style="background:#14b8a6"></div>project</div>
  <div class="item"><div class="dot" style="background:#a855f7"></div>concept</div>
  <div class="item"><div class="dot" style="background:#f59e0b"></div>learning</div>
  <div class="item"><div class="dot" style="background:#3b82f6"></div>agent</div>
  <div class="item"><div class="dot" style="background:#ec4899"></div>registry / index</div>
  <div class="item"><div class="dot" style="background:#22d3ee"></div>session</div>
  <div class="item"><div class="dot" style="background:#475569"></div>other</div>
</div>

<div id="panel">
  <button id="panel-close">×</button>
  <h2 id="panel-title"></h2>
  <span class="type-badge" id="panel-type"></span>
  <div class="desc" id="panel-desc"></div>
  <div class="preview" id="panel-preview"></div>
  <div class="connections">
    <h3>Connected nodes</h3>
    <div id="panel-connections"></div>
  </div>
</div>

<div id="graph-container"><svg id="graph"></svg></div>

<script>
const TYPE_COLOR = {
  brain:          '#ef4444',
  project:        '#14b8a6',
  'project-status': '#0d9488',
  concept:        '#a855f7',
  learning:       '#f59e0b',
  agent:          '#3b82f6',
  registry:       '#ec4899',
  session:        '#22d3ee',
  ghost:          '#1e3a5f',
  note:           '#475569',
};

function nodeColor(d) { return TYPE_COLOR[d.type] || '#475569'; }
function nodeRadius(d) { return Math.max(4, Math.min(18, 4 + d.linkCount * 1.5)); }

let simulation, svg, allNodes, allEdges, nodeMap;
let linkSel, nodeSel;

async function init() {
  const data = await fetch('/graph.json').then(r => r.json());
  allNodes = data.nodes;
  allEdges = data.edges;
  nodeMap = new Map(allNodes.map(n => [n.id, n]));
  document.getElementById('stats').textContent =
    data.nodes.length + ' nodes · ' + data.edges.length + ' edges · ' +
    new Date(data.meta.built).toLocaleTimeString();
  render(data);
}

function render(data) {
  const container = document.getElementById('graph-container');
  const W = container.clientWidth;
  const H = container.clientHeight;

  d3.select('#graph').selectAll('*').remove();
  svg = d3.select('#graph');
  const g = svg.append('g');

  // Zoom
  const zoom = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', e => g.attr('transform', e.transform));
  svg.call(zoom);

  // Build adjacency for panel
  const adj = new Map();
  data.edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  });

  // Cluster centers — multiple gravity wells by semantic type
  const clusterPos = {
    brain:            { x: W * 0.50, y: H * 0.50 },
    agent:            { x: W * 0.50, y: H * 0.18 },
    'project-wiki':   { x: W * 0.80, y: H * 0.42 },
    'project-status': { x: W * 0.80, y: H * 0.65 },
    concept:          { x: W * 0.22, y: H * 0.42 },
    learning:         { x: W * 0.30, y: H * 0.78 },
    registry:         { x: W * 0.50, y: H * 0.80 },
    index:            { x: W * 0.50, y: H * 0.80 },
    note:             { x: W * 0.65, y: H * 0.82 },
    ghost:            { x: W * 0.50, y: H * 0.50 },
  };

  simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.edges)
      .id(d => d.id)
      .distance(d => {
        const st = d.source.type || 'note';
        const tt = d.target.type || 'note';
        if (st === 'brain' || tt === 'brain') return 140;
        if (st === 'concept' && tt === 'project-wiki') return 100;
        if (st === 'agent' && tt === 'project-wiki') return 120;
        if (st === 'concept' || tt === 'concept') return 90;
        if (st === 'project-status' || tt === 'project-status') return 30;
        return 70;
      })
      .strength(0.5))
    .force('charge', d3.forceManyBody().strength(d => -120 - d.linkCount * 8))
    .force('cluster', alpha => {
      for (const node of data.nodes) {
        const c = clusterPos[node.type];
        if (!c) return;
        const strength = node.type === 'brain' ? 0.25 : 0.08;
        node.vx += (c.x - node.x) * strength * alpha;
        node.vy += (c.y - node.y) * strength * alpha;
      }
    })
    .force('collision', d3.forceCollide(d => nodeRadius(d) + 6));

  // Links
  linkSel = g.append('g').attr('class', 'links')
    .selectAll('line').data(data.edges).join('line')
    .attr('class', 'link');

  // Nodes
  const nodeG = g.append('g').attr('class', 'nodes')
    .selectAll('g').data(data.nodes).join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      })
    )
    .on('click', (event, d) => { event.stopPropagation(); openPanel(d, adj); });

  nodeG.append('circle')
    .attr('r', nodeRadius)
    .attr('fill', nodeColor)
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => d3.color(nodeColor(d)).brighter(0.5))
    .attr('stroke-width', 1.5);

  nodeG.append('text')
    .attr('x', d => nodeRadius(d) + 4)
    .attr('y', 4)
    .text(d => d.label);

  nodeSel = nodeG;

  simulation.on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    nodeG.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
  });

  // Close panel on background click
  svg.on('click', () => closePanel());
}

function openPanel(d, adj) {
  document.getElementById('panel-title').textContent = d.label;
  const badge = document.getElementById('panel-type');
  badge.textContent = d.type;
  badge.style.background = (TYPE_COLOR[d.type] || '#475569') + '33';
  badge.style.color = TYPE_COLOR[d.type] || '#475569';
  badge.style.border = '1px solid ' + (TYPE_COLOR[d.type] || '#475569');
  document.getElementById('panel-desc').textContent = d.desc || d.path;
  document.getElementById('panel-preview').textContent = d.preview || '—';

  const connDiv = document.getElementById('panel-connections');
  const neighbors = (adj && adj.get(d.id)) || [];
  connDiv.innerHTML = neighbors.length
    ? neighbors.map(nid => {
        const n = nodeMap.get(nid);
        const label = n ? n.label : nid;
        const color = n ? (TYPE_COLOR[n.type] || '#475569') : '#475569';
        return \`<div class="conn-item" style="color:\${color}" data-id="\${nid}">→ \${label}</div>\`;
      }).join('')
    : '<div style="color:#475569">No connections yet</div>';

  connDiv.querySelectorAll('.conn-item').forEach(el => {
    el.addEventListener('click', () => {
      const n = nodeMap.get(el.dataset.id);
      if (n) openPanel(n, adj);
    });
  });

  document.getElementById('panel').classList.add('open');
}

function closePanel() {
  document.getElementById('panel').classList.remove('open');
}

document.getElementById('panel-close').addEventListener('click', closePanel);

// Search
document.getElementById('search-input').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  if (!nodeSel) return;
  nodeSel.select('circle').attr('opacity', d => {
    if (!q) return 0.85;
    return (d.label.toLowerCase().includes(q) || d.type.includes(q) || d.id.includes(q))
      ? 1 : 0.1;
  });
  nodeSel.select('text').attr('opacity', d => {
    if (!q) return 1;
    return (d.label.toLowerCase().includes(q) || d.type.includes(q) || d.id.includes(q))
      ? 1 : 0.05;
  });
});

// SSE live reload
const es = new EventSource('/events');
es.onmessage = async e => {
  if (e.data === 'rebuild') {
    console.log('[brain] rebuilding graph...');
    const data = await fetch('/graph.json').then(r => r.json());
    allNodes = data.nodes;
    allEdges = data.edges;
    nodeMap = new Map(allNodes.map(n => [n.id, n]));
    document.getElementById('stats').textContent =
      data.nodes.length + ' nodes · ' + data.edges.length + ' edges · ' +
      new Date(data.meta.built).toLocaleTimeString();
    render(data);
  }
};

init();
</script>
</body>
</html>`;

// ── Venture-OS Mind Map ───────────────────────────────────────────────────────

const MINDMAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Venture OS — System Mind Map</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#070d1a; color:#e2e8f0; font-family:'SF Mono','Fira Code',monospace; overflow:hidden; height:100vh; }
  svg { width:100vw; height:100vh; }

  .node circle { cursor:pointer; transition:r 0.2s, filter 0.2s; }
  .node circle:hover { filter:brightness(1.3); }
  .node text { pointer-events:none; }

  .link { fill:none; stroke-opacity:0.35; }

  #hud {
    position:fixed; top:16px; left:16px; z-index:10;
  }
  #hud h1 { font-size:12px; color:#14b8a6; letter-spacing:3px; text-transform:uppercase; margin-bottom:4px; }
  #hud p { font-size:10px; color:#334155; }

  #legend {
    position:fixed; bottom:16px; right:16px; z-index:10;
    font-size:10px; text-align:right;
  }
  .leg { display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-bottom:4px; color:#475569; }
  .ldot { width:8px; height:8px; border-radius:50%; }

  #tooltip {
    position:fixed; pointer-events:none;
    background:rgba(7,13,26,0.95); border:1px solid #1e3a5f;
    padding:10px 14px; border-radius:6px; font-size:11px;
    max-width:280px; line-height:1.5; z-index:20;
    display:none;
  }
  #tooltip h3 { color:#14b8a6; margin-bottom:4px; }
  #tooltip p { color:#94a3b8; }

  #nav {
    position:fixed; top:16px; right:16px; z-index:10;
    display:flex; gap:8px;
  }
  #nav a {
    font-size:10px; color:#475569; text-decoration:none;
    padding:4px 10px; border:1px solid #1e3a5f; border-radius:4px;
    transition:color 0.2s, border-color 0.2s;
  }
  #nav a:hover { color:#14b8a6; border-color:#14b8a6; }
</style>
</head>
<body>

<div id="hud">
  <h1>⬡ Venture OS — System Map</h1>
  <p>Click nodes to explore · Scroll to zoom · Drag to pan</p>
</div>

<div id="nav">
  <a href="/">← Brain Graph</a>
</div>

<div id="legend">
  <div class="leg"><span>core brain</span><div class="ldot" style="background:#ef4444"></div></div>
  <div class="leg"><span>agent</span><div class="ldot" style="background:#3b82f6"></div></div>
  <div class="leg"><span>project</span><div class="ldot" style="background:#14b8a6"></div></div>
  <div class="leg"><span>concept / pattern</span><div class="ldot" style="background:#a855f7"></div></div>
  <div class="leg"><span>infrastructure</span><div class="ldot" style="background:#f59e0b"></div></div>
  <div class="leg"><span>module</span><div class="ldot" style="background:#22d3ee"></div></div>
  <div class="leg"><span>tool / MCP</span><div class="ldot" style="background:#84cc16"></div></div>
</div>

<div id="tooltip"><h3 id="tt-title"></h3><p id="tt-body"></p></div>
<svg id="map"></svg>

<script>
const COLOR = {
  brain:    '#ef4444',
  agent:    '#3b82f6',
  project:  '#14b8a6',
  concept:  '#a855f7',
  infra:    '#f59e0b',
  module:   '#22d3ee',
  tool:     '#84cc16',
};

const data = {
  name: "JANUS IA", type:"brain",
  desc:"Master orchestrator of Jano's venture portfolio — routes every request, coordinates all projects, holds legal/financial/tech context",
  children: [
    {
      name:"AGENTS", type:"agent", desc:"Specialized behavioral agents — each reads its own file before acting",
      children:[
        {name:"Developer", type:"agent", desc:"Architecture, code, builds — checks GitHub + Context7 + Playwright"},
        {name:"UX / Verify", type:"agent", desc:"5-layer visual verification protocol — mandatory before every feature is marked done"},
        {name:"Legal", type:"agent", desc:"LFPDPPP, Ley Fintech, SAT/CFDI, contract review — surfaces blockers early"},
        {name:"Financial", type:"agent", desc:"P&L, runway, portfolio burn — reads Google Sheets via MCP"},
        {name:"Research", type:"agent", desc:"Market sizing, competitor analysis, Brave Search + Firecrawl"},
        {name:"Security", type:"agent", desc:"OWASP review, pre-deploy gates, auth audits, hardening"},
        {name:"Intake", type:"agent", desc:"New idea → 5-phase validation: understand, validate, conflict-check, structure, spin up"},
        {name:"Oversight", type:"agent", desc:"Product coherence, end-to-end gap detection, pre-demo launch readiness"},
        {name:"Marketing", type:"agent", desc:"Brand, content, campaigns, email, video (Remotion), competitor benchmarking"},
        {name:"Trickle-down", type:"agent", desc:"Cross-project proposals — evaluates ADOPT/ADAPT/REJECT per project context"},
        {name:"Deploy", type:"agent", desc:"dev→UAT→prod pipeline, tagging, drift detection"},
        {name:"Calendar", type:"agent", desc:"Google Calendar sync, schedule conflict detection, capacity awareness"},
        {name:"Nutrition", type:"agent", desc:"Clinical nutrition intelligence — powers nutrIA's conversation layer"},
      ]
    },
    {
      name:"PROJECTS", type:"project", desc:"7 active products across different stages and interaction models",
      children:[
        {name:"espacio-bosques", type:"project", desc:"Community funding DAO for Bosques de las Lomas. MXN via Bitso, AI blueprint, milestone escrow, governance voting. POC complete — demo-ready."},
        {name:"lool-ai", type:"project", desc:"B2B virtual try-on widget for Mexican optical SMEs. MediaPipe face mesh, real-time glasses overlay, MXN pricing (~1,200/mo). Core widget done."},
        {name:"nutrIA", type:"project", desc:"Clinical nutrition AI — React PWA + embeddable widget. Streams via Claude API. Embeds on Longevité site. Supabase + Netlify deploy pending."},
        {name:"longevite", type:"project", desc:"Static website for Susana's functional medicine IV clinic in Lomas Virreyes. GSAP animations, bilingual, real clinic photos. Ready to deploy."},
        {name:"mercado-bot", type:"project", desc:"Prediction market trading bot — dashboard with Kelly Criterion, P&L charts, signals. SIMULATION_MODE hardcoded (US entity required for live trading)."},
        {name:"jp-ai (Ozum)", type:"project", desc:"AI operating system for Ozum corporate events agency. 10 specialized agents, CRM Phase 1 pending, collective memory via Supabase."},
        {name:"freelance-system", type:"project", desc:"Automation pipeline for Upwork/Fiverr leads. Operational. SAT/CFDI invoicing, portfolio matching, positioning strategy."},
      ]
    },
    {
      name:"CONCEPTS", type:"concept", desc:"Cross-project patterns that compound — the abstraction layer of the brain",
      children:[
        {name:"Simulation-First Dev", type:"concept", desc:"Build full sim layer before any real infra. Used in espacio-bosques + mercado-bot. Cuts demo time 80%."},
        {name:"Test Harness First", type:"concept", desc:"/api/test/* endpoints + test-api.sh before any UI. Found 5 silent bugs in espacio-bosques that visual testing missed."},
        {name:"CDMX Neighborhood Targeting", type:"concept", desc:"Colonia-level targeting beats 'Mexico City' for local businesses. Polanco (lool-ai), Lomas (longevite, espacio-bosques)."},
        {name:"Spanish-First MX", type:"concept", desc:"All Mexican products: Spanish-first UI, MXN pricing, RFC/CFDI-aware. Non-negotiable before real user testing."},
        {name:"Ley Fintech via IFPE", type:"concept", desc:"Partner with Bitso (licensed IFPE) instead of self-licensing (18+ months). espacio-bosques pattern to copy for any MXN product."},
        {name:"Supabase Shared Instance", type:"concept", desc:"One Supabase project, table-prefix namespacing per product. Reduces cost + ops overhead across portfolio."},
      ]
    },
    {
      name:"INFRASTRUCTURE", type:"infra", desc:"Shared services used across all projects",
      children:[
        {name:"Supabase", type:"infra", desc:"Single instance (rycybujjedtofghigyxm). eb_, nutria_, janus_, ozum_ table prefixes. Auth + DB for all products."},
        {name:"Anthropic API", type:"infra", desc:"claude-opus-4-7 standard across all projects and dashboards."},
        {name:"Bitso Sandbox", type:"infra", desc:"MXN→ETH quote + payment rails for espacio-bosques. Licensed IFPE — the Ley Fintech solution."},
        {name:"GitHub", type:"infra", desc:"All repos under salasoliva27. venture-os is the brain repo. Product repos are separate."},
        {name:"Dotfiles", type:"infra", desc:"salasoliva27/dotfiles — single source for all API keys. Auto-loaded into every Codespace. Never store secrets in product repos."},
        {name:"Cloudflare R2", type:"infra", desc:"janus-media bucket for AI-generated images, videos, campaign media for lool-ai and longevite."},
      ]
    },
    {
      name:"TOOLS / MCPs", type:"tool", desc:"MCP servers and tools available in every session",
      children:[
        {name:"Playwright MCP", type:"tool", desc:"Mandatory UI verification — 5-step protocol: curl → seed → E2E → network requests → screenshot."},
        {name:"Obsidian Vault MCP", type:"tool", desc:"Read/write the knowledge vault. 14 tools. Powers vault plasticity — patches notes mid-session as insights emerge."},
        {name:"Knowledge Graph MCP", type:"tool", desc:"Graph traversal on vault [[links]]. kg_search, kg_paths, kg_common — finds cross-project connections."},
        {name:"GitHub MCP", type:"tool", desc:"Drift detection, PR creation, repo search, file ops across all repos."},
        {name:"Brave Search MCP", type:"tool", desc:"Market research, competitor analysis, regulatory lookups."},
        {name:"Context7 MCP", type:"tool", desc:"Live library docs — React, Supabase, Prisma, Anthropic SDK. Always use before writing library code."},
        {name:"Sequential Thinking MCP", type:"tool", desc:"Mandatory THINK FIRST step for any non-trivial task. Prevents context rot and wrong-order execution."},
        {name:"Magic MCP", type:"tool", desc:"Production-ready UI component generation matching existing design system."},
        {name:"Gmail MCP", type:"tool", desc:"Read email for project context extraction, field notes from lool-ai store visits."},
        {name:"Google Calendar MCP", type:"tool", desc:"Two-way sync, conflict detection, capacity awareness for post-3pm CDMX schedule."},
      ]
    },
    {
      name:"MODULES", type:"module", desc:"Template building blocks — projects declare which they need at intake",
      children:[
        {name:"validation", type:"module", desc:"Market sizing, competitor analysis, go/reframe/kill decision. Skip only for existing businesses."},
        {name:"build", type:"module", desc:"Architecture, code, test harness, deploy pipeline. All active projects have this."},
        {name:"gtm", type:"module", desc:"User/client acquisition strategy. lool-ai + freelance-system active."},
        {name:"campaigns", type:"module", desc:"Growth-stage marketing, content, outreach. Not yet active for any project."},
        {name:"performance", type:"module", desc:"Every project tracks its own metrics. Google Sheets via MCP."},
        {name:"learnings", type:"module", desc:"Every project feeds the learning database — patterns, technical reality, GTM outcomes."},
        {name:"financial", type:"module", desc:"P&L, runway, spend tracking for every project."},
        {name:"legal", type:"module", desc:"LFPDPPP, Ley Fintech, SAT/CFDI, contracts. Active for lool-ai + espacio-bosques."},
      ]
    },
  ]
};

// ── D3 Radial Tree ─────────────────────────────────────────────────────────────

const W = window.innerWidth, H = window.innerHeight;
const R = Math.min(W, H) / 2 - 80;

const tree = d3.tree()
  .size([2 * Math.PI, R])
  .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

const root = d3.hierarchy(data);
tree(root);

const svg = d3.select('#map');
const g = svg.append('g').attr('transform', \`translate(\${W/2},\${H/2})\`);

// Zoom + pan
const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', e => g.attr('transform', \`translate(\${W/2+e.transform.x},\${H/2+e.transform.y}) scale(\${e.transform.k})\`));
svg.call(zoom);

// Links
g.append('g').selectAll('path')
  .data(root.links())
  .join('path')
  .attr('class', 'link')
  .attr('stroke', d => COLOR[d.target.data.type] || '#334155')
  .attr('stroke-width', d => Math.max(0.5, 2 - d.target.depth * 0.4))
  .attr('d', d3.linkRadial().angle(d => d.x).radius(d => d.y));

// Nodes
const node = g.append('g').selectAll('g')
  .data(root.descendants())
  .join('g')
  .attr('class', 'node')
  .attr('transform', d => \`rotate(\${d.x * 180 / Math.PI - 90}) translate(\${d.y},0)\`);

node.append('circle')
  .attr('r', d => d.depth === 0 ? 16 : d.depth === 1 ? 10 : d.depth === 2 ? 6 : 4)
  .attr('fill', d => COLOR[d.data.type] || '#475569')
  .attr('fill-opacity', d => d.depth === 0 ? 1 : 0.8)
  .attr('stroke', d => d3.color(COLOR[d.data.type] || '#475569').brighter(0.6))
  .attr('stroke-width', 1.2)
  .on('mouseover', (event, d) => {
    const tt = document.getElementById('tooltip');
    document.getElementById('tt-title').textContent = d.data.name;
    document.getElementById('tt-body').textContent = d.data.desc || '';
    tt.style.display = 'block';
    tt.style.left = (event.clientX + 12) + 'px';
    tt.style.top = (event.clientY - 10) + 'px';
  })
  .on('mousemove', event => {
    const tt = document.getElementById('tooltip');
    tt.style.left = (event.clientX + 12) + 'px';
    tt.style.top = (event.clientY - 10) + 'px';
  })
  .on('mouseout', () => {
    document.getElementById('tooltip').style.display = 'none';
  });

// Labels
node.append('text')
  .attr('dy', '0.31em')
  .attr('x', d => d.x < Math.PI === !d.children ? 8 : -8)
  .attr('text-anchor', d => d.x < Math.PI === !d.children ? 'start' : 'end')
  .attr('transform', d => d.x >= Math.PI ? 'rotate(180)' : null)
  .attr('font-size', d => d.depth === 0 ? 13 : d.depth === 1 ? 11 : 9)
  .attr('font-weight', d => d.depth <= 1 ? 'bold' : 'normal')
  .attr('fill', d => d.depth === 0 ? '#f1f5f9' : d.depth === 1 ? (COLOR[d.data.type] || '#94a3b8') : '#64748b')
  .attr('letter-spacing', d => d.depth === 0 ? '2px' : '0')
  .text(d => d.data.name);
</script>
</body>
</html>`;

app.listen(PORT, () => {
  console.log(`\n⬡  Janus IA Brain Viewer`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Vault: ${VAULT}\n`);
});
