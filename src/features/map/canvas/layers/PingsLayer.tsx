/** A transient "look here" pulse broadcast to every viewer. */
export type Ping = { id: string; x: number; y: number; color: string };

/**
 * Ping pulses. Pure, prop-driven leaf layer (Phase 0 extraction). The pulse
 * animation lives in CSS (.map-ping-dot / .map-ping-ring); this only places
 * the two circles at logical coordinates, dividing radii by zoom so a ping
 * reads the same size on screen at any zoom level.
 */
export default function PingsLayer({ pings, zoom }: { pings: Ping[]; zoom: number }) {
  return (
    <>
      {pings.map((p) => (
        <g key={p.id} pointerEvents="none">
          <circle cx={p.x} cy={p.y} r={6 / zoom} fill={p.color} className="map-ping-dot" />
          <circle cx={p.x} cy={p.y} r={6 / zoom} fill="none" stroke={p.color} strokeWidth={3 / zoom} className="map-ping-ring" />
        </g>
      ))}
    </>
  );
}
