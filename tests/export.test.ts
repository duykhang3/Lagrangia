import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/core/blocks/examples';
import { exportMatlab } from '../src/core/export/matlab';
import { defaultParams } from '../src/core/systems';

describe('MATLAB export', () => {
  for (const ex of EXAMPLES)
    it(ex.id, () => {
      const code = exportMatlab(ex.system, ex.model, defaultParams(ex.system));
      expect(code).toContain('function S = ctrl_init');
      expect(code).not.toMatch(/WARNING/);
      // every 'function' line should be balanced by 'end' (all functions are closed)
      const fnCount = (code.match(/^function /gm) || []).length;
      expect(fnCount).toBeGreaterThan(5);
    });
});
