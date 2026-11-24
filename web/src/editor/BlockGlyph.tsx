// What a block looks like inside its footprint. Every icon follows
// docs/design/classic-ui/Blocks.dc.html: a 64x48 design box whose body is
// x 8.5-55.5, y 4.5-43.5. Curve icons are drawn in those design coordinates and
// stretched to the block's real size with non-scaling strokes; text (fractions,
// signs, values) is laid out in real pixels so it never distorts.
import type { Block } from './types';
import { blockSize, num, polyText, ports } from './model';

const n = (b: Block, k: string) => b.params[k] as number;

/** Design-box body (x 8.5..55.5, y 4.5..43.5), stretched over the block's w x h. */
function Design({ w, h, children }: { w: number; h: number; children: React.ReactNode }) {
  return (
    <svg x={0} y={0} width={w} height={h} viewBox="8.5 4.5 47 39" preserveAspectRatio="none" overflow="visible" className="glyph-design">
      {children}
    </svg>
  );
}

const Axis = ({ d }: { d: string }) => <path d={d} className="glyph-axis" />;
const Curve = ({ d, cls = 'glyph-curve' }: { d: string; cls?: string }) => <path d={d} className={cls} />;

/** Text with the variable (s, z, u, t) set in italic, like maths. */
function MathText({ s, v }: { s: string; v?: string }) {
  if (!v) return <>{s}</>;
  return (
    <>
      {s.split(new RegExp(`(${v})`)).map((p, i) => (p === v ? <tspan key={i} fontStyle="italic">{p}</tspan> : p))}
    </>
  );
}

function Fraction({ top, bottom, v, w, h }: { top: string; bottom: string; v?: string; w: number; h: number }) {
  const cx = w / 2, cy = h / 2;
  const longest = Math.max(top.length, bottom.length);
  const S = Math.min(h * 0.36, (w - 16) / (longest * 0.5));
  const len = Math.min(w - 12, longest * S * 0.5 + 8);
  return (
    <g className="glyph-math" fontSize={S}>
      <text x={cx} y={cy - 0.22 * S} textAnchor="middle"><MathText s={top} v={v} /></text>
      <line x1={cx - len / 2} x2={cx + len / 2} y1={cy + 0.5} y2={cy + 0.5} className="glyph-rule" />
      <text x={cx} y={cy + 0.9 * S} textAnchor="middle"><MathText s={bottom} v={v} /></text>
    </g>
  );
}

function Center({ w, h, size, children, italic }: { w: number; h: number; size: number; children: React.ReactNode; italic?: boolean }) {
  return (
    <text x={w / 2} y={h / 2 + size * 0.34} textAnchor="middle" fontSize={size} fontStyle={italic ? 'italic' : undefined} className="glyph-math">
      {children}
    </text>
  );
}

export function BlockGlyph({ block }: { block: Block }) {
  const { w, h } = blockSize(block);
  const b = block;
  switch (b.type) {
    case 'gain': {
      const k = num(n(b, 'k'));
      return (
        <g>
          <path d={`M0,0 L${w},${h / 2} L0,${h} Z`} className="block-shape" />
          <text x={w * 0.34} y={h / 2 + 0.17 * h} textAnchor="middle" fontSize={Math.min(h * 0.4, (w * 0.42) / (k.length * 0.5))} className="glyph-math">{k}</text>
        </g>
      );
    }
    case 'sum': {
      const signs = String(b.params.signs);
      const r = Math.min(w, h) / 2;
      return (
        <g>
          <rect width={w} height={h} rx={r} className="block-shape" />
          {[...signs].map((s, i) => (
            <text key={i} x={w * 0.3} y={(h * (i + 1)) / (signs.length + 1) + 5} textAnchor="middle" fontSize={15} className="glyph-math">{s === '-' ? '−' : '+'}</text>
          ))}
        </g>
      );
    }
    case 'product': {
      const ops = String(b.params.ops);
      const divides = ops.includes('/');
      return (
        <g>
          <rect width={w} height={h} className="block-shape" />
          <Center w={w} h={h} size={h * 0.5}>×</Center>
          {divides && [...ops].map((s, i) => (
            <text key={i} x={11} y={(h * (i + 1)) / (ops.length + 1) + 4} textAnchor="middle" fontSize={12} className="glyph-math">{s === '/' ? '÷' : '×'}</text>
          ))}
        </g>
      );
    }
    case 'clock': {
      const r = Math.min(w, h) / 2;
      return (
        <g>
          <circle cx={w / 2} cy={h / 2} r={r} className="block-shape" />
          <path d={`M${w / 2},${h / 2 - r * 0.7} V${h / 2} H${w / 2 + r * 0.55}`} className="glyph-curve" strokeLinecap="round" />
        </g>
      );
    }
    case 'scope':
      return (
        <g>
          <rect width={w} height={h} className="block-shape" />
          <Design w={w} h={h}>
            <rect x={15.5} y={10.5} width={33} height={24} className="glyph-curve" strokeWidth={1.2} fill="#fff" />
            <path d="M24,38.5 H40" className="glyph-curve" strokeWidth={1.2} />
            <Curve d="M18,27 C21,15 24,15 27,24 S33,33 36,22 S42,14 46,19" cls="glyph-thin" />
          </Design>
        </g>
      );
    default:
      break;
  }

  let body: React.ReactNode;
  switch (b.type) {
    case 'step': body = <Design w={w} h={h}><Curve d="M14,36 H30 V12 H50" /></Design>; break;
    case 'constant': {
      const v = num(n(b, 'value'));
      body = <Center w={w} h={h} size={Math.min(h * 0.5, (w - 16) / (v.length * 0.5))}>{v}</Center>;
      break;
    }
    case 'sine': body = <Design w={w} h={h}><Axis d="M13,24 H51" /><Curve d="M13,24 C19,3 25,3 32,24 S45,45 51,24" /></Design>; break;
    case 'ramp': body = <Design w={w} h={h}><Axis d="M14,37 H50 M14,37 V9" /><Curve d="M14,35 H23 L49,10" /></Design>; break;
    case 'abs': body = <Center w={w} h={h} size={h * 0.46} italic>|u|</Center>; break;
    case 'saturation': body = <Design w={w} h={h}><Axis d="M13,24 H51 M32,9 V39" /><Curve d="M13,36 H24 L40,12 H51" /></Design>; break;
    case 'integrator': body = <Fraction w={w} h={h} top="1" bottom="s" v="s" />; break;
    case 'derivative': body = <g fontStyle="italic"><Fraction w={w} h={h} top="du" bottom="dt" /></g>; break;
    case 'transferFn': body = <Fraction w={w} h={h} top={polyText(b.params.num as number[], 's')} bottom={polyText(b.params.den as number[], 's')} v="s" />; break;
    case 'discreteTF': body = <Fraction w={w} h={h} top={polyText(b.params.num as number[], 'z')} bottom={polyText(b.params.den as number[], 'z')} v="z" />; break;
    case 'unitDelay': body = <Fraction w={w} h={h} top="1" bottom="z" v="z" />; break;
    case 'zoh': body = <Design w={w} h={h}><Curve d="M13,36 H20 V30 H27 V23 H34 V17 H41 V11 H51" /></Design>; break;
    case 'delay': body = (
      <Design w={w} h={h}>
        <Axis d="M13,24 H51" />
        <path d="M19,9 V39" className="glyph-thin" />
        <Curve d="M19,24 C24,5 29,5 34.5,24 S45,43 50,24" />
      </Design>
    ); break;
    case 'pid': body = (
      <text x={w / 2} y={h / 2 + h * 0.12} textAnchor="middle" fontSize={h * 0.36} className="glyph-math">PID(<tspan fontStyle="italic">s</tspan>)</text>
    ); break;
    default: body = <Center w={w} h={h} size={11}>{b.type}</Center>;
  }
  return (
    <g>
      <rect width={w} height={h} className="block-shape" />
      {body}
    </g>
  );
}

export function portCount(b: Block) {
  return ports(b);
}
