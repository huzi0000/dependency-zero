/**
 * Hand-built isometric mini-diagrams for the "How it works" cards.
 *
 * Pure SVG + CSS — no generated artwork. All three share one 180x136 canvas,
 * one isometric ratio (2 : 1) and one stroke weight so they read as a single
 * visual system. Motion is small and functional, and every animation is
 * disabled under prefers-reduced-motion.
 */

const PLANE = "#F2F0E9";
const PLANE_TOP = "#F8F7F2";
const LINE = "#CBC6B7";
const LINE_SOFT = "#DCD8CB";
const CUBE_DARK = "#171816";
const CUBE_LIME = "#D7FF3F";

/** Isometric layer. `rx` is always exactly 2x `ry` so perspective matches. */
function Diamond({
  cx,
  cy,
  rx,
  fill = PLANE,
  stroke = LINE,
  width = 1,
}: {
  cx: number;
  cy: number;
  rx: number;
  fill?: string;
  stroke?: string;
  width?: number;
}) {
  const ry = rx / 2;
  return (
    <polygon
      points={`${cx},${cy - ry} ${cx + rx},${cy} ${cx},${cy + ry} ${cx - rx},${cy}`}
      fill={fill}
      stroke={stroke}
      strokeWidth={width}
      strokeLinejoin="round"
    />
  );
}

/** Small isometric cube with a lime cap. */
function Cube({ cx, cy, s = 7 }: { cx: number; cy: number; s?: number }) {
  const h = s * 0.8;
  return (
    <g>
      <polygon
        points={`${cx},${cy - h} ${cx + s},${cy - h / 2} ${cx},${cy} ${cx - s},${cy - h / 2}`}
        fill={CUBE_LIME}
        stroke={CUBE_DARK}
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      <polygon
        points={`${cx - s},${cy - h / 2} ${cx},${cy} ${cx},${cy + h * 0.8} ${cx - s},${cy - h / 2 + h * 0.8}`}
        fill={CUBE_DARK}
      />
      <polygon
        points={`${cx + s},${cy - h / 2} ${cx},${cy} ${cx},${cy + h * 0.8} ${cx + s},${cy - h / 2 + h * 0.8}`}
        fill="#33342F"
      />
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* 01 · SCAN — an artifact arriving on a dependency layer, swept by a scan line */
/* -------------------------------------------------------------------------- */
export function ScanDiagram() {
  return (
    <svg
      viewBox="0 0 180 136"
      className="h-full w-full"
      role="img"
      aria-label="Diagram: an incoming package is swept across stacked dependency layers"
    >
      <Diamond cx={92} cy={40} rx={72} />
      <Diamond cx={92} cy={56} rx={54} fill={PLANE_TOP} />
      <Diamond cx={92} cy={92} rx={72} />
      <Diamond cx={92} cy={108} rx={54} fill={PLANE_TOP} />

      {/* layer detail */}
      <g stroke={LINE_SOFT} strokeWidth="0.75" fill="none">
        <path d="M46 92h92" />
        <path d="M58 100h68" />
        <path d="M70 84h44" />
      </g>

      {/* the artifact being scanned */}
      <Cube cx={92} cy={88} s={13} />

      {/* travelling scan line */}
      <g className="dz-scan-line">
        <line x1="14" x2="170" y1="0" y2="0" stroke={CUBE_LIME} strokeWidth="1.4" />
        <line
          x1="24"
          x2="160"
          y1="0"
          y2="0"
          stroke={CUBE_LIME}
          strokeWidth="8"
          opacity="0.13"
        />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 02 · DECIDE — three local scanner roles converging on one policy verdict    */
/* -------------------------------------------------------------------------- */

// Three roles, matching the real scanner registry. This previously drew five
// nodes and labelled them "independent scanner nodes", which contradicted both
// the product text and its own "0 independent nodes" disclosure.
const NODES = [
  { x: 34, y: 40, delay: 0 },
  { x: 146, y: 40, delay: 240 },
  { x: 90, y: 116, delay: 480 },
];

export function VerifyDiagram() {
  return (
    <svg
      viewBox="0 0 180 136"
      className="h-full w-full"
      role="img"
      aria-label="Diagram: three local scanner roles signing findings that converge on one deterministic policy verdict"
    >
      <Diamond cx={90} cy={68} rx={78} fill={PLANE_TOP} />
      <Diamond cx={90} cy={68} rx={44} />

      {/* consensus links */}
      <g stroke={LINE} strokeWidth="0.9" fill="none" strokeDasharray="2 3">
        {NODES.map((n) => (
          <line key={`l-${n.x}-${n.y}`} x1={n.x} y1={n.y} x2="90" y2="68" />
        ))}
      </g>

      {/* scanner nodes, pulsing in sequence */}
      {NODES.map((n) => (
        <g
          key={`n-${n.x}-${n.y}`}
          className="dz-node"
          style={{ animationDelay: `${n.delay}ms` }}
        >
          <Diamond cx={n.x} cy={n.y} rx={13} fill={PLANE_TOP} />
          <Cube cx={n.x} cy={n.y - 2} s={7} />
        </g>
      ))}

      {/* consensus state */}
      <g>
        <circle cx="90" cy="68" r="15" fill={PLANE_TOP} stroke={CUBE_LIME} strokeWidth="1.6" />
        <circle cx="90" cy="68" r="6.5" fill={CUBE_LIME} />
        <path
          d="M86.6 68.2l2.6 2.6 5-5.4"
          fill="none"
          stroke={CUBE_DARK}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* 03 · PROTECT — a verified artifact resolving into the attested trust layer   */
/* -------------------------------------------------------------------------- */
export function ProtectDiagram() {
  return (
    <svg
      viewBox="0 0 180 136"
      className="h-full w-full"
      role="img"
      aria-label="Diagram: a scanned package whose signed evidence bundle can optionally be anchored as a commitment on Solana Devnet"
    >
      <Diamond cx={90} cy={36} rx={68} fill={PLANE_TOP} />
      <Diamond cx={90} cy={52} rx={50} />

      {/* trust base */}
      <Diamond cx={90} cy={96} rx={72} />
      <polygon points="90,100 132,78 132,89 90,111 48,89 48,78" fill={CUBE_DARK} />
      <polygon points="90,100 132,78 90,56 48,78" fill="#2C2D28" />

      {/* approval shield */}
      <g className="dz-approve">
        <path
          d="M90 18c8 3.4 15 5 22 5.8 0 11-1 18-3.4 24-3 7.4-9 12.4-18.6 15.6-9.6-3.2-15.6-8.2-18.6-15.6-2.4-6-3.4-13-3.4-24 7-0.8 14-2.4 22-5.8z"
          fill={PLANE_TOP}
          stroke={CUBE_LIME}
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M83.6 42.6l4.8 4.8 8.6-9.4"
          fill="none"
          stroke={CUBE_LIME}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* signal entering the trust layer */}
      <g className="dz-signal">
        <circle cx="18" cy="74" r="4" fill={CUBE_LIME} />
      </g>
    </svg>
  );
}
