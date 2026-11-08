// bridgie lenses <slug> — three board members (offer, moat, product lenses) and a chair.
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as st from '../state.mjs';
import { writeMemo, writeBoard, parseMemo, LENSES } from '../decide.mjs';
import { runSeat } from '../cli/seat.mjs';
import { die, log, projectRoot, stateCommit } from '../cli/core.mjs';
import { decideStatusOk } from './research.mjs';

export default async function lenses(argv) {
  const slug = argv[0];
  if (!slug) die('usage: bridgie lenses <slug>');
  const root = projectRoot();
  decideStatusOk(root, slug, 'lenses');
  const packet = mkdtempSync(join(tmpdir(), 'bridgie-lenses-'));
  mkdirSync(join(packet, 'memos'));
  try {
    for (const lens of LENSES) {
      log(`board member: ${lens} lens`);
      const runDir = await runSeat(slug, `decide/lens-${lens}`, { root });
      try { writeMemo(packet, lens, join(runDir, 'seat-output.json')); } catch (e) { die(`${e.message}\nlenses: the ${lens} memo was rejected (see ${runDir})`); }
    }
    log('chair');
    const runDir = await runSeat(slug, 'decide/chair', { root, packet });
    let board;
    try {
      const memos = LENSES.map(l => parseMemo(readFileSync(join(runDir, 'memos', `${l}.md`), 'utf8'), l));
      board = writeBoard(root, slug, memos, join(runDir, 'seat-output.json'));
    } catch (e) { die(`${e.message}\nlenses: chair output rejected (see ${runDir})`); }
    const ids = st.ingestQuestions(root, slug, join(runDir, 'seat-output.json'), basename(runDir));
    stateCommit(root, `lenses ${slug}`);
    log(`board: ${board.vote} (average ${board.average_score}/10); ${ids.length} question(s) raised. Read it: bridgie open ${slug}`);
  } finally { rmSync(packet, { recursive: true, force: true }); }
}
