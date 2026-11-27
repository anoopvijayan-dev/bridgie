// bridgie bet new <slug> [--title T] [--lane L] [--risk R] [--from <scout>/O<n>]
// bridgie bet set <slug> [--risk R] [--owner NAME] [--time 6w] [--tokens-usd N]
//                  [--metric M --baseline B --target T --read-by YYYY-MM-DD] [--kill "..."]... --reason "..." [--relayed]
import * as st from '../state.mjs';
import { seedBetFromOpportunity } from '../decide.mjs';
import { actor, die, log, parseArgs, projectRoot, stateCommit, user, rel } from '../cli/core.mjs';

// set: correct an unsigned bet's risk, owner or appetite. Like a decision, it is the owner's call, so
// inside an agent the command must say it relays a person (--relayed) and the log records that.
function set(rest) {
  const a = parseArgs(rest, { risk: 'value', owner: 'value', time: 'value', 'tokens-usd': 'value', metric: 'value', baseline: 'value', target: 'value', 'read-by': 'value', kill: 'list', reason: 'value', relayed: 'bool' }, 'bet set');
  const slug = a._[0];
  if (!slug) die('bet set: slug required');
  const changes = {};
  if (a.risk !== undefined) changes.risk = a.risk;
  if (a.owner !== undefined) { if (!String(a.owner).trim()) die('bet set: --owner needs a name'); changes.owner = String(a.owner).trim(); }
  if (a.time !== undefined) { if (!/^\d+[dw]$/.test(a.time)) die(`bet set: --time must look like 10d or 6w (got "${a.time}")`); changes.time = a.time; }
  if (a['tokens-usd'] !== undefined) {
    const n = Number(a['tokens-usd']);
    if (!Number.isFinite(n) || n < 0) die(`bet set: --tokens-usd must be a number of dollars (got "${a['tokens-usd']}")`);
    changes.tokens_usd = n;
  }
  for (const k of ['metric', 'baseline', 'target']) if (a[k] !== undefined) changes[k] = String(a[k]).trim();
  if (a['read-by'] !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a['read-by']) || Number.isNaN(Date.parse(a['read-by']))) die(`bet set: --read-by must be a date as YYYY-MM-DD (got "${a['read-by']}")`);
    changes.read_by = a['read-by'];
  }
  if (a.kill) changes.kill = a.kill.map(k => String(k).trim()).filter(Boolean);
  const who = actor(a.relayed);
  if (who.via.agent && !a.relayed) die(`bet set changes what the bet is held to, and this command is running inside an agent (${who.via.agent}). If ${who.by} told you this change, pass --relayed (the log will say it came through ${who.via.agent}); otherwise ask them to run it.`);
  const root = projectRoot();
  let done;
  try { done = st.betSet(root, slug, changes, { reason: a.reason, ...who }); } catch (e) { die(e.message); }
  stateCommit(root, `bet set ${slug}: ${done.join('; ')}`);
  log(`${slug}: ${done.join('; ')}`);
}

export default async function bet(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'set') return set(rest);
  if (sub !== 'new') die(`bet: expected 'new <slug>' or 'set <slug>' (got '${sub || 'nothing'}')`);
  const a = parseArgs(rest, { title: 'value', lane: 'value', risk: 'value', from: 'value' }, 'bet new');
  const slug = a._[0];
  if (!slug) die('bet new: slug required');
  const root = projectRoot();
  const lane = a.lane || st.loadPolicy(root).default_lane || 'engineering';
  const risk = a.risk || 'none';
  let file;
  try { file = st.betNew(root, slug, { title: a.title || slug, lane, risk, owner: user() }); } catch (e) { die(e.message); }
  if (a.from) {
    try { seedBetFromOpportunity(root, slug, a.from); } catch (e) { die(e.message); }
    stateCommit(root, `bet new ${slug} (from ${a.from})`);
    log(`created ${rel(root, file)} from ${a.from} (lane: ${lane}, risk: ${risk}). Next: bridgie frame ${slug}`);
    return;
  }
  stateCommit(root, `bet new ${slug}`);
  log(`created ${rel(root, file)} (lane: ${lane}, risk: ${risk}). Fill in the body, then: bridgie frame ${slug} "<idea>"   or   bridgie grill ${slug}`);
}
