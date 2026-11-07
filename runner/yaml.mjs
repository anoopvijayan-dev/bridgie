// Minimal YAML subset for Bridgie frontmatter and policy files. No dependencies.
// Supported: block maps (2-space indent), block lists of scalars/flow values,
// inline [arrays] and {maps} on one line, scalars, # comments. Nothing else.

function stripComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function scalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  return s;
}

// Split a flow collection body on top-level commas, respecting quotes and nesting.
function splitTop(s) {
  const parts = []; let depth = 0, inS = false, inD = false, cur = '';
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    if (!inS && !inD) {
      if (c === '[' || c === '{') depth++;
      if (c === ']' || c === '}') depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

function splitKey(s) {           // "key: value" → [key, value] at first unquoted colon-space
  let inS = false, inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === ':' && !inS && !inD && (i === s.length - 1 || /\s/.test(s[i + 1]))) {
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    }
  }
  return null;
}

export function parseValue(raw) {
  const s = raw.trim();
  if (s.startsWith('[') && s.endsWith(']')) return splitTop(s.slice(1, -1)).map(parseValue);
  if (s.startsWith('{') && s.endsWith('}')) {
    const out = {};
    for (const part of splitTop(s.slice(1, -1))) {
      const kv = splitKey(part.trim());
      if (!kv) throw new Error(`bad flow map entry: ${part}`);
      out[unquote(kv[0])] = parseValue(kv[1]);
    }
    return out;
  }
  return scalar(s);
}

function unquote(k) { return scalar(k) === null ? k : String(scalar(k)); }

function indentOf(line) { return line.length - line.trimStart().length; }

function parseBlock(lines, i, indent) {
  // Returns [value, nextIndex]. Decides map vs list from the first line.
  const first = lines[i].trimStart();
  if (first.startsWith('- ') || first === '-') return parseList(lines, i, indent);
  return parseMap(lines, i, indent);
}

function parseMap(lines, i, indent) {
  const out = {};
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`unexpected indent at line ${i + 1}: ${line}`);
    const kv = splitKey(line.trim());
    if (!kv) throw new Error(`expected "key: value" at line ${i + 1}: ${line}`);
    const [key, rest] = kv;
    if (rest === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && indentOf(lines[j]) > indent) {
        const [val, next] = parseBlock(lines, j, indentOf(lines[j]));
        out[unquote(key)] = val; i = next;
      } else { out[unquote(key)] = null; i++; }
    } else {
      out[unquote(key)] = parseValue(rest); i++;
    }
  }
  return [out, i];
}

function parseList(lines, i, indent) {
  const out = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`unexpected indent at line ${i + 1}: ${line}`);
    const t = line.trim();
    if (!(t.startsWith('- ') || t === '-')) break;
    const rest = t === '-' ? '' : t.slice(2).trim();
    if (rest === '') {
      const j = i + 1;
      if (j < lines.length && indentOf(lines[j]) > indent) {
        const [val, next] = parseBlock(lines, j, indentOf(lines[j]));
        out.push(val); i = next;
      } else { out.push(null); i++; }
    } else if (splitKey(rest) && !rest.startsWith('[') && !rest.startsWith('{') && !rest.startsWith('"') && !rest.startsWith("'")) {
      // "- key: value" starts an inline map item whose further keys are indented by 2.
      const [k, v] = splitKey(rest);
      const item = { [unquote(k)]: parseValue(v) };
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== '' && indentOf(lines[j]) === indent + 2) {
        const kv = splitKey(lines[j].trim());
        if (!kv) break;
        item[unquote(kv[0])] = parseValue(kv[1]); j++;
      }
      out.push(item); i = j;
    } else {
      out.push(parseValue(rest)); i++;
    }
  }
  return [out, i];
}

export function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(stripComment);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return {};
  const [val] = parseBlock(lines, i, indentOf(lines[i]));
  return val;
}

function needsQuote(s) {
  return s === '' || /^[\s]|[\s]$/.test(s) || /[:#,\[\]{}"']/.test(s) || /^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) || s.startsWith('- ');
}
function q(s) { return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }

function flow(v) {
  if (Array.isArray(v)) return `[${v.map(flow).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${flow(x)}`).join(', ')} }`;
  if (v === null) return 'null';
  if (typeof v === 'string') return needsQuote(v) ? q(v) : v;
  return String(v);
}

export function stringify(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      const simple = v.every(x => x === null || typeof x !== 'object');
      if (simple && v.length <= 4 && flow(v).length <= 80) lines.push(`${pad}${k}: ${flow(v)}`);
      else { lines.push(`${pad}${k}:`); for (const x of v) lines.push(`${pad}  - ${flow(x)}`); }
    } else if (v && typeof v === 'object') {
      const hasNested = Object.values(v).some(x => x && typeof x === 'object' && !Array.isArray(x));
      if (!hasNested && flow(v).length <= 80) lines.push(`${pad}${k}: ${flow(v)}`);
      else { lines.push(`${pad}${k}:`); lines.push(stringify(v, indent + 2)); }
    } else {
      lines.push(`${pad}${k}: ${flow(v)}`);
    }
  }
  return lines.join('\n');
}

export function splitFrontmatter(md) {
  const text = md.replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { data: {}, body: text };
  const yaml = text.slice(4, end);
  let body = text.slice(end + 4);
  if (body.startsWith('\n')) body = body.slice(1);
  return { data: parse(yaml), body };
}

export function joinFrontmatter(data, body) {
  return `---\n${stringify(data)}\n---\n${body}`;
}
