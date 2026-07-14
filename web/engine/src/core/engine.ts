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
    timeStepAccum: number = 0;
    
    circuitNonLinear: boolean = false;
    converged: boolean = true;
    subIterations: number = 0;

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

        for (const ce of this.elmList) {
            ce.startIteration();
        }

        const subiterCount = 5000;
        let subiter: number;
        for (subiter = 0; subiter < subiterCount; subiter++) {
            this.converged = true;
            this.subIterations = subiter;

            for (const m of this.matrices) {
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

            for (const m of this.matrices) {
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
            throw new Error("Convergence failed!");
        }

        this.t += this.timeStep;
        this.timeStepAccum += this.timeStep;
        if (this.timeStepAccum >= this.maxTimeStep) {
            this.timeStepAccum -= this.maxTimeStep;
        }

        for (const ce of this.elmList) {
            ce.stepFinished();
        }

        this.calcWireCurrents();

        for (const m of this.matrices) {
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
}
