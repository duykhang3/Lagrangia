// Copies MathLive fonts into public/ so the WYSIWYG math editor works offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'mathlive', 'dist', 'fonts');
const dst = join(root, 'public', 'mathlive-fonts');
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log('MathLive fonts copied to public/mathlive-fonts');
} else {
  console.warn('MathLive fonts not found, skipping copy');
}
