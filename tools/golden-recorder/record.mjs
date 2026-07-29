// GOLDEN-TRACE RECORDER
//
// Drives the real GWT-compiled CircuitJS1 oracle in headless Chrome and records
// node-voltage traces that web/engine/test/golden.test.ts replays against the
// TypeScript engine. This is the only defence against silent numerical
// divergence between the two (see TODO.md P0-1 for what that looks like when it
// goes unnoticed).
//
// The oracle is a BUILD ARTEFACT, not part of this repository: fulgurlab is
// pure TS/JS and no longer carries the Java/GWT source. Point this script at a
// directory containing a compiled circuitjs1 site (upstream's published build,
// or your own `gradlew makeSite` output from circuitjs1 proper):
//
//   node record.mjs --site /path/to/circuitjs1/site
//   node record.mjs --site ../../site --only rc-lowpass,opamp-follower
//
// Recorded fixtures are committed, so a checkout can run the gate without the
// oracle present. Re-record only when you deliberately want to move the
// reference.
//
// FIXTURE FORMAT (input, tools/golden-recorder/fixtures/<name>.circuit.txt):
//   #probe <spec> [<spec> ...]     -- what to trace; two forms:
//        node:<label>   voltage at a LabeledNodeElm ("207") named <label>
//        elm:<i>:<p>    voltage at post <p> of the <i>'th element line
//                       (0-based, in dump order). Index-based probes need no
//                       coordinate arithmetic to place, so they are the safer
//                       way to author a new fixture; both engines build their
//                       element list in dump order.
//   #warmup <n>                    -- ignored: the recorder MEASURES the
//                                    oracle's elapsed steps (see main()) and
//                                    writes that as warmupSteps
//   #steps <n>                     -- samples to record (default 200)
//   #rtol <x> / #atol <x>          -- comparison tolerances
//   #note <free text>              -- carried into the output for readers
//   <the circuit text, one element per line>
//
// OUTPUT FORMAT (web/engine/test/golden/fixtures/<name>.json):
//   { name, dt, warmupSteps, steps, sampling: "after-step", rtol, atol,
//     note?, circuit, probes: { <label>: number[] },
//     probe?, trace? }               <- probe/trace mirror the FIRST label so
//                                       single-probe fixtures recorded before
//                                       multi-probe support still validate.

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUT_DIR = path.join(__dirname, '../../web/engine/test/golden/fixtures');

function parseArgs(argv) {
    const args = { site: null, only: null, port: 8731 };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--site') args.site = argv[++i];
        else if (argv[i] === '--only') args.only = argv[++i].split(',').map(s => s.trim());
        else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10);
    }
    return args;
}

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.xml': 'application/xml', '.ico': 'image/x-icon',
};

// Minimal static server: no dependency on python3 or an external http.server,
// and it refuses to serve outside `root`.
function serve(root, port) {
    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        const resolved = path.resolve(root, '.' + urlPath);
        if (!resolved.startsWith(path.resolve(root))) {
            res.writeHead(403).end('forbidden');
            return;
        }
        fs.readFile(resolved, (err, data) => {
            if (err) {
                res.writeHead(404).end('not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream' });
            res.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

function parseFixture(name, text) {
    const meta = { probes: [], warmup: 5, steps: 200, rtol: 1e-5, atol: 1e-7, note: null, allowZero: [] };
    const circuitLines = [];
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (t.startsWith('#probe')) meta.probes = t.replace('#probe', '').trim().split(/\s+/).filter(Boolean);
        else if (t.startsWith('#warmup')) meta.warmup = parseInt(t.split(/\s+/)[1], 10);
        else if (t.startsWith('#steps')) meta.steps = parseInt(t.split(/\s+/)[1], 10);
        else if (t.startsWith('#rtol')) meta.rtol = parseFloat(t.split(/\s+/)[1]);
        else if (t.startsWith('#atol')) meta.atol = parseFloat(t.split(/\s+/)[1]);
        else if (t.startsWith('#note')) meta.note = t.replace('#note', '').trim();
        else if (t.startsWith('#allow-zero')) meta.allowZero.push(...t.replace('#allow-zero', '').trim().split(/\s+/).filter(Boolean));
        else if (t.startsWith('#')) continue; // plain comment
        else if (t.length > 0) circuitLines.push(line);
    }
    if (meta.probes.length === 0) throw new Error(`${name}: no #probe header`);
    return { meta, circuit: circuitLines.join('\n') };
}

async function main() {
    const args = parseArgs(process.argv);
    if (!args.site) {
        console.error('error: --site <dir> is required (a compiled circuitjs1 site containing circuitjs.html).');
        console.error('       fulgurlab no longer contains the Java/GWT oracle; see this file\'s header.');
        process.exit(2);
    }
    const siteRoot = path.resolve(args.site);
    if (!fs.existsSync(path.join(siteRoot, 'circuitjs.html'))) {
        console.error(`error: ${siteRoot}/circuitjs.html not found -- is that a built site?`);
        process.exit(2);
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const server = await serve(siteRoot, args.port);
    console.log(`serving ${siteRoot} on http://127.0.0.1:${args.port}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    let recorded = 0;
    try {
        const page = await browser.newPage();
        page.on('pageerror', (e) => console.warn('  [page error]', e.message));
        await page.goto(`http://127.0.0.1:${args.port}/circuitjs.html`, { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForFunction('window.CircuitJS1 !== undefined', { timeout: 60000 });
        await new Promise(r => setTimeout(r, 1500)); // let the GWT app finish booting

        let names = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.circuit.txt'));
        if (args.only) names = names.filter(f => args.only.includes(f.replace('.circuit.txt', '')));

        for (const file of names) {
            const name = file.replace('.circuit.txt', '');
            const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8');
            const { meta, circuit } = parseFixture(name, raw);
            process.stdout.write(`recording ${name} (${meta.probes.length} probe(s), ${meta.steps} steps) ... `);

            // PROTOCOL. The oracle analyzes a circuit inside its animation
            // frame loop, not inside importCircuit() -- until a frame has run,
            // every node voltage reads back 0.0, and the analysis does NOT
            // happen while the sim is stopped. So the circuit has to run for a
            // moment, which advances t by some number of whole dt steps.
            //
            // We MEASURE that number (t/dt) and record it as warmupSteps: the
            // oracle's state is then exactly "N steps from a cold start", which
            // the TS engine reproduces by stepping N times after parsing. No
            // reset() is involved -- reset() only sets analyzeFlag (re-analysis
            // is deferred to a frame that stepSim() never runs) and can enable
            // dcAnalysisFlag via autoDCOnReset, so what it leaves behind is not
            // a cold start.
            //
            // Everything below happens in ONE page.evaluate() on purpose.
            // Splitting the "stop and measure t" part from the "step and
            // sample" part lets animation frames run in between, which silently
            // advances the oracle past the t we just measured -- that mistake
            // produced traces offset by ~15 steps while looking perfectly
            // well-formed.
            const rec = await page.evaluate(async (text, probeList, steps) => {
                window.CircuitJS1.importCircuit(text, false);
                window.CircuitJS1.setSimRunning(true);
                // Poll rather than sleep a fixed time, so the measured warmup
                // stays as small (and as reproducible) as possible.
                for (let i = 0; i < 400; i++) {
                    await new Promise(r => setTimeout(r, 5));
                    if (window.CircuitJS1.getTime() > 0) break;
                }
                window.CircuitJS1.setSimRunning(false);

                // --- no awaits from here to the end: no frame can interleave.
                const dt = window.CircuitJS1.getTimeStep();
                const t0 = window.CircuitJS1.getTime();
                const valid = window.CircuitJS1.isCircuitValid();
                const errors = window.CircuitJS1.getSimulationErrors();

                const elms = window.CircuitJS1.getElements();
                const read = (spec) => {
                    if (spec.startsWith('elm:')) {
                        const [, i, post] = spec.split(':');
                        return elms[parseInt(i, 10)].getVoltage(parseInt(post, 10));
                    }
                    return window.CircuitJS1.getNodeVoltage(spec.replace(/^node:/, ''));
                };

                const out = {};
                for (const p of probeList) out[p] = [];
                for (let i = 0; i < steps; i++) {
                    // "after-step" sampling: advance first, then read.
                    window.CircuitJS1.stepSim(1);
                    for (const p of probeList) out[p].push(read(p));
                }
                return { dt, t0, valid, errors, probes: out, tEnd: window.CircuitJS1.getTime() };
            }, circuit, meta.probes, meta.steps);

            const dt = rec.dt;
            const probes = rec.probes;
            if (!rec.valid || (rec.errors && String(rec.errors).length > 0)) {
                console.log(`FAILED (oracle rejected the circuit: ${rec.errors ?? 'invalid'})`);
                continue;
            }
            const elapsed = rec.t0 / dt;
            const warmup = Math.round(elapsed);
            if (Math.abs(elapsed - warmup) > 1e-6 || warmup < 1) {
                console.log(`FAILED (warmup time ${rec.t0} is not a whole number of dt=${dt} steps: ${elapsed})`);
                continue;
            }
            // The step count must be exactly warmup + steps, or frames leaked in.
            const expectedEnd = (warmup + meta.steps) * dt;
            if (Math.abs(rec.tEnd - expectedEnd) > dt * 1e-6) {
                console.log(`FAILED (ended at t=${rec.tEnd}, expected ${expectedEnd} -- extra steps leaked into the run)`);
                continue;
            }

            const bad = Object.entries(probes).filter(([, vals]) =>
                vals.length !== meta.steps || vals.some(v => typeof v !== 'number' || !Number.isFinite(v)));
            if (bad.length > 0) {
                console.log(`FAILED (probe(s) ${bad.map(([k]) => k).join(', ')} returned non-finite values -- is the label/index right?)`);
                continue;
            }
            // A probe that is identically zero for the whole window is almost
            // always a MISPLACED probe (an unknown label reads back 0.0), not a
            // real result -- catching that here is the difference between a
            // meaningful gate and one that trivially passes. Opt out with
            // "#allow-zero <spec>" when a zero trace is genuinely the point.
            const flat = Object.entries(probes).filter(([k, vals]) =>
                !meta.allowZero.includes(k) && vals.every(v => v === 0));
            if (flat.length > 0) {
                console.log(`FAILED (probe(s) ${flat.map(([k]) => k).join(', ')} read 0 at every sample -- misplaced probe? add "#allow-zero <spec>" if intended)`);
                continue;
            }

            const first = meta.probes[0];
            const out = {
                name,
                dt,
                warmupSteps: warmup,
                steps: meta.steps,
                sampling: 'after-step',
                rtol: meta.rtol,
                atol: meta.atol,
                ...(meta.note ? { note: meta.note } : {}),
                circuit,
                probes,
                // Back-compat mirror of the first probe (see header).
                probe: first,
                trace: probes[first],
            };
            fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(out));
            recorded++;
            console.log('ok');
        }
    } finally {
        await browser.close();
        server.close();
    }
    console.log(`\nrecorded ${recorded} fixture(s) into ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
