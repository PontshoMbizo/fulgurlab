import { describe, it, expect } from 'vitest';
import { lu_factor_dense, lu_solve_dense } from '../src/core/lu';

describe('LU Solver', () => {
    it('should solve a simple 2x2 system', () => {
        // 2x + 3y = 8
        // 5x - y = 3
        // Solution: x = 1, y = 2
        
        const a = [
            [2, 3],
            [5, -1]
        ];
        const b = new Float64Array([8, 3]);
        const ipvt = new Int32Array(2);
        
        const success = lu_factor_dense(a, 2, ipvt);
        expect(success).toBe(true);
        
        lu_solve_dense(a, 2, ipvt, b);
        
        expect(b[0]).toBeCloseTo(1, 6);
        expect(b[1]).toBeCloseTo(2, 6);
    });

    it('should identify a singular matrix', () => {
        const a = [
            [1, 2],
            [2, 4]
        ];
        const ipvt = new Int32Array(2);
        
        const success = lu_factor_dense(a, 2, ipvt);
        expect(success).toBe(false);
    });

    it('should identify a matrix with a zero row as singular', () => {
        const a = [
            [0, 0],
            [1, 1]
        ];
        const ipvt = new Int32Array(2);
        
        const success = lu_factor_dense(a, 2, ipvt);
        expect(success).toBe(false);
    });
});
