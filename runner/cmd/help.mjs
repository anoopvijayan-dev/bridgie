// bridgie help — every command, grouped by loop.
export const USAGE = `bridgie <command> [args]

Find     scout --from <folder> [--name N]   rank the problems in a folder of raw signals (bet-less)
Decide   bet new <slug> [--from <scout>/O<n>] [--risk R]   create a bet (optionally seeded from an opportunity)
         frame <slug> ["<idea>"]  draft the bet body; assumptions become questions
         research <slug>          competitors, prices, complaints from the web, every fact linked
         grill <slug> [--lenses]  stress-test the why; --lenses adds the three-lens board and chair
         lenses <slug>            the board on its own
         panel <slug> [--n N]     simulated buyer panel (objections and price range; not evidence)
         numbers <slug> [--template]   unit economics computed from numbers.yaml (required for money bets)
         evidence <slug>          plan real-world evidence; with material, synthesise and propose confidence
         decide <slug> <id> <answer> [--text "..."]
         sign <slug> [--kill | --more-evidence]
Build    shape | plan | build | run
Verify   verify
Accept   accept
Learn    learn
Tool     new <folder> [--lane L]   new project in one step        next (or just: bridgie)   what to do next
         init [--lane L]  status  open [slug] [--invite NAME]  doctor  setup  version  help
`;
export default async function help() { process.stdout.write(USAGE); }
