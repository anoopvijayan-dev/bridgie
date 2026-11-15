// bridgie open [slug] [--port N] [--host H] [--invite NAME]... [--no-browser] [--static]
//              [--public --bet SLUG... [--out DIR]]   progress page for the named bets only, safe to publish
// Live: serves the decision surface on localhost and opens the browser with your access link.
import { join, resolve } from 'node:path';
import { renderAll, serve, openBrowser, LOOPBACK } from '../surface.mjs';
import { parseArgs, projectRoot, user, die } from '../cli/core.mjs';

export default async function open(argv) {
  const a = parseArgs(argv, { port: 'value', host: 'value', invite: 'list', 'no-browser': 'bool', static: 'bool', public: 'bool', bet: 'list', out: 'value' }, 'open');
  const slug = a._[0];
  const root = projectRoot();
  if (a.static || a.public) {
    const out = a.out ? resolve(a.out) : join(root, '.bridgie', a.public ? 'public' : 'ui');
    try { process.stdout.write(`${renderAll(root, out, { public: !!a.public, bets: a.bet })}\n`); } catch (e) { die(`open: ${e.message}`); }
    return;
  }
  const host = a.host || '127.0.0.1';
  const { links } = await serve(root, { port: Number(a.port || 0), host, by: user(), invites: a.invite || [] });
  const path = slug ? `/bet/${slug}` : '/';
  const link = l => l.url.replace('/?t=', `${path}?t=`);
  if (!a['no-browser']) openBrowser(link(links[0]));
  console.log(`OPEN ${link(links[0])}`);
  console.log(`Open ${link(links[0])}  (your link, as ${links[0].who}; Ctrl-C to stop)`);
  for (const l of links.slice(1)) console.log(`Link for ${l.who}: ${link(l)}`);
  if (!LOOPBACK.has(host)) console.log('Listening beyond this machine over plain HTTP: give each link only to its person; anyone holding a link acts as that person.');
  await new Promise(() => {});   // serve until Ctrl-C
}
