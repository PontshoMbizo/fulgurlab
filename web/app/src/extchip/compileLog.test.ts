import { describe, it, expect } from "vitest";
import { parseCompileLog, firstError } from "./compileLog";

// Shapes iverilog and arm-none-eabi-gcc actually emit. These are hand-written
// until a real container is available to record from -- the parser takes the
// log as a plain string precisely so it can be re-pinned to ground truth
// later without touching the caller.
const IVERILOG_LOG = [
    "top.v:5: syntax error",
    "top.v:7: error: unknown module type: fooo",
    "/work/top.v:12: warning: implicit definition of wire 'x'",
    "2 error(s) during elaboration.",
].join("\n");

describe("parseCompileLog", () => {
    it("maps user-source diagnostics 1:1 onto editor lines", () => {
        const p = parseCompileLog(IVERILOG_LOG, "top.v", 40);
        expect(p.diags).toEqual([
            { line: 5, severity: "error", message: "syntax error" },
            { line: 7, severity: "error", message: "unknown module type: fooo" },
            { line: 12, severity: "warning", message: "implicit definition of wire 'x'" },
        ]);
    });

    it("handles an absolute path prefix", () => {
        const p = parseCompileLog("/work/top.v:3: error: boom", "top.v", 40);
        expect(p.diags[0]).toEqual({ line: 3, severity: "error", message: "boom" });
    });

    it("treats a bare 'syntax error' with no severity keyword as an error", () => {
        const p = parseCompileLog("top.v:5: syntax error", "top.v", 40);
        expect(p.diags[0].severity).toBe("error");
    });

    it("treats 'sorry' and 'fatal error' as errors, not chatter", () => {
        const p = parseCompileLog(
            "top.v:2: sorry: constant selects unsupported\ntop.v:3: fatal error: nope", "top.v", 40);
        expect(p.diags.map((d) => d.severity)).toEqual(["error", "error"]);
    });

    // A marker on a line the user cannot see is worse than no marker: the
    // backend appends its generated harness AFTER the user's source, so
    // anything past the buffer's last line is not theirs.
    it("routes past-the-end diagnostics to harnessErrors, never to markers", () => {
        const p = parseCompileLog("top.v:5: error: mine\ntop.v:900: error: generated", "top.v", 40);
        expect(p.diags).toHaveLength(1);
        expect(p.diags[0].line).toBe(5);
        expect(p.harnessErrors).toEqual(["top.v:900: error: generated"]);
    });

    it("keeps non-diagnostic chatter separate", () => {
        const p = parseCompileLog(IVERILOG_LOG, "top.v", 40);
        expect(p.other).toEqual(["2 error(s) during elaboration."]);
    });

    it("parses gcc's column-bearing form for the MCU target", () => {
        const p = parseCompileLog("user.c:4:9: error: 'x' undeclared", "user.c", 20);
        expect(p.diags[0]).toEqual({ line: 4, severity: "error", message: "'x' undeclared" });
    });

    it("does not match a different compile unit", () => {
        const p = parseCompileLog("other.v:5: error: boom", "top.v", 40);
        expect(p.diags).toHaveLength(0);
        expect(p.other).toHaveLength(1);
    });

    it("survives empty and blank logs", () => {
        for (const log of ["", "   \n\n  "]) {
            const p = parseCompileLog(log, "top.v", 40);
            expect(p).toEqual({ diags: [], harnessErrors: [], other: [] });
        }
    });

    it("firstError skips warnings", () => {
        const p = parseCompileLog(
            "top.v:2: warning: meh\ntop.v:9: error: real", "top.v", 40);
        expect(firstError(p)?.line).toBe(9);
        expect(firstError(parseCompileLog("top.v:2: warning: meh", "top.v", 40))).toBeNull();
    });
});
