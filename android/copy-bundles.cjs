// Invoked after `npm run build`. Keep the APK's bundled fallback in sync with
// the exact same dist/ scripts the standalone WGT ships.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(__dirname, 'app', 'src', 'main', 'assets', 'bundles');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  throw new Error('Invalid source version in package.json');
}
const scripts = ['early.js', 'userScript.js'];
const sources = scripts.map((name) => {
  const bytes = fs.readFileSync(path.join(root, 'dist', name));
  if (bytes.length < 1000 || bytes.length > 5 * 1024 * 1024 || !bytes.toString('utf8').includes('AxoTube')) {
    throw new Error('Built bundle missing/invalid: ' + name + '. Run npm run build first.');
  }
  return [name, bytes];
});
fs.mkdirSync(target, { recursive: true });
for (const [name, bytes] of sources) fs.writeFileSync(path.join(target, name), bytes);
fs.writeFileSync(path.join(target, 'version.json'), JSON.stringify({ version: manifest.version }) + '\n');
console.log('Packaged Android fallback scripts from dist/, version ' + manifest.version);
