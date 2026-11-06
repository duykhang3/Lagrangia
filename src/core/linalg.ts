// Small dense linear-algebra toolkit (row-major storage).

export class Mat {
  r: number;
  c: number;
  d: Float64Array;
  constructor(r: number, c: number, d?: Float64Array | number[]) {
    this.r = r;
    this.c = c;
    this.d = d ? (d instanceof Float64Array ? d : Float64Array.from(d)) : new Float64Array(r * c);
  }
  get(i: number, j: number) {
    return this.d[i * this.c + j];
  }
  set(i: number, j: number, v: number) {
    this.d[i * this.c + j] = v;
  }
  clone() {
    return new Mat(this.r, this.c, new Float64Array(this.d));
  }
  get numel() {
    return this.r * this.c;
  }
  static zeros(r: number, c: number) {
    return new Mat(r, c);
  }
  static eye(n: number) {
    const m = new Mat(n, n);
    for (let i = 0; i < n; i++) m.d[i * n + i] = 1;
    return m;
  }
  static fromRows(rows: number[][]) {
    const r = rows.length;
    const c = r ? rows[0].length : 0;
    const m = new Mat(r, c);
    for (let i = 0; i < r; i++) {
      if (rows[i].length !== c) throw new Error('Inconsistent row lengths');
      for (let j = 0; j < c; j++) m.d[i * c + j] = rows[i][j];
    }
    return m;
  }
  static col(v: ArrayLike<number>) {
    return new Mat(v.length, 1, Float64Array.from(v as ArrayLike<number>));
  }
  static diag(v: ArrayLike<number>) {
    const n = v.length;
    const m = new Mat(n, n);
    for (let i = 0; i < n; i++) m.d[i * n + i] = v[i];
    return m;
  }
  toRows(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.r; i++) out.push(Array.from(this.d.subarray(i * this.c, (i + 1) * this.c)));
    return out;
  }
  toArray(): number[] {
    return Array.from(this.d);
  }
}

export function transpose(A: Mat) {
  const B = new Mat(A.c, A.r);
  for (let i = 0; i < A.r; i++) for (let j = 0; j < A.c; j++) B.d[j * A.r + i] = A.d[i * A.c + j];
  return B;
}

export function matmul(A: Mat, B: Mat) {
  if (A.c !== B.r) throw new Error(`Dimension mismatch: cannot multiply ${A.r}×${A.c} by ${B.r}×${B.c}`);
  const C = new Mat(A.r, B.c);
  for (let i = 0; i < A.r; i++)
    for (let k = 0; k < A.c; k++) {
      const a = A.d[i * A.c + k];
      if (a === 0) continue;
      for (let j = 0; j < B.c; j++) C.d[i * B.c + j] += a * B.d[k * B.c + j];
    }
  return C;
}

export function matvec(A: Mat, x: ArrayLike<number>): number[] {
  const y = new Array(A.r).fill(0);
  for (let i = 0; i < A.r; i++) {
    let s = 0;
    for (let j = 0; j < A.c; j++) s += A.d[i * A.c + j] * x[j];
    y[i] = s;
  }
  return y;
}

export function madd(A: Mat, B: Mat, sb = 1) {
  if (A.r !== B.r || A.c !== B.c) throw new Error(`Dimension mismatch: ${A.r}×${A.c} and ${B.r}×${B.c}`);
  const C = new Mat(A.r, A.c);
  for (let i = 0; i < A.d.length; i++) C.d[i] = A.d[i] + sb * B.d[i];
  return C;
}

export function mscale(A: Mat, s: number) {
  const C = new Mat(A.r, A.c);
  for (let i = 0; i < A.d.length; i++) C.d[i] = A.d[i] * s;
  return C;
}

/** LU-decomposition with partial pivoting; returns null when singular. */
function luDecompose(A: Mat): { LU: Mat; piv: number[]; sign: number } | null {
  const n = A.r;
  if (A.c !== n) throw new Error('Matrix must be square');
  const LU = A.clone();
  const piv = Array.from({ length: n }, (_, i) => i);
  let sign = 1;
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(LU.d[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(LU.d[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (max < 1e-300) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = LU.d[k * n + j];
        LU.d[k * n + j] = LU.d[p * n + j];
        LU.d[p * n + j] = t;
      }
      [piv[k], piv[p]] = [piv[p], piv[k]];
      sign = -sign;
    }
    const akk = LU.d[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = (LU.d[i * n + k] /= akk);
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) LU.d[i * n + j] -= f * LU.d[k * n + j];
    }
  }
  return { LU, piv, sign };
}

export function det(A: Mat) {
  const lu = luDecompose(A);
  if (!lu) return 0;
  let d = lu.sign;
  for (let i = 0; i < A.r; i++) d *= lu.LU.d[i * A.r + i];
  return d;
}

/** Solve A X = B (B may have several columns). */
export function solve(A: Mat, B: Mat): Mat {
  const n = A.r;
  if (B.r !== n) throw new Error(`Dimension mismatch in solve: ${A.r}×${A.c} \\ ${B.r}×${B.c}`);
  const lu = luDecompose(A);
  if (!lu) throw new Error('Matrix is singular');
  const { LU, piv } = lu;
  const X = new Mat(n, B.c);
  for (let col = 0; col < B.c; col++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = B.d[piv[i] * B.c + col];
      for (let j = 0; j < i; j++) s -= LU.d[i * n + j] * y[j];
      y[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let j = i + 1; j < n; j++) s -= LU.d[i * n + j] * X.d[j * B.c + col];
      X.d[i * B.c + col] = s / LU.d[i * n + i];
    }
  }
  return X;
}

export function solveVec(A: Mat, b: ArrayLike<number>): number[] {
  return solve(A, Mat.col(b)).toArray();
}

export function inv(A: Mat) {
  return solve(A, Mat.eye(A.r));
}

/** Moore-Penrose pseudo-inverse for full-rank matrices (with tiny damping for robustness). */
export function pinv(A: Mat, damping = 1e-12) {
  const At = transpose(A);
  if (A.r <= A.c) {
    const AAt = matmul(A, At);
    for (let i = 0; i < AAt.r; i++) AAt.d[i * AAt.c + i] += damping;
    return matmul(At, inv(AAt));
  }
  const AtA = matmul(At, A);
  for (let i = 0; i < AtA.r; i++) AtA.d[i * AtA.c + i] += damping;
  return matmul(inv(AtA), At);
}

/** Solves the continuous algebraic Riccati equation via the matrix-sign-function method. */
export function care(A: Mat, B: Mat, Q: Mat, R: Mat): Mat {
  const n = A.r;
  const S = matmul(matmul(B, inv(R)), transpose(B));
  // Hamiltonian H = [A, -S; -Q, -A']
  let Z = new Mat(2 * n, 2 * n);
  const At = transpose(A);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      Z.set(i, j, A.get(i, j));
      Z.set(i, j + n, -S.get(i, j));
      Z.set(i + n, j, -Q.get(i, j));
      Z.set(i + n, j + n, -At.get(i, j));
    }
  for (let it = 0; it < 100; it++) {
    const Zi = inv(Z);
    // determinant scaling accelerates convergence
    const dz = Math.abs(det(Z));
    const c = dz > 0 && isFinite(dz) ? Math.pow(dz, -1 / (2 * n)) : 1;
    const Zn = new Mat(2 * n, 2 * n);
    let diff = 0;
    let norm = 0;
    for (let k = 0; k < Zn.d.length; k++) {
      Zn.d[k] = 0.5 * (c * Z.d[k] + Zi.d[k] / c);
      diff += Math.abs(Zn.d[k] - Z.d[k]);
      norm += Math.abs(Zn.d[k]);
    }
    Z = Zn;
    if (diff < 1e-12 * norm) break;
  }
  // Solve [W12; W22 + I] P = -[W11 + I; W21] in least squares sense
  const Lm = new Mat(2 * n, n);
  const Rm = new Mat(2 * n, n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      Lm.set(i, j, Z.get(i, j + n));
      Lm.set(i + n, j, Z.get(i + n, j + n) + (i === j ? 1 : 0));
      Rm.set(i, j, -(Z.get(i, j) + (i === j ? 1 : 0)));
      Rm.set(i + n, j, -Z.get(i + n, j));
    }
  const Lt = transpose(Lm);
  const P = solve(matmul(Lt, Lm), matmul(Lt, Rm));
  // symmetrize
  const Ps = new Mat(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) Ps.set(i, j, 0.5 * (P.get(i, j) + P.get(j, i)));
  return Ps;
}

/** Continuous-time LQR gain K = R^-1 B' P such that u = -K x. */
export function lqr(A: Mat, B: Mat, Q: Mat, R: Mat): { K: Mat; P: Mat } {
  if (A.r !== A.c) throw new Error('lqr: A must be square');
  if (B.r !== A.r) throw new Error('lqr: B must have as many rows as A');
  if (Q.r !== A.r || Q.c !== A.r) throw new Error(`lqr: Q must be ${A.r}×${A.r}`);
  if (R.r !== B.c || R.c !== B.c) throw new Error(`lqr: R must be ${B.c}×${B.c}`);
  const P = care(A, B, Q, R);
  const K = matmul(inv(R), matmul(transpose(B), P));
  for (const v of K.d) if (!isFinite(v)) throw new Error('lqr: Riccati solution failed (is (A,B) stabilizable?)');
  return { K, P };
}

/** Eigenvalues of a real square matrix (unsymmetric QR algorithm on Hessenberg form). Returns [re, im][] */
export function eig(A0: Mat): [number, number][] {
  const n = A0.r;
  const a: number[][] = A0.toRows();
  // Hessenberg reduction
  for (let m = 1; m < n - 1; m++) {
    let x = 0;
    let i = m;
    for (let j = m; j < n; j++)
      if (Math.abs(a[j][m - 1]) > Math.abs(x)) {
        x = a[j][m - 1];
        i = j;
      }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) [a[i][j], a[m][j]] = [a[m][j], a[i][j]];
      for (let j = 0; j < n; j++) [a[j][i], a[j][m]] = [a[j][m], a[j][i]];
    }
    if (x !== 0)
      for (i = m + 1; i < n; i++) {
        let y = a[i][m - 1];
        if (y !== 0) {
          y /= x;
          a[i][m - 1] = y;
          for (let j = m; j < n; j++) a[i][j] -= y * a[m][j];
          for (let j = 0; j < n; j++) a[j][m] += y * a[j][i];
        }
      }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) a[i][j] = 0;
  // QR iterations (hqr from Numerical Recipes)
  const wr = new Array(n).fill(0);
  const wi = new Array(n).fill(0);
  let nn = n - 1;
  let anorm = 0;
  for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
  let t = 0;
  while (nn >= 0) {
    let its = 0;
    let l: number;
    do {
      for (l = nn; l >= 1; l--) {
        const s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]) || anorm;
        if (Math.abs(a[l][l - 1]) + s === s) {
          a[l][l - 1] = 0;
          break;
        }
      }
      const x = a[nn][nn];
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn--] = 0;
      } else {
        const y = a[nn - 1][nn - 1];
        const w = a[nn][nn - 1] * a[nn - 1][nn];
        if (l === nn - 1) {
          const p = 0.5 * (y - x);
          const q = p * p + w;
          const z = Math.sqrt(Math.abs(q));
          const xx = x + t;
          if (q >= 0) {
            const zz = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = xx + zz;
            if (zz) wr[nn] = xx - w / zz;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = xx + p;
            wi[nn - 1] = -(wi[nn] = z);
          }
          nn -= 2;
        } else {
          if (its === 60) throw new Error('eig: too many iterations');
          let xx = x;
          let yy = y;
          let ww = w;
          if (its === 10 || its === 20) {
            t += xx;
            for (let i = 0; i <= nn; i++) a[i][i] -= xx;
            const s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]);
            yy = xx = 0.75 * s;
            ww = -0.4375 * s * s;
          }
          ++its;
          let m: number;
          let p = 0,
            q = 0,
            r = 0,
            z: number;
          for (m = nn - 2; m >= l; m--) {
            z = a[m][m];
            r = xx - z;
            const s2 = yy - z;
            p = (r * s2 - ww) / a[m + 1][m] + a[m][m + 1];
            q = a[m + 1][m + 1] - z - r - s2;
            r = a[m + 2][m + 1];
            const s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r));
            const v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            a[i][i - 2] = 0;
            if (i !== m + 2) a[i][i - 3] = 0;
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = a[k][k - 1];
              q = a[k + 1][k - 1];
              r = 0;
              if (k !== nn - 1) r = a[k + 2][k - 1];
              xx = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (xx !== 0) {
                p /= xx;
                q /= xx;
                r /= xx;
              }
            }
            const s0 = Math.sqrt(p * p + q * q + r * r);
            const s = p >= 0 ? s0 : -s0;
            if (s !== 0) {
              if (k === m) {
                if (l !== m) a[k][k - 1] = -a[k][k - 1];
              } else a[k][k - 1] = -s * xx;
              p += s;
              xx = p / s;
              yy = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = a[k][j] + q * a[k + 1][j];
                if (k !== nn - 1) {
                  p += r * a[k + 2][j];
                  a[k + 2][j] -= p * z;
                }
                a[k + 1][j] -= p * yy;
                a[k][j] -= p * xx;
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = xx * a[i][k] + yy * a[i][k + 1];
                if (k !== nn - 1) {
                  p += z * a[i][k + 2];
                  a[i][k + 2] -= p * r;
                }
                a[i][k + 1] -= p * q;
                a[i][k] -= p;
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  return wr.map((re, i) => [re, wi[i]] as [number, number]);
}

// ---- 3-vectors & rotations (plain arrays for speed) ----
export type V3 = [number, number, number];
export const v3 = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a: V3) => Math.hypot(a[0], a[1], a[2]),
};
/** 3x3 rotation matrices as row-major number[9] */
export type R3 = number[];
export const r3 = {
  mul: (A: R3, B: R3): R3 => {
    const C = new Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    return C;
  },
  apply: (A: R3, v: V3): V3 => [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ],
  applyT: (A: R3, v: V3): V3 => [
    A[0] * v[0] + A[3] * v[1] + A[6] * v[2],
    A[1] * v[0] + A[4] * v[1] + A[7] * v[2],
    A[2] * v[0] + A[5] * v[1] + A[8] * v[2],
  ],
  rotX: (a: number): R3 => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  },
  rotZ: (a: number): R3 => {
    const c = Math.cos(a),
      s = Math.sin(a);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  },
  eye: (): R3 => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  transpose: (A: R3): R3 => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]],
  col: (A: R3, j: number): V3 => [A[j], A[3 + j], A[6 + j]],
};

export function wrapToPi(a: number) {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Deterministic PRNG (mulberry32) */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
