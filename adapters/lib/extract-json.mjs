// Extract a seat's JSON output from a model reply: the last ```json fence, else the last
// fence that parses, else the whole reply if it is JSON. CLI: node extract-json.mjs <in> <out>
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function extractLastJson(text) {
  const t = text.replace(/\r\n/g, '\n');
  const fences = [...t.matchAll(/```([a-zA-Z]*)\n([\s\S]*?)\n```/g)];
  const labelled = fences.filter(m => m[1].toLowerCase() === 'json');
  if (labelled.length) {
    const body = labelled[labelled.length - 1][2];
    try { return JSON.parse(body); } catch (e) { throw new Error(`last json block is not valid JSON: ${e.message}`); }
  }
  for (let i = fences.length - 1; i >= 0; i--) { try { return JSON.parse(fences[i][2]); } catch { /* try the previous fence */ } }
  try { return JSON.parse(t.trim()); } catch { /* fall through */ }
  throw new Error('no JSON block found in the model reply (expected a final ```json fence)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const obj = extractLastJson(readFileSync(process.argv[2], 'utf8'));
    writeFileSync(process.argv[3], JSON.stringify(obj, null, 2) + '\n');
  } catch (e) { console.error(`extract-json: ${e.message}`); process.exit(1); }
}
