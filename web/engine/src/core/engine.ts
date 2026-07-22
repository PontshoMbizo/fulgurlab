import { dumpCustomLogicModels } from '../elements/custom_logic';
import { CircuitElm, Stamper } from '../elements/base';
import { Analyzer, CircuitNode, CircuitMatrix, VoltageSource } from './node';
import { lu_factor_dense, lu_solve_dense } from './lu';

export class CircuitEngine implements Stamper {
    elmList: CircuitElm[] = [];
    matrices: CircuitMatrix[] | null = null;
    nodeList: CircuitNode[] = [];
    voltageSources: VoltageSource[] = [];
    
    t: number = 0;
    timeStep: number = 5e-6;
    maxTimeStep: number = 5e-6;
    // Java's SimulationManager default (see CircuitLoader.readOptions()'s
    // optional trailing token, and XMLDeserializer's "mts" root attr) --
    // overwritten by a `$` line's 7th token or an XML `<cir mts=...>` attr
    // when either is present, otherwise stays at this default.
    minTimeStep: number = 1e-11;
    // CircuitElm.voltageRange in the Java source (global, used for scope/
    // display scaling) -- overwritten by a `$` line's "voltageRange" token or
    // an XML `<cir vr=...>` attr.
    voltageRange: number = 5;
    timeStepAccum: number = 0;

    circuitNonLinear: boolean = false;
    converged: boolean = true;
    subIterations: number = 0;
    // Adaptive-timestep recovery tracking (Java SimulationManager parity):
    // counts consecutive easy-convergence steps while running BELOW
    // maxTimeStep; after enough of them the step doubles back toward the
    // user's chosen maxTimeStep. Only ever active after a halving, so
    // fixed-dt determinism (golden/corpus tests) is untouched on circuits
    // that never fail to converge.
    private goodIterations: number = 0;

    // Element-index hints from classic `o` scope lines (CircuitLoader.java:
    // `Scope sc = new Scope(...); sc.undump(st);` -- the first token
    // ScopeSerializer.undump() reads is the elmList[] index being probed).
    // This engine doesn't model Scope objects; CircuitParser just collects
    // the raw indices here for the app layer to turn into scope channels
    // after parse.
    scopeHints: number[] = [];

    // Element lines whose dump type this port doesn't implement yet,
    // preserved VERBATIM from parse to dump. Silently dropping them (the
    // previous behavior) meant loading+resaving a circuit that contains any
    // unported element DESTROYED that part of the user's file -- the Java
    // implementation never loses unknown content, and the rewrite plan's
    // format section (§7) requires the same. These lines don't stamp,
    // render, or simulate; they just survive the round-trip.
    preservedLines: string[] = [];

    // Reset to an empty circuit (used by CircuitParser before loading new text).
    clear() {
        this.elmList = [];
        this.nodeList = [];
        this.voltageSources = [];
        this.matrices = null;
        this.t = 0;
        this.maxTimeStep = this.timeStep = 5e-6;
        this.minTimeStep = 1e-11;
        this.voltageRange = 5;
        this.scopeHints = [];
        this.preservedLines = [];
    }

    // Serializes the whole circuit to this port's own extended text format:
    // a `$` options line followed by one element line per elmList entry via
    // CircuitElm.dump(). The `$` line now matches the shape Java's own
    // CircuitLoader.java readOptions()/dump writer produce -- flags,
    // maxTimeStep, speed, currentSpeed, voltageRange, powerRange -- using
    // this engine's real maxTimeStep/voltageRange (this is the save-side half
    // of audit issue #5: a circuit built only from elements this port
    // supports should be loadable, unmodified, by the Java build). flags/
    // speed/currentSpeed/powerRange are UI-only concepts in the Java source
    // this engine has no state for, so those four are fixed defaults
    // (dots-grid-on, Java's ~10 default sim speed, currentBar's default 50,
    // powerBar's default 50) rather than round-tripped values.
    dump(): string {
        const lines = [`$ 1 ${this.maxTimeStep} 10 50 ${this.voltageRange} 50`];
        // `!` model-definition lines for every custom-logic model referenced by
        // a placed 208 element, BEFORE the element lines (Java's own order --
        // and required for the output to be loadable by the Java build, which
        // resolves models eagerly at element construction).
        const clNames = this.elmList
            .filter((e) => String(e.getDumpType()) === '208')
            .map((e) => (e as unknown as { modelName: string }).modelName);
        lines.push(...dumpCustomLogicModels(clNames));
        for (const elm of this.elmList) {
            lines.push(elm.dump());
        }
        // Unported-element lines (and preserved `%`/`o`/`h`/... option lines)
        // ride along unchanged (see preservedLines).
        lines.push(...this.preservedLines);
        return lines.join('\n');
    }

    // Convenience wrapper used by CircuitParser after populating elmList.
    setup() {
        this.analyzeAndStamp();
    }

    analyzeAndStamp() {
        const analyzer = new Analyzer(this.elmList);
        const result = analyzer.analyze();
        
        this.nodeList = result.nodeList;
        this.matrices = result.matrices;
        this.voltageSources = result.voltageSources;
        this.circuitNonLinear = result.circuitNonLinear;
        this.elmList = result.elmList;
        
        // stampCircuit equivalent
        for (const m of this.matrices) {
            const sz = m.size;
            m.matrix = Array.from({ length: sz }, () => new Array(sz).fill(0));
            m.rightSide = new Float64Array(sz);
            m.origMatrix = Array.from({ length: sz }, () => new Array(sz).fill(0));
            m.origRightSide = new Float64Array(sz);
            m.permute = new Int32Array(sz);
            m.nodeVoltages = new Float64Array(m.nodeCount);
            if (!m.lastNodeVoltages || m.lastNodeVoltages.length !== m.nodeCount) {
                m.lastNodeVoltages = new Float64Array(m.nodeCount);
            }
            m.nonLinear = this.circuitNonLinear;
        }

        this.connectUnconnectedNodes(result.unconnectedNodes);

        for (const ce of this.elmList) {
            ce.stamp(this);
        }

        if (!this.matrices) return;

        for (const m of this.matrices) {
            const sz = m.size;
            for (let i = 0; i < sz; i++) {
                m.origRightSide[i] = m.rightSide[i];
            }
            for (let i = 0; i < sz; i++) {
                for (let j = 0; j < sz; j++) {
                    m.origMatrix[i][j] = m.matrix[i][j];
                }
            }
        }

        for (const m of this.matrices) {
            if (!m.nonLinear) {
                if (!lu_factor_dense(m.matrix, m.size, m.permute)) {
                    throw new Error("Singular matrix!");
                }
            }
        }
    }

    private connectUnconnectedNodes(unconnected: number[]) {
        for (const n of unconnected) {
            this.stampResistor(CircuitNode.ground, this.nodeList[n], 1e8);
        }
    }

    stepOnce() {
        if (!this.matrices || this.elmList.length === 0) return;

        // ADAPTIVE TIMESTEP (audit issue #4, Java parity): when the Newton
        // loop cannot converge at the current timeStep, halve it (down to
        // minTimeStep) and RETRY the step -- companion models (C/L) bake
        // timeStep into their stamps, so each retry re-stamps first. Java's
        // runCircuit does exactly this instead of erroring out; stiff
        // circuits (switching transients, relaxation oscillators at large
        // dt) survive here the same way now. Recovery: see end of method.
        const maxAttempts = 24; // maxTimeStep/minTimeStep spans < 2^24 in practice
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (this.runNewtonStep()) {
                this.finishStep();
                return;
            }
            // Non-convergence: shrink and retry, or give up at the floor.
            const floor = Math.max(this.minTimeStep, 1e-12);
            if (this.timeStep <= floor * 1.0001) break;
            this.timeStep = Math.max(this.timeStep / 2, floor);
            this.goodIterations = 0;
            this.analyzeAndStamp();
        }
        throw new Error("Convergence failed!");
    }

    // One full Newton-iterated solve at the CURRENT timeStep. Returns false
    // on non-convergence (caller decides whether to shrink dt and retry).
    private runNewtonStep(): boolean {
        const matrices = this.matrices;
        if (!matrices) return true; // guarded by stepOnce; keeps TS narrowing happy
        for (const ce of this.elmList) {
            ce.startIteration(this);
        }

        const subiterCount = 5000;
        let subiter: number;
        for (subiter = 0; subiter < subiterCount; subiter++) {
            this.converged = true;
            this.subIterations = subiter;

            for (const m of matrices) {
                for (let i = 0; i < m.size; i++) {
                    m.rightSide[i] = m.origRightSide[i];
                }
                if (m.nonLinear) {
                    for (let i = 0; i < m.size; i++) {
                        for (let j = 0; j < m.size; j++) {
                            m.matrix[i][j] = m.origMatrix[i][j];
                        }
                    }
                }
            }

            for (const ce of this.elmList) {
                ce.doStep(this);
            }

            for (const m of matrices) {
                if (m.nonLinear) {
                    if (this.converged && subiter > 0) continue;
                    if (!lu_factor_dense(m.matrix, m.size, m.permute)) {
                        throw new Error("Singular matrix!");
                    }
                }
                lu_solve_dense(m.matrix, m.size, m.permute, m.rightSide);
                this.applySolvedRightSide(m);
            }

            if (!this.circuitNonLinear) break;
            if (this.converged && subiter > 0) break;
        }

        if (subiter === subiterCount) {
            return false; // caller may halve timeStep and retry (adaptive)
        }
        this.lastSubiter = subiter;
        return true;
    }

    private lastSubiter = 0;

    private finishStep() {
        const subiter = this.lastSubiter;
        // Recovery half of the adaptive scheme: while running below the
        // user's maxTimeStep (i.e. only ever after a halving), a run of
        // easy-convergence steps doubles dt back up, exactly Java's shape.
        if (this.timeStep < this.maxTimeStep) {
            this.goodIterations = subiter < 5 ? this.goodIterations + 1 : 0;
            if (this.goodIterations >= 100) {
                this.timeStep = Math.min(this.timeStep * 2, this.maxTimeStep);
                this.goodIterations = 0;
                this.analyzeAndStamp();
            }
        }

        this.t += this.timeStep;
        this.timeStepAccum += this.timeStep;
        if (this.timeStepAccum >= this.maxTimeStep) {
            this.timeStepAccum -= this.maxTimeStep;
        }

        for (const ce of this.elmList) {
            ce.stepFinished(this);
        }

        this.calcWireCurrents();

        for (const m of this.matrices ?? []) {
            for (let i = 0; i < m.nodeCount; i++) {
                m.lastNodeVoltages[i] = m.nodeVoltages[i];
            }
        }
    }

    private applySolvedRightSide(m: CircuitMatrix) {
        for (let i = 0; i < m.nodeCount; i++) {
            m.nodeVoltages[i] = m.rightSide[i];
        }
        for (const cn of m.nodeList) {
            for (const cnl of cn.links) {
                cnl.elm.setNodeVoltage(cnl.num, cn.row > 0 ? m.nodeVoltages[cn.row - 1] : 0);
            }
        }
        // BUGFIX: a voltage source's own branch current is itself one of the
        // solved unknowns (row = nodeCount + index in the same combined
        // vector `rightSide` holds after lu_solve_dense), but nothing read
        // it back out before now -- see the VoltageSource.current field
        // comment in node.ts. Byte-faithful port of Java's own
        // applySolvedRightSide() (SimulationManager.java:1498-1504): store
        // the raw solved value on the VoltageSource itself (used directly by
        // elements that own more than one VS and need to tell them apart,
        // e.g. CCVSElm reading its own controlVS.current), AND dispatch to
        // vs.elm.setCurrent(vs, res) -- the general, per-element mechanism
        // real elements use to decide what "their own" current means
        // (usually just `current = c`, the CircuitElm.java:255 default, but
        // multi-VS elements override it to pick the right one).
        for (const vs of m.voltageSourceList) {
            if (vs.row > 0) {
                const res = m.rightSide[vs.row - 1];
                vs.current = res;
                vs.elm?.setCurrent(vs, res);
            }
        }
    }

    private calcWireCurrents() {
        for (const ce of this.elmList) {
            ce.calculateCurrent();
        }
    }

    // --- Stamper API Implementation ---
    
    stampResistor(n1: CircuitNode, n2: CircuitNode, r: number) {
        const r0 = 1 / r;
        this.stampMatrix(n1, n1, r0);
        this.stampMatrix(n2, n2, r0);
        this.stampMatrix(n1, n2, -r0);
        this.stampMatrix(n2, n1, -r0);
    }

    stampConductance(n1: CircuitNode, n2: CircuitNode, r0: number) {
        this.stampMatrix(n1, n1, r0);
        this.stampMatrix(n2, n2, r0);
        this.stampMatrix(n1, n2, -r0);
        this.stampMatrix(n2, n1, -r0);
    }

    stampVoltageSource(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, v?: number) {
        this.stampMatrixVSNode(vs, n1, -1);
        this.stampMatrixVSNode(vs, n2, 1);
        this.stampMatrixNodeVS(n1, vs, 1);
        this.stampMatrixNodeVS(n2, vs, -1);
        if (v !== undefined) {
            this.stampRightSideVS(vs, v);
        }
    }

    updateVoltageSource(n1: CircuitNode, n2: CircuitNode, vs: VoltageSource, v: number) {
        this.stampRightSideVS(vs, v);
    }

    stampCurrentSource(n1: CircuitNode, n2: CircuitNode, i: number) {
        this.stampRightSide(n1, -i);
        this.stampRightSide(n2, i);
    }

    stampMatrix(i: CircuitNode, j: CircuitNode, x: number) {
        if (i.row > 0 && j.row > 0) {
            const m = (i !== CircuitNode.ground) ? i.matrix! : j.matrix!;
            m.matrix[i.row - 1][j.row - 1] += x;
        }
    }

    stampMatrixVSNode(i: VoltageSource, j: CircuitNode, x: number) {
        if (j.row > 0) {
            i.matrix!.matrix[i.row - 1][j.row - 1] += x;
        }
    }

    stampMatrixNodeVS(i: CircuitNode, j: VoltageSource, x: number) {
        if (i.row > 0) {
            j.matrix!.matrix[i.row - 1][j.row - 1] += x;
        }
    }

    stampMatrixVSVS(i: VoltageSource, j: VoltageSource, x: number) {
        i.matrix!.matrix[i.row - 1][j.row - 1] += x;
    }

    stampRightSide(n: CircuitNode, x: number) {
        if (n.row > 0) {
            n.matrix!.rightSide[n.row - 1] += x;
        }
    }

    stampRightSideVS(vs: VoltageSource, x: number) {
        vs.matrix!.rightSide[vs.row - 1] += x;
    }

    // No-op: see the Stamper interface doc comment in elements/base.ts. Java's
    // SimulationManager.stampNonLinear() marks a node's row as needing full
    // re-stamping; this engine currently re-stamps the whole matrix for any
    // partition containing a nonlinear element (m.nonLinear), so the per-node
    // marking has no effect yet. Elements still call it for parity with the Java
    // source (port faithfully first).
    stampNonLinear(n: CircuitNode) {}
}
