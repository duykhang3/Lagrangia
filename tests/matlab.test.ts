import { describe, expect, it } from 'vitest';
import { evalString, MatlabFunction, runScript, valueToString } from '../src/core/matlab/interp';
import { Mat } from '../src/core/linalg';

const s = (src: string) => valueToString(evalString(src));

describe('mini MATLAB interpreter', () => {
  it('arithmetic & precedence', () => {
    expect(evalString('1 + 2*3^2')).toBe(19);
    expect(evalString('-2^2')).toBe(-4);
    expect(evalString('2^-1')).toBe(0.5);
    expect(evalString('pi')).toBeCloseTo(Math.PI);
  });
  it('matrix literals with spaces and signs', () => {
    expect(s('[1 2; 3 4]')).toBe('[1 2; 3 4]');
    expect(s('[1 -2]')).toBe('[1 -2]');
    expect(s('[1 - 2]')).toBe('-1');
    expect(s("[1 2 3]'")).toBe('[1; 2; 3]');
    expect(s('[1, 2\n 3, 4]')).toBe('[1 2; 3 4]');
  });
  it('matrix ops', () => {
    expect(s('[1 2; 3 4] * [1; 1]')).toBe('[3; 7]');
    expect(s('[1 2] * [3; 4]')).toBe('11');
    expect(s('inv([2 0; 0 4])')).toBe('[0.5 0; 0 0.25]');
    expect(s('[2 0; 0 4] \\ [2; 4]')).toBe('[1; 1]');
    expect(s('[1 2 3] .* [2 2 2]')).toBe('[2 4 6]');
    expect(s('diag([1 2])')).toBe('[1 0; 0 2]');
  });
  it('indexing, ranges and end', () => {
    const env = runScript('x = [10; 20; 30; 40];\ny = x(2);\nz = x(end);\nw = x(2:3);\nA = [1 2; 3 4];\nb = A(2,1);\nc = A(:,2);\nx(6) = 1;');
    expect(env.get('y')).toBe(20);
    expect(env.get('z')).toBe(40);
    expect(valueToString(env.get('w')!)).toBe('[20; 30]');
    expect(env.get('b')).toBe(3);
    expect(valueToString(env.get('c')!)).toBe('[2; 4]');
    expect((env.get('x') as Mat).r).toBe(6);
  });
  it('control flow', () => {
    const env = runScript('s = 0;\nfor i = 1:10\n  if mod(i,2) == 0\n    continue\n  elseif i > 7\n    break\n  else\n    s = s + i;\n  end\nend\nk = 0;\nwhile k < 5, k = k + 1; end');
    expect(env.get('s')).toBe(1 + 3 + 5 + 7);
    expect(env.get('k')).toBe(5);
  });
  it('function with persistent state', () => {
    const f = new MatlabFunction('function y = fcn(u)\npersistent acc\nif isempty(acc)\n  acc = 0;\nend\nacc = acc + u;\ny = acc;\nend');
    expect(f.def.inputs).toEqual(['u']);
    expect(f.call([1], {})[0]).toBe(1);
    expect(f.call([2], {})[0]).toBe(3);
    f.reset();
    expect(f.call([5], {})[0]).toBe(5);
  });
  it('multiple outputs and lqr', () => {
    const env = runScript('A = [0 1; 0 0]; B = [0; 1];\n[K, P] = lqr(A, B, eye(2), 1);\n[m, i] = max([3 9 2]);');
    const K = env.get('K') as Mat;
    // double integrator with Q = I, R = 1 -> K = [1, sqrt(3)]
    expect(K.d[0]).toBeCloseTo(1, 6);
    expect(K.d[1]).toBeCloseTo(Math.sqrt(3), 6);
    expect(env.get('m')).toBe(9);
    expect(env.get('i')).toBe(2);
  });
  it('error messages carry line numbers', () => {
    expect(() => runScript('a = 1;\nb = undefinedThing + 1;')).toThrow(/Line 2/);
    expect(() => runScript('a = [1 2] * [3 4];')).toThrow(/dimensions/);
  });
  it('comments and continuation', () => {
    const env = runScript("% comment\na = 1 + ... continued\n  2; % trailing\nb = a' ;");
    expect(env.get('a')).toBe(3);
  });
});
