export function lu_factor_dense(a: number[][], n: number, ipvt: Int32Array | number[]): boolean {
    let i: number, j: number, k: number;
    
    // check for a possible singular matrix by scanning for rows that are all zeroes
    for (i = 0; i !== n; i++) { 
        let row_all_zeros = true;
        for (j = 0; j !== n; j++) {
            if (a[i][j] !== 0) {
                row_all_zeros = false;
                break;
            }
        }
        // if all zeros, it's a singular matrix
        if (row_all_zeros) return false;
    }
    
    // use Crout's method; loop through the columns
    for (j = 0; j !== n; j++) {
        
        // calculate upper triangular elements for this column
        for (i = 0; i !== j; i++) {
            let q = a[i][j];
            for (k = 0; k !== i; k++) {
                q -= a[i][k] * a[k][j];
            }
            a[i][j] = q;
        }

        // calculate lower triangular elements for this column
        let largest = 0;
        let largestRow = -1;
        for (i = j; i !== n; i++) {
            let q = a[i][j];
            for (k = 0; k !== j; k++) {
                q -= a[i][k] * a[k][j];
            }
            a[i][j] = q;
            const x = Math.abs(q);
            if (x >= largest) {
                largest = x;
                largestRow = i;
            }
        }
        
        // pivoting
        if (j !== largestRow) {
            if (largestRow === -1) {
                return false;
            }
            let x: number;
            for (k = 0; k !== n; k++) {
                x = a[largestRow][k];
                a[largestRow][k] = a[j][k];
                a[j][k] = x;
            }
        }

        // keep track of row interchanges
        ipvt[j] = largestRow;

        if (a[j][j] === 0.0) {
            return false;
        }

        if (j !== n - 1) {
            const mult = 1.0 / a[j][j];
            for (i = j + 1; i !== n; i++) {
                a[i][j] *= mult;
            }
        }
    }
    return true;
}

export function lu_solve_dense(a: number[][], n: number, ipvt: Int32Array | number[], b: Float64Array | number[]): void {
    let i: number;

    // find first nonzero b element
    for (i = 0; i !== n; i++) {
        const row = ipvt[i];

        const swap = b[row];
        b[row] = b[i];
        b[i] = swap;
        if (swap !== 0) {
            break;
        }
    }
    
    const bi = i++;
    for (; i < n; i++) {
        const row = ipvt[i];
        let j: number;
        let tot = b[row];
        
        b[row] = b[i];
        // forward substitution using the lower triangular matrix
        for (j = bi; j < i; j++) {
            tot -= a[i][j] * b[j];
        }
        b[i] = tot;
    }
    for (i = n - 1; i >= 0; i--) {
        let tot = b[i];
        
        // back-substitution using the upper triangular matrix
        let j: number;
        for (j = i + 1; j !== n; j++) {
            tot -= a[i][j] * b[j];
        }
        b[i] = tot / a[i][i];
    }
}
