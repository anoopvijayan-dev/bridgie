// Decision surface: render pages from state files; serve them on localhost;
// write every decision through state.mjs. No dependencies.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import * as st from './state.mjs';
import * as fl from './flow.mjs';

const T = name => readFileSync(join(st.HOME, 'ui', 'templates', `${name}.html`), 'utf8');
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (tpl, data) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? '');
const page = (title, content, opts) => fill(T('base'), { title: esc(title), content, mode: opts.readonly ? 'read-only snapshot' : 'live', home: opts.readonly ? 'index.html' : '/' });

function age(iso) {
  const h = Math.floor((Date.now() - Date.parse(iso)) / 36e5);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// Minimal markdown: "## " headings become sections; "- " lines become lists; other lines paragraphs.
export function mdSections(body) {
  const out = []; let cur = null;
  for (const l of body.replace(/\r\n/g, '\n').split('\n')) {
    const h = l.match(/^## (.+)/);
    if (h) { cur = { title: h[1].trim(), lines: [] }; out.push(cur); continue; }
    if (/^# /.test(l) || !cur) continue;
    cur.lines.push(l);
  }
  return out.map(s => ({ title: s.title, html: mdLines(s.lines) }));
}
function mdLines(lines) {
  const html = []; let list = [];
  const flush = () => { if (list.length) { html.push(`<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`); list = []; } };
  for (const l of lines) {
    const m = l.match(/^\s*-\s+(.*)/);
    if (m) { list.push(m[1]); continue; }
    flush();
    if (l.trim()) html.push(`<p>${esc(l)}</p>`);
  }
  flush();
  return html.join('\n') || '<p class="empty">—</p>';
}

export function renderInbox(root, opts = {}) {
  const pending = st.listDecisions(root, null, { pending: true });
  const href = d => opts.readonly ? `bet-${esc(d.bet)}.html#${esc(d.id)}` : `/bet/${esc(d.bet)}#${esc(d.id)}`;
  const rows = pending.length
    ? pending.map(d => `<li class="${d.status}"><a href="${href(d)}"><span class="pill">${esc(d.type)}</span> <b>${esc(d.bet)}</b> · ${esc(d.id)} <span class="age">${age(d.created_at)}</span><br><span class="ctx">${esc(d.context)}</span></a></li>`).join('\n')
    : '<li class="empty">Nothing pending. Raise questions with <code>bridgie grill &lt;slug&gt;</code>.</li>';
  const bets = st.listBets(root).map(s => {
    const { data } = st.readFm(st.betPath(root, s));
    const link = opts.readonly ? `bet-${esc(s)}.html` : `/bet/${esc(s)}`;
    return `<li><a href="${link}">${esc(data.title)}</a> <span class="pill">${esc(data.status)}</span></li>`;
  }).join('\n') || '<li class="empty">No bets yet.</li>';
  return page('Inbox', fill(T('inbox'), { rows, bets, count: String(pending.length) }), opts);
}

export function renderBet(root, slug, opts = {}) {
  const { data, body } = st.readFm(st.betPath(root, slug));
  const decisions = st.loadDecisions(root, slug).decisions;
  const pendingQ = decisions.filter(d => d.type === 'question' && d.status === 'pending');
  const openQ = decisions.filter(d => d.type === 'question' && d.status !== 'answered');
  const sign = decisions.find(d => d.type === 'sign' && d.status !== 'answered');
  const card = (k, v) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
  const cards = [
    card('status', `<span class="pill">${esc(data.status)}</span>`),
    card('lane / risk', esc(`${data.lane} / ${data.risk}`)),
    card('confidence', esc(data.confidence)),
    card('appetite', esc(`${data.appetite?.time ?? '?'} · $${data.appetite?.tokens_usd ?? '?'} tokens`)),
    card('owner', esc(data.owner)),
    card('kill criteria', (data.kill_criteria || []).length ? `<ul>${data.kill_criteria.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<span class="empty">none set</span>'),
  ].join('\n');

  const hidden = id => `<input type="hidden" name="slug" value="${esc(slug)}"><input type="hidden" name="id" value="${esc(id)}">`;
  const qform = d => opts.readonly
    ? `<p class="cli">CLI: <code>bridgie decide ${esc(slug)} ${esc(d.id)} "&lt;answer&gt;"</code></p>`
    : `<form method="post" action="/decide">${hidden(d.id)}
${d.options.map(o => `<label><input type="radio" name="answer" value="${esc(o)}"> ${esc(o)}</label>`).join('\n')}
${d.allow_free_text ? `<label><input type="radio" name="answer" value="__text__"> other:</label><input type="text" name="text" placeholder="free-text answer">` : ''}
<button type="submit" class="primary">Answer</button> <button type="submit" name="answer" value="defer" class="ghost">Defer</button></form>`;
  const questions = openQ.length
    ? openQ.map(d => `<section class="question ${d.status}" id="${esc(d.id)}"><h3>${esc(d.id)} <span class="pill">${esc(d.status)}</span></h3><p>${esc(d.context)}</p>${qform(d)}</section>`).join('\n')
    : '<p class="empty">No open questions.</p>';

  let signHtml;
  if (!sign) signHtml = `<p class="empty">No sign decision yet (status: ${esc(data.status)}). Run <code>bridgie grill ${esc(slug)}</code>.</p>`;
  else if (opts.readonly) signHtml = `<p>${esc(sign.context)}</p><p class="cli">CLI: <code>bridgie sign ${esc(slug)}</code> · <code>bridgie sign ${esc(slug)} --more-evidence</code> · <code>bridgie sign ${esc(slug)} --kill</code></p>`;
  else {
    const min = st.lanePolicy(st.loadPolicy(root), data.lane, data.risk).min_confidence_to_sign || 'anecdote';
    const reasons = [];
    if (pendingQ.length) reasons.push(`${pendingQ.length} question(s) pending: ${pendingQ.map(x => x.id).join(', ')}`);
    if (st.CONFIDENCE.indexOf(data.confidence) < st.CONFIDENCE.indexOf(min)) reasons.push(`confidence "${data.confidence}" is below "${min}" required for risk ${data.risk}; gather evidence, then raise confidence in bet.md`);
    const blocked = reasons.join('; ');
    const btn = (v, cls) => `<button type="submit" name="answer" value="${esc(v)}" class="${cls}"${blocked && v === 'sign' ? ' disabled' : ''}>${esc(v)}</button>`;
    signHtml = `<form method="post" action="/decide" id="${esc(sign.id)}">${hidden(sign.id)}<p>${esc(sign.context)}</p>${blocked ? `<p class="warn">Sign is blocked: ${esc(blocked)}</p>` : ''}${btn('sign', 'primary')} ${btn('need more evidence', '')} ${btn('kill', 'danger')}</form>`;
  }

  const openByDefault = new Set(['Who', 'Problem in their words', 'Why now']);
  const sections = mdSections(body).filter(s => s.title !== 'Open questions')
    .map(s => `<details${openByDefault.has(s.title) ? ' open' : ''}><summary>${esc(s.title)}</summary>${s.html}</details>`).join('\n');
  const raw = `<code>${esc(st.betPath(root, slug))}</code> · <code>${esc(st.decisionsPath(root, slug))}</code>`;
  return page(data.title, fill(T('bet'), { title: esc(data.title), slug: esc(slug), cards, questions, sign: signHtml, sections, raw }), opts);
}

export function renderAll(root, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderInbox(root, { readonly: true }));
  for (const s of st.listBets(root)) writeFileSync(join(outDir, `bet-${s}.html`), renderBet(root, s, { readonly: true }));
  return outDir;
}

function featureSha(root, slug) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', `bridgie/${slug}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

export function serve(root, { port = 0, host = '127.0.0.1', by = 'unknown' } = {}) {
  const server = http.createServer((req, res) => {
    const send = (code, html) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, renderInbox(root));
      const m = url.pathname.match(/^\/bet\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && m) return send(200, renderBet(root, m[1]));
      if (req.method === 'POST' && url.pathname === '/decide') {
        let buf = '';
        req.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try {
            const p = new URLSearchParams(buf);
            const slug = p.get('slug'), id = p.get('id'); let answer = p.get('answer'); const text = p.get('text') || undefined;
            if (!slug || !id || !answer) throw new Error('pick an answer first');
            if (answer === '__text__') { if (!text) throw new Error('free-text answer is empty'); answer = text; }
            fl.answer(root, slug, id, answer, { text, by, gitSha: featureSha(root, slug) });
            res.writeHead(303, { location: `/bet/${slug}#${id}` }); res.end();
          } catch (e) {
            send(400, page('Not applied', `<p class="warn">${esc(e.message)}</p><p><a href="javascript:history.back()">Back</a></p>`, {}));
          }
        });
        return;
      }
      send(404, page('Not found', '<p>Not found.</p>', {}));
    } catch (e) { send(500, page('Error', `<p class="warn">${esc(e.message)}</p>`, {})); }
  });
  return new Promise(ok => server.listen(port, host, () => {
    const a = server.address();
    console.log(`LISTENING http://${host}:${a.port}`);
    ok({ server, url: `http://${host}:${a.port}` });
  }));
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref(); } catch { /* no browser available; the URL is printed */ }
}

function flag(a, n) { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [op, ...a] = process.argv.slice(2);
  const root = flag(a, 'root');
  if (op === 'render') { console.log(renderAll(root, flag(a, 'out') || join(root, '.bridgie', 'ui'))); }
  else if (op === 'serve') {
    serve(root, { port: Number(flag(a, 'port') || 0), host: flag(a, 'host') || '127.0.0.1', by: flag(a, 'by') || 'unknown' })
      .then(({ url }) => { const path = flag(a, 'path') || '/'; if (a.includes('--open')) openBrowser(url + path); console.log(`Open ${url}${path}  (Ctrl-C to stop)`); });
  } else { console.error(`surface.mjs: unknown op "${op}"`); process.exit(2); }
}
