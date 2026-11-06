// Runs a generated script in headless Scilab and collects the scope traces.
//
// Lessons from prototyping with Scilab 2024.0 (see docs/architecture.md):
// - stdin must be closed (`'ignore'`), or scilab-cli waits on the console forever.
// - after a fatal error Scilab can hang instead of exiting, so every run has a
//   hard timeout and the whole process group is killed.
// - stdout ends with exit code 255 even on success; success is read from the
//   status file the script writes.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, availableParallelism } from 'node:os';
import { join } from 'node:path';
import { generate } from './codegen.js';

export const config = {
  scilab: process.env.SCILAB_BIN || 'scilab-cli',
  timeoutMs: Number(process.env.SIM_TIMEOUT_MS || 20000),
  concurrency: Number(process.env.SIM_CONCURRENCY || Math.max(1, availableParallelism() - 1)),
  workRoot: process.env.SIM_WORKDIR || tmpdir(),
  keepWork: process.env.SIM_KEEP_WORK === '1',
};

// ---- tiny semaphore so a burst of requests can't fork-bomb the host
let active = 0;
const waiting = [];
async function acquire() {
  if (active < config.concurrency) { active++; return; }
  await new Promise((r) => waiting.push(r));
  active++;
}
function release() {
  active--;
  const next = waiting.shift();
  if (next) next();
}

export class SimulationError extends Error {
  constructor(message, log) { super(message); this.log = log; }
}

function runProcess(scriptPath, cwd) {
  return new Promise((resolve) => {
    const child = spawn(config.scilab, ['-nb', '-quit', '-f', scriptPath], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, HOME: cwd, SCIHOME: cwd, LANG: 'C', LC_ALL: 'C' },
    });
    let out = '';
    const take = (d) => { if (out.length < 200_000) out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, config.timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: String(err), timedOut, spawnError: err }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, timedOut }); });
  });
}

/** Strip ANSI codes and blank lines; keep the useful tail of Scilab's console. */
export function cleanLog(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).slice(-60).join('\n');
}

/** Turn Scilab's console noise into one readable sentence where we can. */
export function explain(log) {
  const l = log.toLowerCase();
  if (l.includes('algebraic loop')) return 'Algebraic loop: a feedback path has no integrator, delay or transfer function with dynamics in it.';
  if (l.includes('segmentation fault')) return 'Scilab crashed while building or simulating the diagram.';
  if (l.includes('singular')) return 'The solver hit a singular system.';
  return null;
}

function parseCsv(text, inputs) {
  const t = [];
  const y = Array.from({ length: inputs }, () => []);
  for (const line of text.split('\n')) {
    if (!line) continue;
    const cols = line.split(',');
    t.push(Number(cols[0]));
    for (let i = 0; i < inputs; i++) y[i].push(Number(cols[i + 1]));
  }
  return { t, y };
}

/**
 * Simulate a validated netlist.
 * @returns {Promise<{scopes:Record<string,{t:number[],y:number[][]}>, elapsedMs:number, log:string}>}
 */
export async function simulate(net) {
  await acquire();
  const dir = await mkdtemp(join(config.workRoot, 'fulgur-'));
  const started = Date.now();
  try {
    const { script, scopes } = generate(net, dir);
    const scriptPath = join(dir, 'model.sce');
    await writeFile(scriptPath, script);
    const res = await runProcess(scriptPath, dir);
    const log = cleanLog(res.out);
    if (res.spawnError) throw new SimulationError(`could not start Scilab (${config.scilab}): ${res.spawnError.message}`, log);
    if (res.timedOut) throw new SimulationError(`simulation timed out after ${config.timeoutMs / 1000} s`, log);

    let status = '';
    try { status = await readFile(join(dir, 'status'), 'utf8'); } catch { /* none written */ }
    const lines = status.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines[0] !== 'ok') {
      if (!lines.length) {
        // the script never got far enough to write a status: Scilab itself failed
        // to start or crashed, so the console output is the only clue
        const tail = log.split('\n').slice(-25).join('\n') || '(no output)';
        throw new SimulationError(`Scilab exited (code ${res.code}) without finishing the simulation.\n--- Scilab output ---\n${tail}`, log);
      }
      const msg = lines.slice(1).join(' ') || 'Scilab reported an error without a message';
      throw new SimulationError(explain(log) || explain(msg) || msg, log);
    }
    const out = {};
    for (const s of scopes) {
      out[s.block] = parseCsv(await readFile(s.file, 'utf8'), s.inputs);
    }
    return { scopes: out, elapsedMs: Date.now() - started, log };
  } finally {
    if (!config.keepWork) await rm(dir, { recursive: true, force: true });
    release();
  }
}
