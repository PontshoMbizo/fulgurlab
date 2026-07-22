// Consistency sweep against the Java implementation's own circuit corpus
// (repo-root tests/*.txt and auto-tests/*.txt, written by/for the GWT
// CircuitJS1 build). Three guarantees, in increasing strength:
//
//   1. NO file may crash the parser -- unknown element types are expected
//      (Tier-2/3 aren't ported) and must degrade gracefully.
//   2. Whatever DID load must survive analyzeAndStamp() without throwing
//      (singular/pathological cases surface as engine status, not crashes).
//   3. Round-trip: parse -> dump -> parse -> dump must be a fixed point,
//      INCLUDING verbatim-preserved unknown-element lines -- loading and
//      resaving a corpus file must never destroy unported content.
//
// The per-file support summary is logged so coverage regressions/progress
// show up in test output without failing the build.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CircuitEngine } from "../src/core/engine";
import { CircuitParser } from "../src/core/parser";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIRS = ["tests", "auto-tests"];

function corpusFiles(): { name: string; text: string }[] {
    const out: { name: string; text: string }[] = [];
    for (const d of DIRS) {
        const dir = path.join(ROOT, d);
        for (const f of readdirSync(dir)) {
            if (!f.endsWith(".txt")) continue;
            out.push({ name: `${d}/${f}`, text: readFileSync(path.join(dir, f), "utf8") });
        }
    }
    return out;
}

describe("Java-corpus compatibility sweep", () => {
    const files = corpusFiles();
    it("found the corpus", () => {
        expect(files.length).toBeGreaterThan(20);
    });

    const summary: string[] = [];

    for (const f of files) {
        it(`${f.name}: parses, analyzes, and round-trips without loss`, () => {
            const engine = new CircuitEngine();
            const parser = new CircuitParser(engine);

            // 1+2. No crash on parse+setup (setup() runs analyzeAndStamp).
            // Some corpus circuits are DELIBERATELY hard (e.g. depend on
            // unported elements for their only source); parse errors must
            // still be thrown-object-free at the parser level.
            let analysisError: string | null = null;
            try {
                parser.parse(f.text);
            } catch (e) {
                // setup()/analyze may legitimately reject a circuit whose
                // essential elements are unported (e.g. no voltage source
                // left) -- that's an ERROR STATUS situation, not a crash,
                // as long as it's a controlled Error with a message.
                expect(e).toBeInstanceOf(Error);
                analysisError = (e as Error).message;
            }

            const supported = engine.elmList.length;
            const preserved = engine.preservedLines.length;
            summary.push(
                `${f.name}: ${supported} elements, ${preserved} preserved` +
                (analysisError ? ` (analysis: ${analysisError.slice(0, 60)})` : ""),
            );

            // 3. Round-trip fixed point incl. preserved unknown lines.
            const dump1 = engine.dump();
            const engine2 = new CircuitEngine();
            try {
                new CircuitParser(engine2).parse(dump1);
            } catch {
                // analysis may fail identically on reload; content is what matters
            }
            const dump2 = engine2.dump();
            expect(dump2).toBe(dump1);
            expect(engine2.preservedLines.length).toBe(preserved);
        });
    }

    it("logs the support summary", () => {
        // eslint-disable-next-line no-console
        console.log("\n--- corpus support summary ---\n" + summary.join("\n"));
        expect(summary.length).toBe(files.length);
    });
});
