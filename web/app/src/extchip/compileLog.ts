// Turn a backend compile log into editor markers.
//
// Both reference backends compile the user's source FIRST and append their
// generated harness/glue after it (fpgasim: `makeSession(msg.source + h.text)`;
// mcusim: `msg.source + glue`), then write the result to a single file --
// /work/top.v or /work/user.c -- and compile that. So a diagnostic's line
// number maps 1:1 onto the editor's lines with NO offset, and anything past
// the user's last line belongs to generated code the user never wrote.
//
// That last part is why this returns three buckets rather than one list: a
// marker on a line the user cannot see is worse than no marker, so harness
// diagnostics go to the log panel instead of the gutter.

export interface CompileDiag {
    /** 1-based, as the compiler reports it. */
    line: number;
    severity: "error" | "warning";
    message: string;
}

export interface ParsedCompileLog {
    /** Diagnostics inside the user's own source -- safe to turn into markers. */
    diags: CompileDiag[];
    /** Diagnostics in the appended harness/glue. Show as text, never as markers. */
    harnessErrors: string[];
    /** Everything else: linker noise, container chatter, progress lines. */
    other: string[];
}

// Tolerant on purpose. iverilog emits all of:
//     top.v:5: syntax error
//     top.v:7: error: unknown module type: foo
//     /work/top.v:12: warning: implicit definition of wire 'x'
//     top.v:3: sorry: constant selects are not supported
// and gcc adds a column: user.c:4:9: error: 'x' undeclared
// Optional directory prefix, optional column, optional severity keyword.
function diagPattern(unitName: string): RegExp {
    const unit = unitName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^(?:.*[/\\\\])?${unit}:(\\d+)(?::\\d+)?:\\s*(?:(error|warning|sorry|fatal error)\\s*:\\s*)?(.*)$`);
}

/**
 * @param log        raw stderr tail from the backend (`error.log` / `ended.log`)
 * @param unitName   the file the backend compiles (target.compileUnitName)
 * @param userLineCount lines in the editor's buffer -- the boundary between
 *                   the user's source and the appended harness
 */
export function parseCompileLog(log: string, unitName: string, userLineCount: number): ParsedCompileLog {
    const re = diagPattern(unitName);
    const out: ParsedCompileLog = { diags: [], harnessErrors: [], other: [] };

    for (const raw of String(log ?? "").split("\n")) {
        const line = raw.trimEnd();
        if (!line.trim()) continue;

        const m = re.exec(line.trim());
        if (!m) {
            out.other.push(line);
            continue;
        }

        const lineNo = Number(m[1]);
        const keyword = (m[2] ?? "").toLowerCase();
        const message = (m[3] ?? "").trim() || line.trim();

        if (!Number.isFinite(lineNo) || lineNo < 1 || lineNo > userLineCount) {
            // Generated code. Keep the whole original line -- the raw text is
            // the only thing that makes it diagnosable at all.
            out.harnessErrors.push(line);
            continue;
        }

        out.diags.push({
            line: lineNo,
            // "sorry" (unsupported construct) and "fatal error" both stop the
            // build, so they are errors. A bare "top.v:5: syntax error" has no
            // keyword at all and is likewise fatal -- warnings always say so.
            severity: keyword === "warning" ? "warning" : "error",
            message,
        });
    }

    return out;
}

/** First error worth jumping the cursor to, if any. */
export function firstError(parsed: ParsedCompileLog): CompileDiag | null {
    return parsed.diags.find((d) => d.severity === "error") ?? null;
}
