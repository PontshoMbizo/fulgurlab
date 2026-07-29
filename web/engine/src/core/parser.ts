import { createElement } from './factory';
import { CircuitEngine } from './engine';
import { undumpModelFromTokens } from '../elements/custom_logic';
import { undumpCompositeModel } from '../elements/composite';
import { parseXmlCircuit } from './xmlParser';

// Falstad-text-format reader, now with the full classic `$` options line
// (CircuitLoader.java's readOptions()) and `o` scope lines, plus an
// auto-detecting delegate to the XML dump format (XMLSerializer.java /
// XMLDeserializer.java) the Java fork also accepts -- see xmlParser.ts's
// header comment for that format's design.
export class CircuitParser {
    engine: CircuitEngine;

    constructor(engine: CircuitEngine) {
        this.engine = engine;
    }

    parse(circuitText: string) {
        this.engine.clear();

        // XML dumps (XMLSerializer.dumpCircuit()) always start with a `<cir`
        // root element; the classic text format never starts with `<`, so
        // this is an unambiguous auto-detect (same test CircuitLoader.java's
        // own readCircuit(String,int) uses: `text.startsWith("<")`).
        if (circuitText.trim().startsWith('<cir')) {
            parseXmlCircuit(this.engine, circuitText);
            return;
        }

        const lines = circuitText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
            if (tokens.length === 0) continue;

            const type = tokens[0];
            // Global settings / scope / hint / etc. lines: not modelled yet,
            // just consumed so they don't get misread as element lines.
            if (type === '$' || type === 'o' || type === 'h' || type === '!' || type === '%' || type === '?' || type === 'B'
                || type === '.' || type === '38') {
                this.parseOption(type, tokens, trimmed);
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

            let elm = null;
            try {
                elm = createElement(type, x1, y1, x2, y2, flags, extraTokens);
            } catch {
                // A constructor may REJECT a token format it can't faithfully
                // represent (e.g. Java's expression-based dependent sources
                // vs this port's fixed-gain simplification). Half-parsing
                // such a line used to yield a subtly-broken circuit
                // ("Singular matrix!" on the Java corpus); preserving it
                // verbatim keeps the file intact and the rest simulating.
                elm = null;
            }
            if (elm) {
                this.engine.elmList.push(elm);
            } else {
                // Unknown dump type: preserve the line verbatim so a load->
                // save round-trip never destroys unported-element content
                // (matches Java, which always has a class for its own dumps;
                // for us "unknown" is expected for Tier-2/3 circuits).
                this.engine.preservedLines.push(trimmed);
                console.warn(`Unsupported element type "${type}" preserved verbatim (not simulated)`);
            }
        }
        this.engine.setup();
    }

    private parseOption(type: string, tokens: string[], trimmed: string) {
        if (type === '$') {
            // Full classic options line -- CircuitLoader.java's readOptions():
            //   $ flags maxTimeStep speed currentBar voltageRange [powerBar [minTimeStep]]
            // flags: UI checkbox bits (dots/grid/volts/power/values/adjustTimeStep/
            // autoDC) -- not modelled by this engine, only consumed so the
            // tokenizer stays aligned.
            if (tokens.length > 2) {
                const maxTimeStep = parseFloat(tokens[2]);
                // Java: `sim.maxTimeStep = sim.timeStep = Double.parseDouble(...)`
                // -- both fields get the same value on load. maxTimeStep is
                // the new, correctly-named field; timeStep is kept in sync
                // too for back-compat with existing callers that only read it
                // (this engine doesn't yet do adaptive step subdivision, so
                // the two stay equal exactly as they do right after a Java
                // load).
                if (!Number.isNaN(maxTimeStep)) {
                    this.engine.maxTimeStep = maxTimeStep;
                    this.engine.timeStep = maxTimeStep;
                }
            }
            // tokens[3] (speed, drives Java's speedBar) and tokens[4]
            // (currentBar slider value) are UI-only in the Java source --
            // this engine has no such widgets to feed, so they're parsed (to
            // keep the field-index mapping documented) and intentionally not
            // stored anywhere.
            if (tokens.length > 5) {
                const vr = parseFloat(tokens[5]);
                if (!Number.isNaN(vr)) this.engine.voltageRange = vr;
            }
            // tokens[6] (powerBar) is UI-only, same as speed/currentBar above.
            if (tokens.length > 7) {
                const mts = parseFloat(tokens[7]);
                if (!Number.isNaN(mts)) this.engine.minTimeStep = mts;
            }
            return;
        }
        if (type === 'o') {
            // Scope line -- CircuitLoader.java: `Scope sc = new Scope(...);
            // sc.undump(st);`, whose own first token (ScopeSerializer.undump())
            // is the ELEMENT INDEX being probed (position in elmList at dump
            // time, or -1 for "no element"). Extract just that for the app
            // layer to turn into a scope channel later (not this parser's
            // job -- it doesn't model Scope objects); the full line is also
            // preserved verbatim so a save keeps whatever this engine can't
            // reconstruct (per-scope display flags, scale, etc.).
            if (tokens.length > 1) {
                const idx = parseInt(tokens[1], 10);
                if (!Number.isNaN(idx)) this.engine.scopeHints.push(idx);
            }
            this.engine.preservedLines.push(trimmed);
            return;
        }
        if (type === '.') {
            // CustomCompositeModel "." line: a subcircuit definition. Like "!"
            // lines these must be registered BEFORE any 410 element that names
            // them -- CustomCompositeElm's constructor throws when its model is
            // missing, so the element line would otherwise be preserved
            // verbatim instead of simulated. The line is ALSO preserved so a
            // save re-emits the definition even if no 410 references it (the
            // model registry is module-level and shared across engines).
            try {
                undumpCompositeModel(tokens.slice(1));
            } catch (e) {
                console.warn(`Failed to parse subcircuit model line "${tokens.join(' ')}": ${e}`);
            }
            this.engine.preservedLines.push(trimmed);
            return;
        }
        if (type === '38') {
            // "38" is not an element -- it's an Adjustable (slider) binding:
            // `38 <elmIndex> <editItem> <min> <max> <label>`. This engine has
            // no slider model, so it rides along verbatim rather than being
            // misread as a 6-token element line.
            this.engine.preservedLines.push(trimmed);
            return;
        }
        if (type === '!') {
            // CustomLogicModel "!" line: `! name flags inputs outputs infoText rules`
            // (CustomLogicModel.java's undumpModel()/undump()). Registers the
            // model into custom_logic.ts's module-level registry BEFORE any
            // CustomLogicElm (dump type 208) referencing it gets constructed
            // -- matters for element lines later in this same file, though
            // CustomLogicElm itself resolves lazily either way (see that
            // class's constructor comment) so out-of-order "!" lines don't
            // crash the parse, just lose the model's real rule table for any
            // element line that appears BEFORE its own "!" line.
            try {
                undumpModelFromTokens(tokens.slice(1));
            } catch (e) {
                console.warn(`Failed to parse custom logic model line "${tokens.join(' ')}": ${e}`);
            }
            return;
        }
        // h / % / ? / B: not modelled (hint / afilter-specific / etc.).
        // Previously these were silently dropped, which meant a % line
        // introduced by e.g. xmlParser.ts's unsupported-XML-content fallback
        // (`%xml <original line>`) would vanish on the very next parse ->
        // dump -> parse cycle instead of round-tripping. Preserve verbatim,
        // same treatment as an unrecognized element line.
        this.engine.preservedLines.push(trimmed);
    }
}
