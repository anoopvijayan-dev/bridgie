// Decision surface: render pages from state files; serve them on localhost;
// write every decision through state.mjs. No dependencies.
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
  const html = []; let list = [], table = [], code = null;
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const flush = () => {
    if (list.length) { html.push(`<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`); list = []; }
    if (table.length) {
      const rows = table.filter(r => !/^\s*\|?\s*:?-{2,}/.test(r));
      const [head, ...rest] = rows;
      html.push(`<table><thead><tr>${cells(head).map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rest.map(r => `<tr>${cells(r).map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      table = [];
    }
  };
  for (const l of lines) {
    if (code !== null) { if (/^```/.test(l)) { html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(l); continue; }
    if (/^```/.test(l)) { flush(); code = []; continue; }
    if (/^\s*\|/.test(l)) { if (list.length) { const t = table; table = []; flush(); table = t; } table.push(l); continue; }
    const m = l.match(/^\s*[-*]\s+(.*)/);
    if (m) { if (table.length) flush(); list.push(m[1]); continue; }
    flush();
    const h = l.match(/^#{3,6}\s+(.*)/);
    if (h) { html.push(`<h4>${esc(h[1])}</h4>`); continue; }
    if (/^#{1,2}\s/.test(l)) continue;
    if (l.trim()) html.push(`<p>${esc(l)}</p>`);
  }
  if (code !== null) html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush();
  return html.join('\n') || '<p class="empty">—</p>';
}

// mdDoc: a whole markdown file as collapsible sections (first one open).
function mdDoc(md, open = []) {
  const secs = mdSections(md);
  if (!secs.length) return mdLines(md.split('\n'));
  return secs.map((x, i) => `<details${open.includes(x.title) || (!open.length && i === 0) ? ' open' : ''}><summary>${esc(x.title)}</summary>${x.html}</details>`).join('\n');
}

// requirementsTable: "## R1 · event · risk: x" headings and their text as an ID / requirement table.
function requirementsTable(md) {
  const rows = [];
  for (const sec of md.replace(/\r\n/g, '\n').split(/^## /m).slice(1)) {
    const [head, ...rest] = sec.split('\n');
    const [id, ...tags] = head.split('·').map(x => x.trim());
    rows.push(`<tr><td><b>${esc(id)}</b></td><td>${esc(tags.join(' · '))}</td><td>${esc(rest.join(' ').replace(/\s+/g, ' ').trim())}</td></tr>`);
  }
  return rows.length ? `<table><thead><tr><th>ID</th><th>Kind</th><th>Requirement</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : mdLines(md.split('\n'));
}

const readIf = f => (existsSync(f) ? readFileSync(f, 'utf8') : null);

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

const LABEL = { approve_design: 'Approve design', ack_risk: 'Acknowledge risk', unblock: 'Unblock', accept: 'Accept' };
const TEXT_HINT = {
  'request changes': 'what should change', 'approve with conditions': 'the conditions', reject: 'the reason',
  'retry with guidance': 'guidance for the next attempt', decline: 'why (optional)',
};
const CLI = {
  approve_design: (slug, d) => [`bridgie shape ${slug} --approve`, `bridgie shape ${slug} --changes "<what to change>"`],
  ack_risk: slug => [`bridgie ack ${slug}`, `bridgie ack ${slug} --decline`],
  accept: slug => [`bridgie accept ${slug} --approve`, `bridgie accept ${slug} --conditions "<conditions>"`, `bridgie accept ${slug} --reject "<reason>"`],
  unblock: (slug, d) => d.options.map(o => `bridgie decide ${slug} ${d.id} "${o}" --text "<guidance>"`),
};

function decisionCard(root, slug, d, opts) {
  const title = d.type === 'unblock' ? `Unblock ${d.task || ''}` : LABEL[d.type] || d.type;
  let detail = '';
  if (d.type === 'approve_design') {
    const design = readIf(join(root, '.bridgie', 'specs', slug, 'design.md'));
    const reqs = readIf(join(root, '.bridgie', 'specs', slug, 'requirements.md'));
    detail = `${reqs ? `<h4>Requirements</h4>${requirementsTable(reqs)}` : ''}${design ? `<h4>Design</h4>${mdDoc(design, ['Decision', 'Failure modes'])}` : ''}`;
  } else if (d.type === 'accept') {
    const acc = readIf(fl.acceptancePath(root, slug));
    if (acc) {
      const { data, body } = st.readFm(fl.acceptancePath(root, slug));
      const ru = (data.residual_uncertainty || []).map(x => `<li>${esc(x)}</li>`).join('');
      detail = `${ru ? `<p class="warn"><b>Residual uncertainty</b></p><ul>${ru}</ul>` : ''}<p>${esc(data.approvals?.length || 0)} of ${esc(data.approvers_required || 1)} approval(s) recorded.</p>${mdDoc(body, ['Evidence matrix', 'What changed and blast radius'])}`;
    }
  } else if (d.type === 'unblock' && d.task) {
    try {
      const t = fl.loadTasks(root, slug).tasks.find(x => x.id === d.task);
      if (t) detail = `<p class="warn">${esc(t.escalation || '')}</p>`;
    } catch { /* no tasks file */ }
  }
  const head = `<h3>${esc(title)} <small class="empty">${esc(d.id)}</small></h3><p>${esc(d.context)}</p>`;
  if (opts.readonly) return `<section class="question" id="${esc(d.id)}">${head}<p class="cli">CLI: ${(CLI[d.type] ? CLI[d.type](slug, d) : [`bridgie decide ${slug} ${d.id} "<answer>"`]).map(c => `<code>${esc(c)}</code>`).join(' · ')}</p>${detail}</section>`;
  const hint = d.options.map(o => TEXT_HINT[o]).filter(Boolean);
  const buttons = d.options.map((o, i) => `<button type="submit" name="answer" value="${esc(o)}" class="${i === 0 ? 'primary' : /reject|kill|decline/.test(o) ? 'danger' : ''}">${esc(o)}</button>`).join(' ');
  return `<section class="question" id="${esc(d.id)}">${head}<form method="post" action="/decide"><input type="hidden" name="slug" value="${esc(slug)}"><input type="hidden" name="id" value="${esc(d.id)}">${hint.length ? `<input type="text" name="text" placeholder="${esc(hint.join(' / '))}">` : ''}${buttons}</form>${detail}</section>`;
}

function tasksTable(root, slug) {
  let doc;
  try { doc = fl.loadTasks(root, slug); } catch { return ''; }
  const rows = doc.tasks.map(t => {
    let verdict = '';
    try { if (t.evidence && existsSync(t.evidence)) verdict = st.readJson(t.evidence).verdict; } catch { /* unreadable evidence */ }
    return `<tr><td>${esc(t.id)}</td><td>${esc(t.title)}</td><td>${esc(t.status)}</td><td>${t.attempts} / ${t.max_attempts}</td><td>${esc(verdict)}</td><td>${esc(t.requirements.join(', '))}</td></tr>`;
  }).join('');
  return `<h2>Tasks</h2><table><thead><tr><th>Task</th><th>Title</th><th>Status</th><th>Attempts</th><th>Last verdict</th><th>Requirements</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  const waitingList = decisions.filter(d => !['question', 'sign'].includes(d.type) && d.status !== 'answered');
  const waiting = waitingList.length ? `<h2>Waiting for you</h2>${waitingList.map(d => decisionCard(root, slug, d, opts)).join('\n')}` : '';
  const showSign = !['signed', 'delivered', 'evaluated'].includes(data.status) || sign;
  const specs = ['requirements.md', 'design.md'].map(f => [f, readIf(join(root, '.bridgie', 'specs', slug, f))]).filter(([, t]) => t && !waitingList.some(d => d.type === 'approve_design'));
  const specHtml = specs.length ? `<h2>Design and requirements</h2>${specs.map(([f, t]) => `<details><summary>${esc(f)}</summary>${f === 'requirements.md' ? requirementsTable(t) : mdDoc(t, ['Decision'])}</details>`).join('\n')}` : '';
  return page(data.title, fill(T('bet'), { title: esc(data.title), slug: esc(slug), cards, waiting, questions,
    sign: showSign ? `<h2>Sign</h2><div class="signbox">${signHtml}</div>` : '', tasks: tasksTable(root, slug), specs: specHtml, sections, raw }), opts);
}

export function renderAll(root, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), renderInbox(root, { readonly: true }));
  for (const s of st.listBets(root)) writeFileSync(join(outDir, `bet-${s}.html`), renderBet(root, s, { readonly: true }));
  return outDir;
}

// commitState: same audit trail as the CLI's state_commit (skipped with BRIDGIE_NO_COMMIT=1).
function commitState(root, msg) {
  if (process.env.BRIDGIE_NO_COMMIT === '1') return;
  const git = args => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    git(['add', '-A', '--', '.bridgie']);
    try { git(['diff', '--cached', '--quiet', '--', '.bridgie']); } catch { git(['commit', '-q', '-m', `bridgie: ${msg}`, '--', '.bridgie']); }
  } catch { /* not a git repository: nothing to commit */ }
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
            commitState(root, `decide ${slug} ${id}: ${answer} (surface)`);
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
