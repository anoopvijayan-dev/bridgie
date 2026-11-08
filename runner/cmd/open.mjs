// bridgie open [slug] [--port N] [--host H] [--invite NAME]... [--no-browser] [--static]
// Live: serves the decision surface on localhost and opens the browser with your access link.
import { join } from 'node:path';
import { renderAll, serve, openBrowser, LOOPBACK } from '../surface.mjs';
import { parseArgs, projectRoot, user } from '../cli/core.mjs';

export default async function open(argv) {
  const a = parseArgs(argv, { port: 'value', host: 'value', invite: 'list', 'no-browser': 'bool', static: 'bool' }, 'open');
  const slug = a._[0];
  const root = projectRoot();
  if (a.static) { process.stdout.write(`${renderAll(root, join(root, '.bridgie', 'ui'))}\n`); return; }
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
