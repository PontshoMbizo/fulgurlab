import { createElement } from './factory';
import { CircuitEngine } from './engine';
import { escapeDumpText } from '../elements/base';

// Imports the Java fork's XML circuit-dump format (XMLSerializer.java /
// XMLDeserializer.java), the format CircuitJS1 has used for its own saves
// since the XML-migration commit. This is a small, dependency-free reader
// for that specific, machine-written shape: one `<cir>` root, self-closing
// child elements (`<tag attr="val" .../>`) in file order, and a handful of
// non-self-closing children (`<o>...</o>` scope blocks, `<scopedata>...
// </scopedata>` text blobs) that this port doesn't model yet.
//
// Design note: rather than a general DOM, this walks the text line-by-line
// (real Java dumps are pretty-printed one-element-per-line by
// XMLSerializer.prettyPrint()) and hand-parses attributes with a regex. This
// is NOT a general XML parser -- it assumes exactly what XMLSerializer.java
// emits (double-quoted attrs, `&lt; &gt; &amp; &quot;` the only entities,
// self-closing tags for leaf elements). Verified against auto-tests/capac.txt
// and auto-tests/lrc.txt.
//
// Element reconstruction strategy: for each child tag whose dump type this
// port's factory.ts registry supports, this file re-derives that class's
// CLASSIC TEXT dump token list (the same tokens factory.createElement()'s
// StringTokenizer-shaped constructors expect) from the XML attributes, by
// reading each class's Java dumpXml()/dump() pair side by side (see the
// per-tag comments below) and cross-checking against this port's own
// dumpTokens() implementations (which define what its OWN constructors
// require on reparse -- the two aren't always in the same order Java uses,
// since this port's dumpTokens() ordering is dictated by ITS OWN
// constructors, not Java's).
//
// Tags this port's factory doesn't support (chips, custom logic, subcircuits,
// audio I/O, ...) can't ride along as XML -- there is no "unknown element"
// slot in this text-based engine's dump format the way Java's XML keeps
// arbitrary elements. Instead, each unsupported line (and any nested block,
// e.g. a whole `<o>...</o>` scope) is preserved VERBATIM as one or more
// `%xml <original line>` entries in engine.preservedLines. `%` lines are
// otherwise-inert to the classic parser (CircuitParser.parseOption), which
// this change also updates to re-preserve them unchanged on every re-parse --
// so a load -> save -> load -> save cycle is a stable fixed point even for
// content this port can't simulate.

interface Reconstructed {
    dumpType: string;
    tokens: (string | number | boolean)[];
}

function numAttr(attrs: Record<string, string>, name: string, def: number): number {
    const v = attrs[name];
    if (v === undefined) return def;
    const n = parseFloat(v);
    return Number.isNaN(n) ? def : n;
}

function strAttr(attrs: Record<string, string>, name: string, def: string): string {
    const v = attrs[name];
    return v === undefined ? def : v;
}

function boolAttr(attrs: Record<string, string>, name: string): boolean {
    return attrs[name] === 'true';
}

// Reverses XMLSerializer.dumpAttr(String)'s escaping
// (&,",',< -- in that encode order) plus the `>` case XMLDeserializer.
// parseStringAttr() also unescapes for symmetry with hand-edited files.
// &amp; must be decoded LAST so an entity that itself came from an escaped
// literal ("&amp;lt;" -> "&lt;") doesn't get double-unescaped into "<".
function unescapeXmlAttr(s: string): string {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

const ATTR_RE = /([A-Za-z_][-A-Za-z0-9_:.]*)="([^"]*)"/g;

function parseAttrs(line: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR_RE.exec(line))) {
        attrs[m[1]] = unescapeXmlAttr(m[2]);
    }
    return attrs;
}

// Per-tag classic-token reconstruction. `flags` is already parsed from the
// `f` attribute (CircuitElm.dumpXml()'s universal "x"/"f" pair). Each case is
// keyed by the Java XML TAG NAME (CircuitElm.getXmlDumpType(): the dump-type
// char itself when it falls in the printable ASCII letter range 65-126, else
// the class name with "Elm"/"GateElm" stripped, or a class's own explicit
// override -- see CircuitElm.java:110 and GateElm.java's override).
function reconstruct(tag: string, attrs: Record<string, string>, flags: number): Reconstructed | null {
    switch (tag) {
        // --- Direct letter tags (getXmlDumpType() == the classic dump char) ---
        case 'w': // WireElm.java: no extra dumpXml attrs beyond x/f.
            return { dumpType: 'w', tokens: [] };
        case 'g': // GroundElm.java: dumpXml "sy" (symbolType), skip-if-0.
            return { dumpType: 'g', tokens: [numAttr(attrs, 'sy', 0)] };
        case 'r': // ResistorElm.java: dumpXml "r".
            return { dumpType: 'r', tokens: [numAttr(attrs, 'r', 0)] };
        case 's': // SwitchElm.java: dumpXml "p" (position, skip-if-0), "mm" (momentary bool).
            return { dumpType: 's', tokens: [numAttr(attrs, 'p', 0), boolAttr(attrs, 'mm')] };
        case 'S': // Switch2Elm.java: SwitchElm's p/mm plus "li" (link), "th" (throwCount).
            return {
                dumpType: 'S',
                tokens: [numAttr(attrs, 'p', 0), boolAttr(attrs, 'mm'), numAttr(attrs, 'li', 0), numAttr(attrs, 'th', 2)],
            };
        case 'c': // CapacitorElm.java: dumpXml "c"/"iv"/"sr" (state "vd" not a classic ctor token).
            return { dumpType: 'c', tokens: [numAttr(attrs, 'c', 0), numAttr(attrs, 'iv', 0), numAttr(attrs, 'sr', 0)] };
        case 'l': // InductorElm.java: dumpXml "l"/"ic", "isat" (skip-if-0); state "i" not a ctor token.
            return { dumpType: 'l', tokens: [numAttr(attrs, 'l', 0), numAttr(attrs, 'ic', 0), numAttr(attrs, 'isat', 0)] };
        case 'v': // VoltageElm.java: dumpXml "wf"/"fr"(skip if DC)/"maxv"/"bias"/"phaseShift"/"dutyCycle".
            return {
                dumpType: 'v',
                tokens: [
                    numAttr(attrs, 'wf', 0),
                    numAttr(attrs, 'fr', 40),
                    numAttr(attrs, 'maxv', 5),
                    numAttr(attrs, 'bias', 0),
                    numAttr(attrs, 'phaseShift', 0),
                    numAttr(attrs, 'dutyCycle', 0.5),
                ],
            };
        case 'R': {
            // RailElm.java shares VoltageElm's dumpXml verbatim (no override) --
            // BUT ClockElm.java ALSO dumps as tag "R" (getDumpClass() ==
            // RailElm.class, and getXmlDumpType()/getDumpType() are both
            // inherited unchanged from RailElm: 'R'). The only on-the-wire
            // signal that a given "R" was really a clock is RailElm.
            // FLAG_CLOCK (bit 0) in `f`. This port models Clock as its OWN
            // dump type ('164', see voltage.ts's ClockElm) rather than a
            // RailElm+flag combo, so reconstruct into whichever one the flag
            // indicates, matching that class's own dumpTokens() shape.
            const FLAG_CLOCK = 1;
            if ((flags & FLAG_CLOCK) !== 0) {
                // ClockElm.dumpTokens(): [frequency, maxVoltage, bias, phaseShift, dutyCycle] (no waveform token).
                return {
                    dumpType: '164',
                    tokens: [
                        numAttr(attrs, 'fr', 100),
                        numAttr(attrs, 'maxv', 2.5),
                        numAttr(attrs, 'bias', 2.5),
                        numAttr(attrs, 'phaseShift', 0),
                        numAttr(attrs, 'dutyCycle', 0.5),
                    ],
                };
            }
            return {
                dumpType: 'R',
                tokens: [
                    numAttr(attrs, 'wf', 0),
                    numAttr(attrs, 'fr', 40),
                    numAttr(attrs, 'maxv', 5),
                    numAttr(attrs, 'bias', 0),
                    numAttr(attrs, 'phaseShift', 0),
                    numAttr(attrs, 'dutyCycle', 0.5),
                ],
            };
        }
        case 'O': // OutputElm.java: dumpXml "sc" (scale).
            return { dumpType: 'O', tokens: [numAttr(attrs, 'sc', 0)] };
        case 'p': // ProbeElm.java: dumpXml "me"/"sc"/"re".
            return { dumpType: 'p', tokens: [numAttr(attrs, 'me', 0), numAttr(attrs, 'sc', 0), numAttr(attrs, 're', 0)] };
        case 'd': // DiodeElm.java: dumpXml always writes "mo" (modelName); this
            // port's DiodeElm only ever reads it as a token when FLAG_MODEL
            // (bit 1) is set (see diode.ts dumpTokens()) -- match that gating
            // so reparsing our own re-dump doesn't drift.
            return { dumpType: 'd', tokens: (flags & 2) !== 0 ? [strAttr(attrs, 'mo', '')] : [] };
        case 'z': // ZenerElm extends DiodeElm, inherits the same dumpXml/dumpTokens shape.
            return { dumpType: 'z', tokens: (flags & 2) !== 0 ? [strAttr(attrs, 'mo', '')] : [] };
        case 't': // TransistorElm.java: dumpXml "pn"/"be", dumpXmlState "vbe"/"vbc".
            return {
                dumpType: 't',
                tokens: [numAttr(attrs, 'pn', 1), numAttr(attrs, 'vbe', 0), numAttr(attrs, 'vbc', 0), numAttr(attrs, 'be', 100)],
            };
        case 'f': // MosfetElm.java: dumpXml "vt"/"be".
            return { dumpType: 'f', tokens: [numAttr(attrs, 'vt', 1.5), numAttr(attrs, 'be', 0.02)] };
        case 'a': // OpAmpElm.java dumps "ma"/"mi"/"ga", but this port's OpAmpElm
            // constructor takes no params at all (dumpTokens()==[] via base
            // default) -- nothing to reconstruct.
            return { dumpType: 'a', tokens: [] };
        case 'i': // CurrentElm.java: dumpXml "cu"/"mv" (mv skip-if-0).
            return { dumpType: 'i', tokens: [numAttr(attrs, 'cu', 0), numAttr(attrs, 'mv', 0)] };
        case 'L': // LogicInputElm.java: SwitchElm's p/mm plus "hi"/"lo" (both skip-if-default).
            return {
                dumpType: 'L',
                tokens: [numAttr(attrs, 'p', 0), boolAttr(attrs, 'mm'), numAttr(attrs, 'hi', 5), numAttr(attrs, 'lo', 0)],
            };
        case 'M': // LogicOutputElm.java: dumpXml "th" (skip-if-2.5).
            return { dumpType: 'M', tokens: [numAttr(attrs, 'th', 2.5)] };
        case 'I': // InverterElm.java: dumpXml "sl"/"hi".
            return { dumpType: 'I', tokens: [numAttr(attrs, 'sl', 0), numAttr(attrs, 'hi', 5)] };

        // --- Gate group: GateElm.java's own getXmlDumpType() override strips
        // "GateElm" (not just "Elm") from the class name, e.g. AndGateElm ->
        // "And" -- verified against gate.ts's matching getXmlDumpType()
        // overrides ("And"/"Or"/"Nand"/"Nor"/"Xor"/"Xnor"), not the generic
        // CircuitElm fallback rule. dumpXml: "hi"(highVoltage,skip-if-5),
        // "in"(inputCount,skip-if-2), "pd"(propagationDelay); dumpXmlState:
        // "o" (raw driven output voltage, skip-if-0) -- this is exactly the
        // 2nd classic token (GateElm.dump()/undump() compares it against
        // highVoltage*0.5 to derive the boolean `lastOutput`).
        case 'And':
        case 'Or':
        case 'Nand':
        case 'Nor':
        case 'Xor':
        case 'Xnor': {
            const gateIds: Record<string, string> = {
                And: '150', Or: '152', Nand: '151', Nor: '153', Xor: '154', Xnor: '431',
            };
            return {
                dumpType: gateIds[tag],
                tokens: [numAttr(attrs, 'in', 2), numAttr(attrs, 'o', 0), numAttr(attrs, 'hi', 5)],
            };
        }

        // --- Overridden short XML tags ---
        case 'pt': // PotElm.java: getXmlDumpType()=="pt"; dumpXml "ma"/"po"/"sl" ("li" not modelled by this port's PotElm).
            return {
                dumpType: '174',
                tokens: [numAttr(attrs, 'ma', 1000), numAttr(attrs, 'po', 0.5), escapeDumpText(strAttr(attrs, 'sl', 'Resistance'))],
            };
        case 'LED': // LEDElm.java: default getXmlDumpType (class name - "Elm"); dumpXml "cr"/"cg"/"cb"/"mbc"
            // plus DiodeElm's own "mo" (always written); this port's LEDElm
            // only reads a model-name token when FLAG_MODEL(2) OR
            // FLAG_FWDROP(1) is set (broader than plain DiodeElm's check --
            // see led.ts dumpTokens()).
            return {
                dumpType: '162',
                tokens: [
                    ...((flags & 2) !== 0 || (flags & 1) !== 0 ? [strAttr(attrs, 'mo', '')] : []),
                    numAttr(attrs, 'cr', 1),
                    numAttr(attrs, 'cg', 0),
                    numAttr(attrs, 'cb', 0),
                    numAttr(attrs, 'mbc', 0.01),
                ],
            };
        case 'Ammeter': // AmmeterElm.java: default getXmlDumpType; dumpXml "me"/"sc".
            return { dumpType: '370', tokens: [numAttr(attrs, 'me', 0), numAttr(attrs, 'sc', 0)] };
        case 'VarRail': // VarRailElm.java: default getXmlDumpType; inherits VoltageElm's
            // wf/fr/maxv/bias/phaseShift/dutyCycle attrs plus its own "st" (sliderText).
            return {
                dumpType: '172',
                tokens: [
                    numAttr(attrs, 'wf', 7),
                    numAttr(attrs, 'fr', 40),
                    numAttr(attrs, 'maxv', 5),
                    numAttr(attrs, 'bias', 0),
                    numAttr(attrs, 'phaseShift', 0),
                    numAttr(attrs, 'dutyCycle', 0.5),
                    escapeDumpText(strAttr(attrs, 'st', 'Voltage')),
                ],
            };
        case 'ln': // LabeledNodeElm.java: getXmlDumpType()=="ln"; dumpXml "te" (text).
            return { dumpType: '207', tokens: [escapeDumpText(strAttr(attrs, 'te', ''))] };
        case 'Scope': // ScopeElm.java: default getXmlDumpType; dumpXml delegates to
            // elmScope.dumpXml() for the nested scope config, which this
            // port's ScopeElm doesn't reconstruct from a dump line at all
            // (dumpTokens()==[] -- see scope.ts's class comment).
            return { dumpType: '403', tokens: [] };
        default:
            return null;
    }
}

export function parseXmlCircuit(engine: CircuitEngine, text: string): void {
    engine.clear();

    const lines = text.split('\n');
    let i = 0;

    // Root <cir ...> attributes (XMLSerializer.dumpCircuit() / XMLDeserializer.
    // readCircuit()): f (flags, UI-only -- not modelled), ts (maxTimeStep,
    // ALSO assigned to timeStep by Java: `sim.maxTimeStep = sim.timeStep =
    // ...`), ic (iterCount -- UI speed slider only), cb/pb (UI slider values
    // only), vr (CircuitElm.voltageRange), mts (minTimeStep), st (solverType,
    // not modelled by this engine).
    while (i < lines.length && !/<cir[\s>]/.test(lines[i])) i++;
    if (i < lines.length) {
        const rootAttrs = parseAttrs(lines[i]);
        if (rootAttrs.ts !== undefined) {
            const ts = parseFloat(rootAttrs.ts);
            if (!Number.isNaN(ts)) {
                engine.timeStep = ts;
                engine.maxTimeStep = ts;
            }
        }
        if (rootAttrs.mts !== undefined) {
            const mts = parseFloat(rootAttrs.mts);
            if (!Number.isNaN(mts)) engine.minTimeStep = mts;
        }
        if (rootAttrs.vr !== undefined) {
            const vr = parseFloat(rootAttrs.vr);
            if (!Number.isNaN(vr)) engine.voltageRange = vr;
        }
        i++;
    }

    let supported = 0;
    let preserved = 0;
    const unsupportedTags: Record<string, number> = {};

    const preserveLine = (raw: string) => {
        // First whitespace-delimited token must be the literal "%" so
        // CircuitParser's classic-line dispatch (`type === '%'`) recognizes
        // it on re-parse and re-preserves it (see parser.ts's parseOption())
        // instead of misreading it as a too-short/unrecognized element line
        // and silently dropping it.
        engine.preservedLines.push(`% xml ${raw}`);
        preserved++;
    };

    for (; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('</')) continue; // closing </cir> etc.

        const tagMatch = /^<([A-Za-z][-A-Za-z0-9_:.]*)/.exec(trimmed);
        if (!tagMatch) {
            preserveLine(trimmed);
            continue;
        }
        const tag = tagMatch[1];
        const closeRe = new RegExp(`</${tag}>`);
        const selfClosing = /\/>\s*$/.test(trimmed) && !closeRe.test(trimmed);

        if (!selfClosing) {
            // Multi-line (or single-line-with-explicit-close, e.g.
            // <scopedata ...>...</scopedata>) block this port doesn't model
            // (scope/adjustable/hint/test/model-registry elements). Preserve
            // every line verbatim, including the boundaries.
            const blockLines = [trimmed];
            if (!closeRe.test(trimmed)) {
                while (i + 1 < lines.length) {
                    i++;
                    const l = lines[i].trim();
                    blockLines.push(l);
                    if (closeRe.test(l)) break;
                }
            }
            for (const bl of blockLines) preserveLine(bl);
            unsupportedTags[tag] = (unsupportedTags[tag] ?? 0) + 1;
            continue;
        }

        const attrs = parseAttrs(trimmed);
        const xAttr = attrs.x;
        if (!xAttr) {
            // No position -- not a placeable circuit element (shouldn't
            // happen for a self-closing child of <cir> per XMLSerializer,
            // but degrade gracefully rather than crash).
            preserveLine(trimmed);
            unsupportedTags[tag] = (unsupportedTags[tag] ?? 0) + 1;
            continue;
        }
        const coords = xAttr.trim().split(/\s+/).map(Number);
        const [x1, y1, x2, y2] = coords;
        const flags = numAttr(attrs, 'f', 0);

        const rec = reconstruct(tag, attrs, flags);
        if (!rec) {
            preserveLine(trimmed);
            unsupportedTags[tag] = (unsupportedTags[tag] ?? 0) + 1;
            continue;
        }

        const elm = createElement(
            rec.dumpType, x1, y1, x2, y2, flags,
            rec.tokens.map((t) => String(t)),
        );
        if (elm) {
            engine.elmList.push(elm);
            supported++;
        } else {
            // Tag was recognized but the constructor rejected the
            // reconstructed tokens (same "half-parse is worse than no
            // parse" reasoning as CircuitParser's classic-line path) --
            // preserve the original XML line so the round-trip stays intact.
            preserveLine(trimmed);
            unsupportedTags[tag] = (unsupportedTags[tag] ?? 0) + 1;
        }
    }

    if (Object.keys(unsupportedTags).length > 0) {
        console.warn(
            `XML import: ${supported} element(s) loaded, ${preserved} line(s) preserved verbatim ` +
            `(unsupported tags: ${JSON.stringify(unsupportedTags)})`,
        );
    } else {
        console.warn(`XML import: ${supported} element(s) loaded, ${preserved} line(s) preserved verbatim`);
    }

    engine.setup();
}
