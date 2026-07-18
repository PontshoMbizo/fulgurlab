import { CircuitElm } from './base';

// Ported from ScopeElm.java, dump type 403 -- but NOT a byte-faithful port.
// Java's ScopeElm is a screen-space UI overlay: getPostCount() returns 0 and
// its `elmScope` (a `Scope` instance) is wired to some OTHER already-placed
// element via setScopeElm(e)/elmScope.setElm(e); ScopeElm itself carries no
// electrical posts or nodes of its own at all -- it is purely a resizable
// on-canvas graph window, not a probe.
//
// DEVIATION (documented, per the task spec): this port makes ScopeElm a real
// placeable 2-terminal HIGH-IMPEDANCE MEASURING COMPONENT instead -- the
// Simulink "Scope block" model the product wants (wire terminal 1 to a
// signal, terminal 2 to ground or leave it dangling). Electrically this is
// IDENTICAL to ProbeElm's default (dumped/loaded, resistance=0) case: two
// posts, no stamp(), no doStep(), getVoltageDiff() = volts[0] - volts[1],
// current stays 0. See probe.ts's own class comment for that model's
// rationale; this class is deliberately simpler than ProbeElm (no meter
// mode, no rms/max/min/period tracking, no resistance token at all) since
// none of that belongs to the "what does the scope channel show" concern --
// the app-layer ScopeChannel (web/app/src/engine/store.ts) owns sampling and
// history, not the element.
//
// DUMP FORMAT DIVERGENCE (documented): Java's dump-constructor reads exactly
// ONE extra token -- a single `_`-delimited blob (`elmScope.undump()`) that
// packs the Scope window's rect/scale/visible-value-flags/speed/etc, none of
// which describes anything electrical. This port's ScopeElm has no such
// state (the app's ScopeChannel owns color/label/history instead, and the
// canvas owns the on-screen body geometry via point1/point2 like any other
// element), so dumpTokens() emits NONE of that blob back. The parse side
// still ACCEPTS it, though: any extra tokens found on a 403 line (e.g. from
// a circuit imported from real Falstad/CircuitJS1 text) are read and
// silently ignored rather than throwing, so importing a foreign save file
// with real ScopeElm lines doesn't fail construction -- it just drops the
// screen-space window state, which this port has nowhere to put anyway (the
// app auto-creates a fresh ScopeChannel for every 403 element on load; see
// store.ts's loadSnapshot()).
export class ScopeElm extends CircuitElm {
    constructor(x: number, y: number, x2: number, y2: number, flags: number, params?: string[]) {
        super(x, y, x2, y2, flags);
        // params (Java's single `_`-joined scope-config token, or several
        // tokens if a foreign dump line was hand-split before reaching here)
        // are intentionally read and discarded -- see the class comment.
        void params;
    }

    getDumpType() { return '403'; }
    // No tokens of our own to emit -- see the class comment's "DUMP FORMAT
    // DIVERGENCE" note. Deliberately NOT overridden to echo back `params`,
    // since this element owns no config state params could have carried.
    dumpTokens(): (string | number | boolean)[] { return []; }

    // High-Z measuring element: posts are NOT connected to each other (same
    // as ProbeElm's resistance===0 case) and no independent node needs a
    // stamp. Base class defaults already give: stamp() no-op, doStep()
    // no-op, current stays 0 (never assigned), getConnection() defaulting to
    // `true` would be WRONG here though -- override it to false, matching
    // ProbeElm.getConnection() for resistance===0, so the analyzer doesn't
    // treat the scope's two posts as electrically joined.
    getConnection(n1: number, n2: number): boolean { return false; }

    // getVoltageDiff() = volts[0] - volts[1] is already CircuitElm's own
    // default (base.ts:253) -- not overridden here, listed only so this
    // class's electrical contract is easy to audit at a glance without
    // reading base.ts side by side.
}
