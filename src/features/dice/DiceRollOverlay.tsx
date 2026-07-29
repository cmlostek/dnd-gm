import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuickDice, type Roll } from './quickDiceStore';
import { useDiceEffects } from './diceEffectsStore';
import { playDiceRoll, playCritSound } from './diceSound';

/**
 * Centre-screen roll flourish.
 *
 * Flat 2D on purpose — a polygon outline with the number inside, matching the
 * app's line-art feel rather than trying to be a 3D dice tray. The polygon's
 * side count follows the die, so a d20 and a d6 are distinguishable at a
 * glance without a label.
 *
 * Fires off the roll history rather than a dedicated event: every roll in the
 * app funnels through pushRoll, so watching the newest id catches all of them
 * (quick dice, attacks, damage, hit dice, initiative) with no call sites to
 * update.
 */

const TUMBLE_MS = 520;
const HOLD_MS = 900;
const FADE_MS = 260;

/** Points for a regular polygon inscribed in a circle, flat-top where it
 *  looks better (even side counts). */
function polygonPoints(sides: number, r: number, cx = 50, cy = 50): string {
  const n = Math.max(3, sides);
  // Point-up for triangles (d4 reads as a caltrop), flat-ish otherwise.
  const offset = n % 2 === 1 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / n;
  return Array.from({ length: n }, (_, i) => {
    const a = offset + (i * 2 * Math.PI) / n;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
}

/** Map a die to the polygon that depicts it. d20 would be a 20-gon (a circle
 *  at this size), so the classic faces are used instead. */
function sidesForDie(die: number | undefined): number {
  switch (die) {
    case 4: return 3;   // triangle
    case 6: return 4;   // square
    case 8: return 4;   // diamond (rotated square)
    case 10: return 5;
    case 12: return 5;
    case 20: return 6;  // hexagon — the familiar d20 silhouette
    default: return 6;
  }
}

export default function DiceRollOverlay() {
  const latest = useQuickDice((s) => s.history[0]);
  const visual = useDiceEffects((s) => s.visual);
  const sound = useDiceEffects((s) => s.sound);

  const [roll, setRoll] = useState<Roll | null>(null);
  const [phase, setPhase] = useState<'tumble' | 'settle' | 'out'>('tumble');
  const [face, setFace] = useState(0);
  const seenId = useRef<string | null>(null);

  // Trigger on a genuinely new roll. The ref (not state) means remounts or
  // unrelated history changes can't replay the same roll.
  useEffect(() => {
    if (!latest || latest.id === seenId.current) return;
    seenId.current = latest.id;
    if (sound) playDiceRoll(Math.max(1, (latest.detail.match(/\d+/g)?.length ?? 1) - 1));
    if (!visual) return;
    setRoll(latest);
    setPhase('tumble');
  }, [latest, visual, sound]);

  // Cycle random faces while tumbling, then settle on the real number.
  useEffect(() => {
    if (!roll || phase !== 'tumble') return;
    const max = roll.die ?? 20;
    const spin = setInterval(() => setFace(1 + Math.floor(Math.random() * max)), 55);
    const stop = setTimeout(() => setPhase('settle'), TUMBLE_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [roll, phase]);

  useEffect(() => {
    if (!roll || phase !== 'settle') return;
    const t = setTimeout(() => setPhase('out'), HOLD_MS);
    return () => clearTimeout(t);
  }, [roll, phase]);

  // Crit fanfare fires on the reveal, not on the throw — the point is the
  // payoff landing, and playing it up front would spoil the tumble.
  useEffect(() => {
    if (!roll || phase !== 'settle' || roll.crit !== 'hit' || !sound) return;
    playCritSound();
  }, [roll, phase, sound]);

  // Spark trajectories are fixed per roll so re-renders during the hold don't
  // re-scatter them mid-flight. Offsets are in px, applied via CSS custom
  // properties (see .dice-spark in index.css).
  const sparks = useMemo(() => {
    if (!roll || roll.crit !== 'hit') return [];
    const N = 18;
    return Array.from({ length: N }, (_, i) => {
      const angle = (i / N) * Math.PI * 2 + Math.random() * 0.35;
      const dist = 60 + Math.random() * 42;
      const size = 3.5 + Math.random() * 3.5;
      return {
        dx: `${(Math.cos(angle) * dist).toFixed(1)}px`,
        dy: `${(Math.sin(angle) * dist).toFixed(1)}px`,
        delay: `${(Math.random() * 0.07).toFixed(3)}s`,
        dur: `${(0.62 + Math.random() * 0.3).toFixed(2)}s`,
        size: `${size.toFixed(1)}px`,
      };
    });
  }, [roll]);

  useEffect(() => {
    if (!roll || phase !== 'out') return;
    const t = setTimeout(() => setRoll(null), FADE_MS);
    return () => clearTimeout(t);
  }, [roll, phase]);

  if (!roll || !visual) return null;

  const settled = phase !== 'tumble';
  const shown = settled ? roll.total : face;

  // Crits recolour the whole flourish — but only once the die has settled, so
  // the result is a reveal rather than something the tumble gives away.
  const accent =
    !settled ? 'var(--ac-400)'
    : roll.crit === 'hit' ? '#fbbf24'
    : roll.crit === 'miss' ? '#f43f5e'
    : 'var(--ac-400)';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
      aria-live="polite"
      aria-label={`Rolled ${roll.total}`}
    >
      <div
        className="flex flex-col items-center gap-3"
        style={{
          opacity: phase === 'out' ? 0 : 1,
          transform: `scale(${phase === 'tumble' ? 0.94 : phase === 'out' ? 0.96 : 1})`,
          transition: `opacity ${FADE_MS}ms ease-out, transform 260ms cubic-bezier(.2,1.4,.4,1)`,
        }}
      >
        <div className="relative">
          {/* Critical-hit sparks — one-shot burst on the reveal. Siblings of
              the SVG so they can travel past its bounds without clipping. */}
          {settled &&
            sparks.map((s, i) => (
              <span
                key={i}
                className="dice-spark"
                style={
                  {
                    width: s.size,
                    height: s.size,
                    '--dx': s.dx,
                    '--dy': s.dy,
                    '--dur': s.dur,
                    '--delay': s.delay,
                  } as React.CSSProperties
                }
              />
            ))}
        <svg width={148} height={148} viewBox="0 0 100 100" aria-hidden>
          {/* Soft halo so the shape reads over a busy map */}
          <polygon
            points={polygonPoints(sidesForDie(roll.die), 40)}
            fill="rgb(2 6 23 / 0.82)"
          />

          <polygon
            points={polygonPoints(sidesForDie(roll.die), 40)}
            fill="none"
            stroke={accent}
            strokeWidth={2}
            strokeLinejoin="round"
            style={{
              transformOrigin: '50px 50px',
              transform: `rotate(${settled ? 0 : 12}deg)`,
              transition: 'transform 320ms cubic-bezier(.2,1.4,.4,1), stroke 200ms ease-out',
            }}
          />
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fill={settled ? accent : 'rgb(148 163 184)'}
            style={{
              fontSize: String(shown).length > 2 ? 26 : 32,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontWeight: 600,
              transition: 'fill 160ms linear',
            }}
          >
            {shown}
          </text>
        </svg>
        </div>

        <div
          className="text-center"
          style={{ opacity: settled ? 1 : 0, transition: 'opacity 180ms ease-out' }}
        >
          <div className="text-sm text-slate-200 font-serif">{roll.label}</div>
          <div className="text-[11px] font-mono text-slate-500">{roll.detail}</div>
          {roll.crit && (
            <div
              className="text-[10px] uppercase tracking-[0.2em] mt-1"
              style={{ color: accent }}
            >
              {roll.crit === 'hit' ? 'Critical' : 'Fumble'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
