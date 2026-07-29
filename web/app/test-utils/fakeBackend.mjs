// RECORDED-TRANSCRIPT FAKE BACKEND (TODO.md P1-5)
//
// All three bridge integration tests used to skip without live fpgasim/mcusim
// containers, so the client's protocol logic -- handshake, session creation,
// quantum pacing, the skew guard, reset, ended, error -- was never exercised in
// CI at all. This module replays a RECORDED transcript of a real backend session
// over a real WebSocket, so those paths run everywhere.
//
// A transcript is deliberately dumb: an ordered list of the frames the backend
// sent, each tagged with the client frame type that triggered it. Replay is
// therefore a lookup, not a simulation -- the fake has no model of the DUT, it
// only knows "the 4th `step` got these outputs". That is the point: the thing
// under test is the CLIENT, and a fake with its own logic would just be a second
// implementation to keep in sync.
//
// Transcripts are recorded by integration-tests/bridge.integration.test.mjs when
// a real backend IS available (RECORD_TRANSCRIPTS=1), so they can be refreshed
// from ground truth rather than hand-maintained.
//
// Shape:
//   {
//     "backend": "fpgasim",
//     "note": "...",
//     "frames": [
//       { "on": "hello",   "send": { "type": "welcome", ... } },
//       { "on": "create",  "send": { "type": "created", ... } },
//       { "on": "step",    "send": { "type": "stepped", ... } },   // in order
//       { "on": "reset",   "send": { "type": "reset_done", ... } },
//       { "on": "dispose", "send": { "type": "disposed", ... } }
//     ]
//   }
//
// Per-type frames are consumed IN ORDER; when a type runs out of frames the last
// one is repeated (so a 400-step test does not need a 400-entry transcript).
// `send: null` means "receive this and stay silent" -- used to reproduce a
// backend that stops answering, which is how the skew guard gets tested.

import { startMiniWs } from "./miniws.mjs";

// Substitutes {{session}} and {{t_ns}} so a recorded frame can be replayed
// against whatever session id / clock the client actually uses.
function materialize(template, ctx) {
    if (template === null || template === undefined) return template;
    const json = JSON.stringify(template).replace(/"\{\{(\w+)\}\}"/g, (m, key) =>
        key in ctx ? JSON.stringify(ctx[key]) : m);
    return JSON.parse(json);
}

/**
 * Starts a WebSocket server that replays `transcript`.
 * Resolves to miniws's handle ({url, close}) plus a `received` array of every
 * client frame, so a test can assert on what the client sent (e.g. that `reset`
 * was emitted). Async because miniws binds an ephemeral port.
 */
export async function startFakeBackend(transcript, opts = {}) {
    const received = [];
    const byType = new Map();
    for (const f of transcript.frames ?? []) {
        if (!byType.has(f.on)) byType.set(f.on, []);
        byType.get(f.on).push(f);
    }
    const cursor = new Map();

    const server = await startMiniWs((conn) => {
        // Session id the fake hands out; the client must echo it back on every
        // subsequent frame, which is itself worth checking.
        const session = opts.session ?? transcript.session ?? "s-fake";
        conn.onmessage = (text) => {
            let msg;
            try { msg = JSON.parse(text); } catch { return; }
            received.push(msg);

            const list = byType.get(msg.type);
            if (!list || list.length === 0) return;
            const i = cursor.get(msg.type) ?? 0;
            const frame = list[Math.min(i, list.length - 1)];
            cursor.set(msg.type, i + 1);

            if (opts.onFrame && opts.onFrame(msg, frame, received) === false) return;
            if (frame.send === null || frame.send === undefined) return;

            const out = materialize(frame.send, {
                session,
                // A recorded `stepped` carries the backend's own clock; when the
                // transcript templates it, mirror the client's t_ns so pacing
                // arithmetic stays consistent for step counts beyond the
                // recorded window.
                t_ns: msg.t_ns ?? 0,
            });
            conn.send(JSON.stringify(out));
        };
    });

    return { ...server, received, transcript };
}

/** Frames the client sent, filtered by type -- convenience for assertions. */
export function sentOfType(received, type) {
    return received.filter((m) => m.type === type);
}
