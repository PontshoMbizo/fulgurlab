import { describe, it, expect, vi } from "vitest";
import { createElement } from "@fulgurlab/engine/src/core/factory";
import { FIELD_SCHEMA, getFieldValue, setFieldValue, type FieldSchema } from "./schema";
import { PALETTE } from "../palette/palette";

// TODO.md P1-3: inspector/ had no tests. The schema is a hand-maintained map
// from dump id to editable fields, so the failure mode is a field whose `key`
// does not exist on the element it claims to edit -- the dialog then shows an
// empty box that silently writes a NEW property nobody reads. These tests bind
// the schema to the real element classes.

const allFields = (): [string, FieldSchema][] =>
    Object.entries(FIELD_SCHEMA).flatMap(([id, fields]) =>
        fields.map((f) => [id, f] as [string, FieldSchema]));

describe("inspector schema shape", () => {
    it("every field has a key, a label and a type", () => {
        for (const [id, f] of allFields()) {
            expect(f.key, `${id}: field with no key`).toBeTruthy();
            expect(f.label, `${id}.${f.key}: no label`).toBeTruthy();
            expect(["number", "text", "textarea", "select", "checkbox"])
                .toContain(f.type);
        }
    });

    it("every select field offers options, and no other type does", () => {
        for (const [id, f] of allFields()) {
            if (f.type === "select") {
                expect(f.options, `${id}.${f.key}: select with no options`).toBeTruthy();
                expect(f.options!.length).toBeGreaterThan(0);
                const values = f.options!.map((o) => o.value);
                expect(new Set(values).size, `${id}.${f.key}: duplicate option values`).toBe(values.length);
                for (const o of f.options!) expect(o.label).toBeTruthy();
            } else {
                expect(f.options, `${id}.${f.key}: non-select has options`).toBeUndefined();
            }
        }
    });

    it("min/max/step are coherent where present", () => {
        for (const [id, f] of allFields()) {
            if (f.min !== undefined && f.max !== undefined) {
                expect(f.min, `${id}.${f.key}: min >= max`).toBeLessThan(f.max);
            }
            if (f.step !== undefined) expect(f.step).toBeGreaterThan(0);
        }
    });

    it("no dump id repeats a field key", () => {
        for (const [id, fields] of Object.entries(FIELD_SCHEMA)) {
            const keys = fields.map((f) => f.key);
            expect(new Set(keys).size, `${id}: duplicate field keys`).toBe(keys.length);
        }
    });

    it("every schema entry names a dump id the factory knows", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const unknown: string[] = [];
        for (const id of Object.keys(FIELD_SCHEMA)) {
            // Use a palette entry's tokens when one exists, so elements with
            // required tokens (chips, composites) construct properly.
            const preset = PALETTE.find((p) => p.dumpType === id);
            const elm = createElement(id, 0, 0, 64, 0, preset?.flags ?? 0, preset?.tokens ?? []);
            if (!elm) unknown.push(id);
        }
        warn.mockRestore();
        error.mockRestore();
        expect(unknown).toEqual([]);
    });
});

describe("inspector schema matches the real element classes", () => {
    it("every field key resolves to an existing property on its element", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const missing: string[] = [];

        for (const [id, fields] of Object.entries(FIELD_SCHEMA)) {
            const preset = PALETTE.find((p) => p.dumpType === id);
            const elm = createElement(id, 0, 0, 64, 0, preset?.flags ?? 0, preset?.tokens ?? []);
            if (!elm) continue; // covered by the previous test
            for (const f of fields) {
                const v = getFieldValue(elm as unknown as object, f.key);
                if (v === undefined) missing.push(`${id}.${f.key}`);
            }
        }
        warn.mockRestore();
        error.mockRestore();
        expect(missing).toEqual([]);
    });

    it("a number field round-trips through set/getFieldValue", () => {
        const r = createElement("r", 0, 0, 64, 0, 0, ["1000"])! as unknown as object;
        setFieldValue(r, "resistance", 4700);
        expect(getFieldValue(r, "resistance")).toBe(4700);
    });

    it("a nested key (one level) reads and writes through", () => {
        // InductorElm keeps its value on an embedded Inductor -- "ind.inductance".
        const l = createElement("l", 0, 0, 64, 0, 0, ["0.01"])! as unknown as object;
        const nested = Object.entries(FIELD_SCHEMA["l"] ?? []).map(([, f]) => f.key)
            .find((k) => k.includes("."));
        if (!nested) return; // schema may address it directly; nothing to check
        setFieldValue(l, nested, 0.05);
        expect(getFieldValue(l, nested)).toBe(0.05);
    });

    it("getFieldValue on an unknown key is undefined, not a throw", () => {
        const r = createElement("r", 0, 0, 64, 0, 0, ["1000"])! as unknown as object;
        expect(getFieldValue(r, "definitelyNotAField")).toBeUndefined();
        expect(() => getFieldValue(r, "a.b.c")).not.toThrow();
    });

    it("select options for the voltage waveform match the engine's constants", () => {
        const fields = FIELD_SCHEMA["v"];
        expect(fields).toBeTruthy();
        const wf = fields.find((f) => f.key === "waveform")!;
        expect(wf.type).toBe("select");
        // VoltageElm.WF_DC..WF_NOISE are 0..6; the dialog must not offer a
        // value the engine's getVoltage() switch has no case for.
        const values = wf.options!.map((o) => Number(o.value));
        expect(Math.min(...values)).toBe(0);
        expect(Math.max(...values)).toBeLessThanOrEqual(7);
    });

    it("covers the elements a user is most likely to edit", () => {
        for (const id of ["r", "c", "l", "v", "R", "d", "t", "f", "a"]) {
            expect(FIELD_SCHEMA[id], `no inspector fields for dump type ${id}`).toBeTruthy();
        }
    });
});
