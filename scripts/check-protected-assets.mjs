// Guard: fail if any device-referenced asset is missing from the working tree.
// Phone launcher tiles (localStorage) and installed PWAs reference these paths by
// URL — invisible to any in-repo grep. See protected-assets.json.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { paths } = JSON.parse(readFileSync(join(root, 'protected-assets.json'), 'utf8'));
const missing = paths.filter((p) => !existsSync(join(root, p)));
if (missing.length) {
  console.error('MISSING protected assets (device tiles/PWAs reference these):');
  missing.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
console.log(`protected assets OK (${paths.length}/${paths.length} present)`);
