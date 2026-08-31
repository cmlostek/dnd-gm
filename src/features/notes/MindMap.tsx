import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, ArrowLeft } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { useSession } from '../session/sessionStore';
import { useNotes, canViewNote, EMPTY_PERMS, type Note } from './notesStore';
import { resolveNoteIcon } from './noteIcons';

/**
 * Extract `[[Title]]` and `[[Title#Heading]]` references from a note body.
 * Returns the bare titles (heading stripped) so we can resolve them against
 * the canonical note list. Code fences are ignored — `[[example]]` inside
 * a snippet shouldn't draw an edge.
 */
function extractLinkTargets(body: string): string[] {
  if (!body) return [];
  // Strip fenced code blocks so we don't pick up `[[…]]` inside ``` blocks.
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const out: string[] = [];
  const re = /\[\[([^\]\n]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const raw = m[1].trim();
    const bare = raw.includes('#') ? raw.slice(0, raw.indexOf('#')) : raw;
    const t = bare.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * Pull `#tag`-style tags out of a note body. Skips inside code fences, skips
 * markdown headings (so `## Heading` doesn't accidentally become a tag), and
 * normalises the tag to lowercase for grouping.
 */
function extractTags(body: string): string[] {
  if (!body) return [];
  const stripped = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    // Drop heading lines outright so `## Plot` isn't tagged.
    .replace(/^#{1,6}\s.*$/gm, '');
  const out = new Set<string>();
  const re = /(?:^|\s)#([A-Za-z0-9_\-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

type Node = {
  id: string;
  title: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  tags: string[];
  /** Raw `note.icon` string (id or `id|#hex`) — resolved to Icon + colour at render. */
  icon: string | null;
};

type Edge = { from: string; to: string };

type TagCenter = { tag: string; cx: number; cy: number };

/**
 * Tiny verlet-ish force layout: linear repulsion between every pair, spring
 * pull on each edge, gentle gravity toward the centre. Capped at 240 ticks so
 * the layout settles quickly and the simulation stops eating CPU.
 */
function simulate(
  nodes: Node[],
  edges: Edge[],
  tagCenters: TagCenter[],
  width: number,
  height: number,
  ticks = 240,
) {
  if (nodes.length === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const REPEL = 6000;
  const SPRING_K = 0.012;
  const SPRING_LEN = 110;
  const GRAVITY = 0.012;
  const DAMP = 0.82;
  const MAX_V = 18;

  for (let t = 0; t < ticks; t++) {
    // Repulsion (O(n^2) — fine while we expect at most a few hundred notes).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distSq = dx * dx + dy * dy + 0.01;
        const f = REPEL / distSq;
        const dist = Math.sqrt(distSq);
        const fx = (dx / dist) * f;
        const fy = (dy / dist) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }
    // Springs.
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.from);
      const b = nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const stretch = dist - SPRING_LEN;
      const fx = (dx / dist) * stretch * SPRING_K;
      const fy = (dy / dist) * stretch * SPRING_K;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    // Tag attraction — each tagged node is pulled toward its tag's centroid
    // so notes sharing a #tag cluster in their own little ring. A tag with
    // a single member would just sit on its centroid; the global repulsion
    // still pushes them apart slightly so labels stay readable.
    if (tagCenters.length > 0) {
      const TAG_K = 0.04;
      for (const n of nodes) {
        if (n.tags.length === 0) continue;
        for (const t of n.tags) {
          const center = tagCenters.find((c) => c.tag === t);
          if (!center) continue;
          n.vx += (center.cx - n.x) * TAG_K;
          n.vy += (center.cy - n.y) * TAG_K;
        }
      }
    }
    // Gravity + integrate. Untagged notes get the full pull toward the
    // canvas centre; tagged notes get half (their tag handles most of the
    // positioning) so they don't all collapse into the middle.
    for (const n of nodes) {
      const g = n.tags.length > 0 ? GRAVITY * 0.4 : GRAVITY;
      n.vx += (cx - n.x) * g;
      n.vy += (cy - n.y) * g;
      n.vx = Math.max(-MAX_V, Math.min(MAX_V, n.vx * DAMP));
      n.vy = Math.max(-MAX_V, Math.min(MAX_V, n.vy * DAMP));
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

export default function MindMap() {
  const navigate = useNavigate();
  const campaignId = useSession((s) => s.campaignId);
  const userId = useSession((s) => s.userId);
  const role = useSession((s) => s.role);
  const allNotes = useNotes((s) => s.notes);
  const permissions = useNotes((s) => s.permissions);
  const setActiveNote = useNotes((s) => s.setActiveNote);
  const loadForCampaign = useNotes((s) => s.loadForCampaign);
  const subscribe = useNotes((s) => s.subscribe);

  useEffect(() => {
    if (!campaignId) return;
    loadForCampaign(campaignId);
    return subscribe(campaignId);
  }, [campaignId, loadForCampaign, subscribe]);

  // Only show notes the viewer is actually allowed to see — same gate Notes.tsx
  // uses, so the map mirrors the explorer.
  const visibleNotes = useMemo(
    () =>
      allNotes.filter((n) =>
        canViewNote(n, userId, role, permissions[n.id] ?? EMPTY_PERMS),
      ),
    [allNotes, userId, role, permissions],
  );

  // Build nodes + edges + tag centres. Edge endpoints are matched by
  // case-insensitive title. Tag centres are evenly distributed around the
  // canvas so the per-tag clusters fan out instead of stacking on top of
  // each other.
  const { nodes, edges, tagCenters } = useMemo(() => {
    const byTitle = new Map<string, Note>();
    for (const n of visibleNotes) {
      if (n.title) byTitle.set(n.title.trim().toLowerCase(), n);
    }
    const ns: Node[] = visibleNotes.map((n, i) => ({
      id: n.id,
      title: n.title || 'Untitled',
      x: 400 + Math.cos((i / Math.max(1, visibleNotes.length)) * Math.PI * 2) * 200,
      y: 300 + Math.sin((i / Math.max(1, visibleNotes.length)) * Math.PI * 2) * 200,
      vx: 0,
      vy: 0,
      degree: 0,
      tags: extractTags(n.body || ''),
      icon: n.icon,
    }));
    const es: Edge[] = [];
    const seen = new Set<string>();
    for (const n of visibleNotes) {
      for (const target of extractLinkTargets(n.body || '')) {
        const hit = byTitle.get(target.toLowerCase());
        if (!hit || hit.id === n.id) continue;
        const key = n.id < hit.id ? `${n.id}|${hit.id}` : `${hit.id}|${n.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        es.push({ from: n.id, to: hit.id });
      }
    }
    for (const e of es) {
      const a = ns.find((n) => n.id === e.from);
      const b = ns.find((n) => n.id === e.to);
      if (a) a.degree++;
      if (b) b.degree++;
    }
    // Collect every tag actually used, then lay each on the outer ring.
    const usedTags = new Set<string>();
    for (const n of ns) for (const t of n.tags) usedTags.add(t);
    const tagList = [...usedTags];
    const RING_R = 220;
    const cx0 = 400;
    const cy0 = 300;
    const tagCenters: TagCenter[] = tagList.map((tag, i) => ({
      tag,
      cx: cx0 + Math.cos((i / Math.max(1, tagList.length)) * Math.PI * 2) * RING_R,
      cy: cy0 + Math.sin((i / Math.max(1, tagList.length)) * Math.PI * 2) * RING_R,
    }));
    return { nodes: ns, edges: es, tagCenters };
  }, [visibleNotes]);

  // Run the layout once whenever the graph shape changes. We mutate the
  // nodes in place — `positions` keeps a separately-keyed snapshot so React
  // re-renders when the sim finishes.
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => {
    if (nodes.length === 0) {
      setPositions({});
      return;
    }
    // Clone before simulating so re-runs start from a fresh radial layout.
    const sim = nodes.map((n) => ({ ...n }));
    simulate(sim, edges, tagCenters, 800, 600);
    const next: Record<string, { x: number; y: number }> = {};
    for (const n of sim) next[n.id] = { x: n.x, y: n.y };
    setPositions(next);
  }, [nodes, edges, tagCenters]);

  // ── Pan / zoom on the SVG ────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  // Which node is being dragged, its screen-space grab point, its position at
  // grab time, and whether the pointer has moved far enough to count as a drag
  // (below the threshold a mouseup is treated as a click that opens the note).
  const nodeDragRef = useRef<
    { id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null
  >(null);
  const [grabbing, setGrabbing] = useState(false);

  const onNodeMouseDown = (e: React.MouseEvent, id: string, p: { x: number; y: number }) => {
    e.stopPropagation(); // don't start a canvas pan
    nodeDragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return;
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setGrabbing(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    // Node drag takes precedence over canvas pan. Screen deltas are divided by
    // the zoom factor so the node tracks the cursor 1:1 in graph space.
    const nd = nodeDragRef.current;
    if (nd) {
      const dx = (e.clientX - nd.sx) / view.k;
      const dy = (e.clientY - nd.sy) / view.k;
      if (!nd.moved && Math.hypot(e.clientX - nd.sx, e.clientY - nd.sy) > 3) nd.moved = true;
      setPositions((prev) => ({ ...prev, [nd.id]: { x: nd.ox + dx, y: nd.oy + dy } }));
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
  };
  const onMouseUp = () => {
    const nd = nodeDragRef.current;
    if (nd) {
      nodeDragRef.current = null;
      // A grab that never moved is a click → open the note.
      if (!nd.moved) openNote(nd.id);
    }
    dragRef.current = null;
    setGrabbing(false);
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => ({ ...v, k: Math.max(0.2, Math.min(3, v.k * factor)) }));
  };

  const openNote = (id: string) => {
    setActiveNote(id);
    navigate('/notes');
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="Mind Map">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/notes')}
            className="px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded flex items-center gap-1"
            title="Back to notebook"
          >
            <ArrowLeft size={12} /> Notes
          </button>
          <div className="text-xs text-slate-500 flex items-center gap-2">
            <Network size={12} />
            {nodes.length} note{nodes.length === 1 ? '' : 's'} · {edges.length} link
            {edges.length === 1 ? '' : 's'}
            {tagCenters.length > 0 && <> · {tagCenters.length} tag{tagCenters.length === 1 ? '' : 's'}</>}
          </div>
        </div>
      </PageHeader>
      <div className="flex-1 min-h-0 relative bg-slate-950 overflow-hidden">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
            No notes yet — create one and use `[[Title]]` to link them.
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full select-none"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            style={{ cursor: grabbing ? 'grabbing' : 'grab' }}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* Tag halos — soft circles around each tag's cluster centroid,
                  computed from the actual member positions so the halo hugs
                  the cluster rather than sitting on the precomputed centre. */}
              {tagCenters.map((tc) => {
                const members = nodes
                  .filter((n) => n.tags.includes(tc.tag))
                  .map((n) => positions[n.id])
                  .filter((p): p is { x: number; y: number } => !!p);
                if (members.length === 0) return null;
                const cx = members.reduce((s, p) => s + p.x, 0) / members.length;
                const cy = members.reduce((s, p) => s + p.y, 0) / members.length;
                const radius =
                  members.reduce(
                    (max, p) => Math.max(max, Math.hypot(p.x - cx, p.y - cy)),
                    0,
                  ) + 28;
                return (
                  <g key={tc.tag} pointerEvents="none">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill="rgba(56,189,248,0.06)"
                      stroke="rgba(56,189,248,0.25)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={cx}
                      y={cy - radius - 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#7dd3fc"
                      stroke="#020617"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      #{tc.tag}
                    </text>
                  </g>
                );
              })}
              {edges.map((e, i) => {
                const a = positions[e.from];
                const b = positions[e.to];
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#475569"
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                  />
                );
              })}
              {nodes.map((n) => {
                const p = positions[n.id];
                if (!p) return null;
                const r = 11 + Math.min(11, n.degree * 1.5);
                const { Icon, color } = resolveNoteIcon(n.icon);
                const iconSize = Math.round(r * 1.15);
                return (
                  <g
                    key={n.id}
                    data-node
                    transform={`translate(${p.x},${p.y})`}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => onNodeMouseDown(e, n.id, p)}
                  >
                    {/* Disc tinted with the note's icon colour, brighter for
                        linked notes so hubs still read at a glance. */}
                    <circle
                      r={r}
                      fill={color}
                      fillOpacity={n.degree > 0 ? 0.22 : 0.14}
                      stroke={color}
                      strokeWidth={2}
                      strokeOpacity={n.degree > 0 ? 0.9 : 0.55}
                    />
                    {/* The note's file icon, centred in the disc. foreignObject
                        lets us render the same lucide component the sidebar uses. */}
                    <foreignObject
                      x={-iconSize / 2}
                      y={-iconSize / 2}
                      width={iconSize}
                      height={iconSize}
                      style={{ overflow: 'visible', pointerEvents: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                        <Icon size={iconSize} color={color} strokeWidth={2} />
                      </div>
                    </foreignObject>
                    <text
                      x={r + 5}
                      y={4}
                      fontSize={12}
                      fill="#e2e8f0"
                      stroke="#0f172a"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {n.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>
      <div className="px-4 py-1.5 text-[10px] text-slate-600 border-t border-slate-800 bg-slate-950">
        Drag empty space to pan · scroll to zoom · drag a node to reposition it · click a node to open the note
      </div>
    </div>
  );
}
