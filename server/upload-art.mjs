// Uploads card art from ../art/cards to the FILES KV namespace, only what changed since the last upload.
// The app downloads art/<id>.webp (listed with a hash in art/manifest.json) instead of bundling it.
// usage: node upload-art.mjs <server url> <kv namespace id>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const [url, kv] = process.argv.slice(2);
const dir = new URL('../art/cards/', import.meta.url);
const manifest = {};
for (const f of readdirSync(dir).filter(f => f.endsWith('.webp'))) {
  manifest[f.slice(0, -5)] = createHash('sha1').update(readFileSync(new URL(f, dir))).digest('hex').slice(0, 12);
}
const live = await fetch(`${url}/art/manifest.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
const changed = Object.keys(manifest).filter(id => live[id] !== manifest[id]);
console.log(`${Object.keys(manifest).length} cards, ${changed.length} to upload`);
if (!changed.length && Object.keys(live).length === Object.keys(manifest).length) process.exit(0);
// shortcut: one bulk write per deploy keeps us inside KV's free 1,000 writes a day; split it if art ever passes ~70 MB
const items = changed.map(id => ({ key: `art/${id}.webp`, value: readFileSync(new URL(`${id}.webp`, dir)).toString('base64'), base64: true }));
items.push({ key: 'art/manifest.json', value: JSON.stringify(manifest) });
writeFileSync('art-bulk.json', JSON.stringify(items));
execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', 'art-bulk.json', '--namespace-id', kv, '--remote'], { stdio: 'inherit' });
