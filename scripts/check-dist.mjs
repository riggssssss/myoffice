// Fails the build if anything that looks like a credential ended up in the built app.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic key'],
  [/gsk_[A-Za-z0-9]{40,}/, 'Groq key'],
  [/\bsk-[A-Za-z0-9]{32,}/, 'OpenAI-style key'],
  [/AIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bfal_[A-Za-z0-9]{20,}|\bkey_[A-Za-z0-9]{32,}/, 'fal.ai key'],
];
const TEXT = /\.(js|css|html|json|map|txt|svg)$/;

const hits = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(`${p}: parece una ${what}`);
    }
  }
})('dist');

if (hits.length) {
  console.error('✗ El build contiene posibles secretos:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('✓ dist/ sin secretos');
