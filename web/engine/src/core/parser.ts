import { createElement } from './factory';
import { CircuitEngine } from './engine';

// Minimal Falstad-text-format reader. This is a stand-in for the full
// io/falstadText.ts described in docs/react-rewrite-plan.md §7 (options-line
// field parsing, escape scheme, scope/hint lines, unknown-element
// preservation) — those are Phase 1 item 5 and not implemented here. What
// this does handle: element lines (dump id + geometry + flags + trailing
// tokens) and the `$` options line's timeStep field, enough to load simple
// Tier-1 circuits for engine-level tests.
export class CircuitParser {
    engine: CircuitEngine;

    constructor(engine: CircuitEngine) {
        this.engine = engine;
    }

    parse(circuitText: string) {
        this.engine.clear();
        const lines = circuitText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
            if (tokens.length === 0) continue;

            const type = tokens[0];
            // Global settings / scope / hint / etc. lines: not modelled yet,
            // just consumed so they don't get misread as element lines.
            if (type === '$' || type === 'o' || type === 'h' || type === '!' || type === '%' || type === '?' || type === 'B') {
                this.parseOption(type, tokens);
                continue;
            }

            if (tokens.length < 6) {
                console.warn(`Line too short to be an element: ${trimmed}`);
                continue;
            }

            const x1 = parseInt(tokens[1], 10);
            const y1 = parseInt(tokens[2], 10);
            const x2 = parseInt(tokens[3], 10);
            const y2 = parseInt(tokens[4], 10);
            const flags = parseInt(tokens[5], 10);
            const extraTokens = tokens.slice(6);

            const elm = createElement(type, x1, y1, x2, y2, flags, extraTokens);
            if (elm) {
                this.engine.elmList.push(elm);
            }
        }
        this.engine.setup();
    }

    private parseOption(type: string, tokens: string[]) {
        if (type === '$') {
            // $ flags timeStep minTimeStep maxTimeStep ... — only timeStep for now.
            if (tokens.length > 2) {
                this.engine.timeStep = parseFloat(tokens[2]);
            }
        }
    }
}
