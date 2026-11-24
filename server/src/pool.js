// Warm pool of Scilab workers. Starting Scilab and loading the Xcos libraries
// costs about 0.2 s per run; a worker pays that once, then executes each
// generated script with exec() over stdin and reports completion with a sentinel.
//
// Hygiene: `clear` before each job drops the previous run's variables, workers are
// retired after `maxJobs` runs, and a timeout or any odd exit discards the worker
// (Scilab can hang after a fatal error), so a bad run never poisons the next one.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const READY = '__FULGUR_READY__';
const DONE = '__FULGUR_DONE__';
const MAX_OUT = 200_000;

export class Pool {
  /** @param {{scilab:string, size:number, maxJobs?:number, startupMs?:number}} opts */
  constructor({ scilab, size, maxJobs = 50, startupMs = 30000 }) {
    this.scilab = scilab;
    this.size = size;
    this.maxJobs = maxJobs;
    this.startupMs = startupMs;
    this.idle = [];
    this.closed = false;
  }

  /** Start workers ahead of the first request. Failures are ignored; run() falls back. */
  warm(n = 1) {
    for (let i = 0; i < Math.min(n, this.size); i++) {
      this.#spawn().then((w) => this.#giveBack(w), () => {});
    }
  }

  async #spawn() {
    const home = await mkdtemp(join(tmpdir(), 'fulgur-worker-'));
    const child = spawn(this.scilab, ['-nb'], {
      cwd: home, stdio: ['pipe', 'pipe', 'pipe'], detached: true,
      env: { ...process.env, HOME: home, SCIHOME: home, LANG: 'C', LC_ALL: 'C' },
    });
    const w = { child, home, jobs: 0, buf: '', onData: null, dead: false };
    const take = (d) => {
      w.buf += d;
      if (w.buf.length > MAX_OUT * 2) w.buf = w.buf.slice(-MAX_OUT);
      w.onData?.();
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.stdin.on('error', () => {});
    // idle workers must not keep the host process alive
    child.unref();
    for (const s of [child.stdin, child.stdout, child.stderr]) s.unref?.();
    child.on('close', () => { w.dead = true; w.onData?.(); });
    child.on('error', () => { w.dead = true; w.onData?.(); });
    child.stdin.write(`funcprot(0); ieee(2); loadXcosLibs(); loadScicos(); printf("${READY}\\n");\n`);
    try {
      await this.#until(w, READY, this.startupMs);
    } catch (e) {
      this.#discard(w);
      throw e;
    }
    w.buf = '';
    return w;
  }

  /** Resolve when `marker` appears in the worker's output; reject on death or timeout. */
  #until(w, marker, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { w.onData = null; reject(new Error('timeout')); }, ms);
      const check = () => {
        const i = w.buf.indexOf(marker);
        if (i >= 0) { clearTimeout(timer); w.onData = null; resolve(i); }
        else if (w.dead) { clearTimeout(timer); w.onData = null; reject(new Error('worker exited')); }
      };
      w.onData = check;
      check();
    });
  }

  #discard(w) {
    w.dead = true;
    try { process.kill(-w.child.pid, 'SIGKILL'); } catch { /* already gone */ }
    rm(w.home, { recursive: true, force: true }).catch(() => {});
  }

  #giveBack(w) {
    if (this.closed || w.dead || w.jobs >= this.maxJobs || this.idle.length >= this.size) {
      this.#discard(w);
      // keep one warm worker available after retiring one
      if (!this.closed && this.idle.length === 0) this.warm(1);
      return;
    }
    this.idle.push(w);
  }

  /**
   * Execute a script file in a warm worker.
   * @returns {Promise<{code:number|null,out:string,timedOut:boolean}>} same shape as a one-shot run
   */
  async run(scriptPath, timeoutMs) {
    let w = this.idle.pop();
    if (!w) w = await this.#spawn(); // throws if Scilab cannot start; caller falls back
    w.buf = '';
    w.jobs++;
    const id = Math.random().toString(36).slice(2);
    const path = scriptPath.replace(/\\/g, '/').replace(/"/g, '""').replace(/'/g, "''");
    w.child.stdin.write(`clear; exec("${path}", -1); printf("${DONE}${id}\\n");\n`);
    try {
      const at = await this.#until(w, DONE + id, timeoutMs);
      const out = w.buf.slice(0, at);
      this.#giveBack(w);
      return { code: 0, out, timedOut: false };
    } catch (e) {
      const out = w.buf;
      const timedOut = e.message === 'timeout';
      this.#discard(w);
      if (!this.closed && this.idle.length === 0) this.warm(1);
      return { code: w.dead && !timedOut ? 255 : null, out, timedOut };
    }
  }

  close() {
    this.closed = true;
    for (const w of this.idle.splice(0)) this.#discard(w);
  }
}
