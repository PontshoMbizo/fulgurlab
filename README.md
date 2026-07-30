# fulgurlab

<p align="center">
  <img src="web/app/public/icons/icon128.png" alt="fulgurlab logo" width="128" height="128">
  <br>
  <em>Unified electronics lab in the browser</em>
</p>

**fulgurlab** is a browser circuit simulator: a TypeScript port of the CircuitJS1
analog/digital engine, plus two co-simulated hardware extensions wired in over a
lockstep WebSocket bridge ([docs/bridge-protocol.md](docs/bridge-protocol.md)):

- **[fpgasim](https://github.com/PontshoMbizo/fpgasim)** — Tang Nano 9K FPGA: Verilog
  compiled and stepped by iverilog/vvp in a hardened sandbox (bridge on `:3100`)
- **[mcusim](https://github.com/PontshoMbizo/mcusim)** — STM32F103 Blue Pill: bare-metal
  C under QEMU with semihosting-driven quantum exchange (bridge on `:3101`)

Place an **FPGA — Tang Nano 9K (fpgasim)** chip from the palette, give it a bridge URL,
pin spec and source; its pins become live circuit nodes advanced in lockstep with the
external simulator. Placing it renders the actual Tang Nano 9K board photo (pins in the
same two header rows as the real part), and its default Verilog + pin spec match
fpgasim's own standalone demo (`clk`/`btn1`/`btn2`/`leds[5:0]`) so the two feel like the
same board.

## 100% TypeScript / JavaScript

This repository contains **no Java and no JVM build**. It began as a fork of the
GWT/Java CircuitJS1 and kept that engine as an oracle while the TypeScript port was
written against it; the port now covers every element type the Java source could
serialize, and the Java tree, its Gradle build, the GWT host page and the Electron
wrapper have all been removed.

Numerical parity with the original is still enforced, without needing anything Java:
`web/engine/test/golden/fixtures` holds traces **recorded from the real GWT build**, and
the test suite replays them against the TypeScript engine every run
(12 circuits / 26 probes / 7,300 compared values). To re-record or extend them, point
the recorder at any compiled circuitjs1 site:

```bash
node tools/golden-recorder/record.mjs --site /path/to/circuitjs1/site
```

## Layout

```
web/engine/      headless simulation core (TypeScript, no DOM)
web/app/         Next.js canvas app
tests/           circuit corpus inherited from circuitjs1, used by the engine's
auto-tests/        compatibility sweep (every file must parse, analyze and round-trip)
tools/golden-recorder/   records golden traces from a compiled circuitjs1 oracle
integration-tests/       cross-repo bridge tests + transcript recorder
docs/            bridge protocol, rewrite plan
INTERNALS.md     how the solver works (MNA, stamping, the element contract)
```

## Quick start

```bash
npm --prefix web install   # installs both workspaces

npm run dev                # canvas app at http://localhost:3000
npm test                   # engine + app suites (333 tests)
npm run typecheck          # tsc --noEmit for both workspaces
npm run build              # production build
```

Every script also works from inside a workspace (`npm --prefix web/engine run test`).

### Test suites

| Command | What it covers |
|---|---|
| `npm run test:engine` | element/solver units, dump round-trips, the **golden-trace gate** vs the recorded Java oracle, the Java-corpus sweep (37 files, 0 unsupported dump ids), and a coverage gate asserting every Java dump id is implemented |
| `npm run test:app` | store (undo/redo, import/export, selection, transactions), canvas geometry, inspector schema, scope persistence, palette parity, and the **bridge integration suite** (replays recorded backend transcripts — never skips) |
| `npm run test:integration` | the real cross-repo chain against live fpgasim/mcusim from sibling checkouts; skips when their toolchains are absent |

### Deploying

`next build` prerenders the app as static content, so there is no server requirement:

```bash
NEXT_OUTPUT_EXPORT=1 npm run build   # emits web/app/out/, servable by any static host
```

The GitHub Pages workflow does exactly this.

---

## Credits

The simulation engine is a port of **CircuitJS1**, originally written by Paul Falstad as
a Java applet and adapted by Iain Sharp to run in the browser with GWT.

* Paul's page: [http://www.falstad.com/circuit/](http://www.falstad.com/circuit/)
* Iain's page: [http://lushprojects.com/circuitjs/](http://lushprojects.com/circuitjs/)

Thanks to: Edward Calver for 15 new components and other improvements; Rodrigo Hausen
for file import/export and many other UI improvements; J. Mike Rollins for the Zener
diode code; Julius Schmidt for the spark gap code and some examples; Dustin Soodak for
help with the user interface improvements; Jacob Calvert for the T Flip Flop; Ben Hayden
for scope spectrum; Thomas Reitinger, Krystian Sławiński, Usevalad Khatkevich, Lucio
Sciamanna, Mauro Hemerly Gazzani, J. Miguel Silva, and Franck Viard for translations;
Andre Adrian for improved emitter coupled oscillator; Felthry for many examples; Colin
Howell for code improvements. LZString (c) 2013 pieroxy.

## License

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
