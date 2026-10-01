import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');
const distIndexPath = path.resolve(distDir, 'index.html');

console.log(`[check:dist] Checking production build artifact: ${distIndexPath}`);

if (!fs.existsSync(distIndexPath)) {
  console.error('[check:dist] Error: dist/index.html not found! Run "npm run build" first.');
  process.exit(1);
}

const html = fs.readFileSync(distIndexPath, 'utf-8');
const errors = [];

if (!html.includes('id="root"')) {
  errors.push('Required element id="root" is missing in dist/index.html');
}

if (!html.includes('<script type="module"')) {
  errors.push('Required module script <script type="module" is missing in dist/index.html');
}

if (errors.length > 0) {
  console.error('[check:dist] Verification failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('[check:dist] Verification passed: dist/index.html contains id="root" and <script type="module".');

// Check for sensitive credential leaks in build artifacts
console.log('[check:dist] Scanning dist assets for sensitive credential leaks...');
const leakPatterns = [
  { name: 'Bot Token pattern', regex: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/ },
  { name: 'Private Key header', regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/ },
  { name: 'Google API key', regex: /AIza[a-zA-Z0-9_-]{35}/ }
];

const forbiddenPath = path.resolve(__dirname, '../.scan-forbidden.local');
const forbiddenStrings = [];
if (fs.existsSync(forbiddenPath)) {
  const content = fs.readFileSync(forbiddenPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line && !line.startsWith('#')) {
      forbiddenStrings.push(line);
    }
  }
  console.log(`[check:dist] Loaded ${forbiddenStrings.length} forbidden rule(s) from .scan-forbidden.local`);
}

const leakErrors = [];
function scanForLeaks(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForLeaks(fullPath);
    } else if (/\.(js|html|css|json|map)$/i.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of leakPatterns) {
        if (pattern.regex.test(content)) {
          leakErrors.push(`Potential credential leak (${pattern.name}) detected in: ${path.relative(distDir, fullPath)}`);
        }
      }
      for (const forbidden of forbiddenStrings) {
        if (content.includes(forbidden)) {
          leakErrors.push(`Forbidden string from .scan-forbidden.local detected in: ${path.relative(distDir, fullPath)}`);
        }
      }
    }
  }
}

scanForLeaks(distDir);

if (leakErrors.length > 0) {
  console.error('[check:dist] Leak scan failed:');
  for (const err of leakErrors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('[check:dist] Verification passed: 0 secret leaks detected across all bundle assets.');
