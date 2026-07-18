import { describe, it, expect } from 'vitest';
import { CircuitEngine } from '../src/core/engine';
import { GroundElm } from '../src/elements/ground';
import { RailElm } from '../src/elements/voltage';
import { ResistorElm } from '../src/elements/resistor';
import { ScopeElm } from '../src/elements/scope';
import { createElement } from '../src/core/factory';

// Mirrors new-elements.test.ts's ProbeElm/OutputElm/AmmeterElm describe
// block in style -- ScopeElm's electrical model is the SAME "high-Z passive
// measuring element" family (see scope.ts's class comment), so its tests
// follow the same "does it read correctly, and does it perturb nothing"
// shape as ProbeElm's own tests there.

describe('ScopeElm (dump type 403)', () => {
    it('factory creates ScopeElm from dump type "403"', () => {
        const elm = createElement('403', 0, 0, 100, 0, 0, []);
        expect(elm).toBeInstanceOf(ScopeElm);
        expect(elm!.getDumpType()).toBe('403');
    });

    it('round-trips through dump()/parse (createElement) with no extra tokens', () => {
        const scope = new ScopeElm(10, 20, 110, 20, 0);
        const line = scope.dump();
        const tokens = line.trim().split(/\s+/).filter(t => t.length > 0);
        expect(tokens[0]).toBe('403');

        const [type, xs, ys, x2s, y2s, flagss, ...extra] = tokens;
        expect(extra.length).toBe(0); // dumpTokens() emits nothing -- see scope.ts

        const scope2 = createElement(type, parseInt(xs, 10), parseInt(ys, 10), parseInt(x2s, 10), parseInt(y2s, 10), parseInt(flagss, 10), extra);
        expect(scope2).toBeInstanceOf(ScopeElm);
        expect(scope2!.x).toBe(10);
        expect(scope2!.y).toBe(20);
        expect(scope2!.x2).toBe(110);
        expect(scope2!.y2).toBe(20);
    });

    it('accepts and ignores extra (Java-style scope-config) tokens on parse without throwing', () => {
        // A real Falstad/CircuitJS1 save file's 403 line carries one extra
        // `_`-joined blob (the Scope window's rect/scale/flags) -- this port
        // has nowhere to put that state (see scope.ts's DUMP FORMAT
        // DIVERGENCE note), so parsing it must not fail construction.
        expect(() => new ScopeElm(0, 0, 100, 0, 0, ['5_10_200_100_1_0_0_0_0.5_-1_0'])).not.toThrow();
        const elm = createElement('403', 0, 0, 100, 0, 0, ['5_10_200_100_1_0_0_0_0.5_-1_0']);
        expect(elm).toBeInstanceOf(ScopeElm);
    });

    it('is high-Z: a voltage-divider mid-node reads the same with and without a ScopeElm attached', () => {
        // rail --r1-- mid --r2-- gnd, mid also probed by a bare ScopeElm to
        // ground. If the scope loaded the circuit at all, the mid-node
        // voltage (and r1/r2 currents) would shift from the plain-divider
        // baseline computed without it.
        function buildDivider(withScope: boolean) {
            const engine = new CircuitEngine();
            const rail = new RailElm(0, 0, 0, 0, 0, 0);
            rail.maxVoltage = 10;
            const r1 = new ResistorElm(0, 0, 50, 0, 0, 1000);
            const r2 = new ResistorElm(50, 0, 100, 0, 0, 1000);
            const gnd = new GroundElm(100, 0, 100, 0, 0);
            const elmList = [rail, r1, r2, gnd];
            let scope: ScopeElm | undefined;
            if (withScope) {
                // Terminal 1 at the mid node (50,0); terminal 2 dangling
                // (not wired to the ground point at (100,0), a distinct
                // coordinate) -- exactly the "measure against ground via the
                // analyzer's floating-node fallback" case the spec describes.
                scope = new ScopeElm(50, 0, 50, 50, 0);
                elmList.push(scope);
            }
            engine.elmList = elmList;
            engine.analyzeAndStamp();
            for (let i = 0; i < 5; i++) engine.stepOnce();
            return { engine, r1, r2, scope };
        }

        const baseline = buildDivider(false);
        const withScope = buildDivider(true);

        // 10V across two equal 1k resistors -> 5V at mid, 5mA through both.
        expect(baseline.r1.current).toBeCloseTo(0.005, 3);
        expect(withScope.r1.current).toBeCloseTo(baseline.r1.current, 6);
        expect(withScope.r2.current).toBeCloseTo(baseline.r2.current, 6);

        // The scope's own terminal-1 reading matches the undisturbed mid
        // node voltage (~5V), proving it measured without perturbing.
        expect(withScope.scope!.getVoltageDiff()).toBeCloseTo(5, 1);
    });

    it('getVoltageDiff() reflects volts[0] - volts[1] directly', () => {
        const scope = new ScopeElm(0, 0, 100, 0, 0);
        scope.volts = [3.3, 1.1];
        expect(scope.getVoltageDiff()).toBeCloseTo(2.2, 6);

        scope.volts = [-2, 4];
        expect(scope.getVoltageDiff()).toBeCloseTo(-6, 6);
    });

    it('never stamps or steps: current stays 0 and posts are not electrically connected', () => {
        const scope = new ScopeElm(0, 0, 100, 0, 0);
        expect(scope.getConnection(0, 1)).toBe(false);
        expect(scope.current).toBe(0);
        scope.calculateCurrent(); // base no-op -- must not throw or assign current
        expect(scope.current).toBe(0);
    });
});
