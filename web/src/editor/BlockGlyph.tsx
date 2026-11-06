// What a block looks like inside its footprint: control-engineering notation,
// drawn the way it would be on a whiteboard (fractions, triangles, Σ).
import type { Block } from './types';
import { blockSize, num, polyText, ports } from './model';

const n = (b: Block, k: string) => b.params[k] as number;

function Fraction({ top, bottom, w, h }: { top: string; bottom: string; w: number; h: number }) {
  const cx = w / 2, cy = h / 2;
  const len = Math.min(w - 16, Math.max(top.length, bottom.length) * 7.2 + 8);
  const size = Math.max(top.length, bottom.length) > 14 ? 11 : 13;
  return (
    <g className="glyph-math">
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={size}>{top}</text>
      <line x1={cx - len / 2} x2={cx + len / 2} y1={cy} y2={cy} className="glyph-rule" />
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={size}>{bottom}</text>
    </g>
  );
}

function Center({ children, w, h, size = 14, cls = 'glyph-math' }: { children: React.ReactNode; w: number; h: number; size?: number; cls?: string }) {
  return <text x={w / 2} y={h / 2 + size * 0.36} textAnchor="middle" fontSize={size} className={cls}>{children}</text>;
}

/** Small icon area for sources and sinks. */
function Icon({ d, w, h }: { d: string; w: number; h: number }) {
  return <path d={d} transform={`translate(${w / 2 - 20},${h / 2 - 12})`} className="glyph-icon" />;
}

export function BlockGlyph({ block }: { block: Block }) {
  const { w, h } = blockSize(block);
  const b = block;
  switch (b.type) {
    case 'gain':
      return (
        <g>
          <path d={`M0,0 L${w},${h / 2} L0,${h} Z`} className="block-shape" />
          <text x={w * 0.34} y={h / 2 + 5} textAnchor="middle" fontSize={13} className="glyph-math">{num(n(b, 'k'))}</text>
        </g>
      );
    case 'sum': {
      const signs = String(b.params.signs);
      const r = Math.min(w, h) / 2;
      return (
        <g>
          <rect width={w} height={h} rx={r} className="block-shape" />
          <Center w={w} h={h} size={17}>Σ</Center>
          {[...signs].map((s, i) => (
            <text key={i} x={9} y={(h * (i + 1)) / (signs.length + 1) + 4} fontSize={11} className="glyph-sign">{s === '-' ? '−' : '+'}</text>
          ))}
        </g>
      );
    }
    case 'product': {
      const ops = String(b.params.ops);
      return (
        <g>
          <rect width={w} height={h} rx={4} className="block-shape" />
          <Center w={w} h={h} size={18}>×</Center>
          {[...ops].map((s, i) => (
            <text key={i} x={8} y={(h * (i + 1)) / (ops.length + 1) + 4} fontSize={11} className="glyph-sign">{s === '/' ? '÷' : '×'}</text>
          ))}
        </g>
      );
    }
    case 'scope': {
      return (
        <g>
          <rect width={w} height={h} rx={4} className="block-shape" />
          <rect x={14} y={12} width={w - 22} height={h - 24} rx={2} className="glyph-screen" />
          <path d={`M${16},${h / 2 + 6} q${(w - 26) / 6},-${h / 3} ${(w - 26) / 3},0 t${(w - 26) / 3},0 t${(w - 26) / 3},0`} className="glyph-trace" />
        </g>
      );
    }
    default:
      break;
  }

  let body: React.ReactNode;
  switch (b.type) {
    case 'step': body = <Icon w={w} h={h} d="M2,22 H18 V2 H38" />; break;
    case 'constant': body = <Center w={w} h={h} size={15}>{num(n(b, 'value'))}</Center>; break;
    case 'sine': body = <Icon w={w} h={h} d="M2,12 C8,-4 14,-4 20,12 S32,28 38,12" />; break;
    case 'ramp': body = <Icon w={w} h={h} d="M2,22 H10 L38,2" />; break;
    case 'clock': body = (
      <g transform={`translate(${w / 2},${h / 2})`} className="glyph-icon">
        <circle r={12} /><path d="M0,-7 V0 L5,4" />
      </g>
    ); break;
    case 'abs': body = <Center w={w} h={h} size={15}>|u|</Center>; break;
    case 'saturation': body = <Icon w={w} h={h} d="M2,22 H12 L28,2 H38" />; break;
    case 'integrator': body = <Fraction w={w} h={h} top="1" bottom="s" />; break;
    case 'derivative': body = <Fraction w={w} h={h} top="du" bottom="dt" />; break;
    case 'transferFn': body = <Fraction w={w} h={h} top={polyText(b.params.num as number[], 's')} bottom={polyText(b.params.den as number[], 's')} />; break;
    case 'discreteTF': body = <Fraction w={w} h={h} top={polyText(b.params.num as number[], 'z')} bottom={polyText(b.params.den as number[], 'z')} />; break;
    case 'unitDelay': body = <Fraction w={w} h={h} top="1" bottom="z" />; break;
    case 'zoh': body = <Icon w={w} h={h} d="M2,22 H10 V16 H18 V10 H26 V4 H38" />; break;
    case 'delay': body = <Center w={w} h={h} size={14}>e<tspan dy={-6} fontSize={10}>−{num(n(b, 'T'))}s</tspan></Center>; break;
    case 'pid': body = (
      <g className="glyph-math">
        <text x={w / 2} y={h / 2 - 2} textAnchor="middle" fontSize={15}>PID</text>
        <text x={w / 2} y={h / 2 + 16} textAnchor="middle" fontSize={10} className="glyph-sub">
          Kp {num(n(b, 'kp'))}  Ki {num(n(b, 'ki'))}  Kd {num(n(b, 'kd'))}
        </text>
      </g>
    ); break;
    default: body = <Center w={w} h={h} size={11}>{b.type}</Center>;
  }
  return (
    <g>
      <rect width={w} height={h} rx={4} className="block-shape" />
      {body}
    </g>
  );
}

export function portCount(b: Block) {
  return ports(b);
}
