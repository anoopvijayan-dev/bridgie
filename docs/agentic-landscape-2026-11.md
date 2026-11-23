# Agentic software development, late 2026: where Bridgie stands

Research done on 2026-11-23 to place Bridgie against current practice and to choose what to build next.

**How far to trust this.** Only Anthropic/Claude pages and raw GitHub could be opened directly; those
sources are marked †. Everything else comes from search-result summaries of the linked pages, not the
pages themselves. Hosts that could not be opened are listed in section C. An "ahead" rating means no
comparable was found, which is weaker than none existing.

**Since this was written:** parallel builds of independent tasks were added to Bridgie (0.7.0), in the
shape finding 2 recommends: a dependency graph, declared file ownership (`touches`), one-at-a-time
verification and merging that brings each task up to date first. The placement table reflects that.

## Findings

### 1. Spec-driven development

- **Common flow:** constitution/steering, then spec, plan, tasks, implement. The [Spec Kit README](https://github.com/github/spec-kit)† (read 2026-11-23) now adds a `converge` step and bundled `bug` and `assess` extensions; `assess` runs intake, research, define, shape, decide.
- **Kiro** derives property-based tests from EARS requirements ([Kiro docs](https://kiro.dev/docs/specs/correctness/), undated; GA reported as 7 May 2026).
- **OpenSpec** uses delta specs (ADDED/MODIFIED/REMOVED) that merge into living specs on archive, plus brownfield onboarding ([repo](https://github.com/Fission-AI/OpenSpec), v1.3.1, Apr 2026).
- **Weaknesses.** Thoughtworks rates Spec Kit and OpenSpec "Assess", citing instruction bloat leading to context rot and long specs that are hard to review ([Radar](https://www.thoughtworks.com/radar/languages-and-frameworks/github-spec-kit), Apr 2026). A paper argues spec-first tools let specs go stale ([arXiv 2606.27045](https://arxiv.org/pdf/2606.27045), Jun 2026). BMAD v6 is criticised as heavy, with 50+ commands ([blog](https://asantos2000.github.io/blog/post-3/), 2026).

### 2. Parallel execution

- **Claude Code agent teams** (still experimental): shared task list with dependencies, file-lock claiming, mailboxes. The docs say start with 3–5 teammates, give each its own files ("two teammates editing the same file leads to overwrites"), and gate with `TaskCompleted` hooks ([docs](https://code.claude.com/docs/en/agent-teams)†, read 2026-11-23).
- **Anthropic's C compiler:** 16 agents, lock files, a container each, frequent merge conflicts. CI had to be added to stop regressions, and the verifier had to be "nearly perfect". Cost was about $20k ([post](https://www.anthropic.com/engineering/building-c-compiler)†, 5 Feb 2026).
- **Cursor:** shared locks failed (20 agents ran at the throughput of 2–3). A planner/worker hierarchy with non-communicating workers worked ([scaling-agents](https://cursor.com/blog/scaling-agents), 14 Jan 2026; [self-driving codebases](https://cursor.com/blog/self-driving-codebases), 5 Feb 2026).
- **Factory Missions** deliberately runs one worker or validator at a time ([architecture post](https://factory.ai/news/missions-architecture), 2026).
- **Devin** fans out to managed Devins in separate VMs ([Cognition](https://cognition.ai/blog/devin-can-now-manage-devins), Mar 2026).
- **Gas Town** has a dedicated merge agent, the Refinery ([repo](https://github.com/gastownhall/gastown), v1.0 Apr 2026).
- **OpenAI Symphony** uses the issue tracker as control plane ([post](https://openai.com/index/open-source-codex-orchestration-symphony), 27 Apr 2026).
- **Evidence on speedups:** no controlled data found. CooperBench found two cooperating agents about 30% less successful than one agent doing both tasks ([arXiv 2601.13295](https://arxiv.org/abs/2601.13295), Jan 2026, on 2025 models). METR calls its own 2026 productivity estimate unreliable ([METR](https://metr.org/blog/2026-02-24-uplift-update/), 24 Feb 2026). Practitioners say the bottleneck moves to review and testing ([Willison](https://simonwillison.net/2026/Apr/2/lennys-podcast/), 2 Apr 2026).

### 3. Verification and review

- **Separate the judge from the builder, and calibrate it.** Anthropic says an untuned evaluator "talks itself into approving"; it must be tuned by reading its logs and adding few-shot examples ([harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)†, 24 Mar 2026).
- **Claude Code Review:** parallel finder agents plus a verification step. Under 1% of findings are marked incorrect internally, at $15–25 per review ([post](https://claude.com/blog/code-review)†, 9 Mar 2026, now GA).
- **AI reviewers still miss most defects.** The top grounded F1 on GitHub's ReviewBench is 40.1% ([GitHub](https://github.blog/ai-and-ml/github-copilot/reviewbench-an-open-benchmark-for-ai-code-review/), Oct 2026). Qodo's injected-bug benchmark (580 issues in 100 PRs) has a best F1 of 60.1%, vendor-run ([Qodo](https://qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review), 2026).
- **Agent-written tests have weak assertions** ([SWE Atlas](https://arxiv.org/pdf/2605.08366), May 2026). Thoughtworks recommends mutation testing on changed code as the guard ([Radar](https://www.thoughtworks.com/radar/techniques/mutation-testing), Nov 2026).
- **Public benchmarks are weak guides.** OpenAI stopped reporting SWE-bench Verified ([OpenAI](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/), 23 Feb 2026). Epoch rates SWE-bench Pro "Flawed", with about 30% of tasks broken ([Epoch](https://epoch.ai/benchmarks/swe-bench-pro/review), Sep 2026).
- **Holdout scenarios** kept hidden from builders: StrongDM ([Willison](https://simonwillison.net/2026/Feb/7/software-factory/), 7 Feb 2026).

### 4. Harness and context

- **AGENTS.md as a short map**, with the app bootable per worktree and agent-to-agent review ([OpenAI harness engineering](https://openai.com/index/harness-engineering/), 11 Feb 2026).
- **Agents may only flip status flags** in a feature list; progress notes carry fresh sessions ([Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)†, 26 Nov 2025).
- **Remove scaffolding as models improve** ([harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)†, 24 Mar 2026).
- **Zero-exception rules belong in hooks, not instruction files.** Review in a fresh context, and tell reviewers to skip style because "a reviewer asked to find problems will always find something" ([Claude Code best practices](https://code.claude.com/docs/en/best-practices)†, read 2026-11-23).
- **Agent Skills** is now a foundation standard with 70+ platforms ([Anthropic](https://www.anthropic.com/news/donating-agent-skills-to-the-agentic-ai-foundation)†, 22 Oct 2026).

### 5. Governance and safety

- **Approval fatigue is measured.** Users accept 93% of prompts. Anthropic's auto-mode classifier blocks 0.4% of benign actions but misses 17% of real overeager ones, and is "not a drop-in replacement for careful human review" ([post](https://www.anthropic.com/engineering/claude-code-auto-mode)†, 25 Mar 2026).
- **Agent messages never count as consent** ([agent teams docs](https://code.claude.com/docs/en/agent-teams)†).
- **Sandboxes:** OS-level with a network allowlist in Claude Code, off by default ([docs](https://code.claude.com/docs/en/sandboxing)†). MicroVMs are available via [Docker Sandboxes](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/) (2026).
- **Provenance:** Agent Trace is an RFC (v0.1.0) for line-level AI attribution ([repo](https://github.com/cursor/agent-trace), Jan 2026). No settled SLSA/in-toto convention for agent commits was found; the nearest is [Red Hat on agent cards](https://next.redhat.com/2026/08/07/supply-chain-provenance-for-ai-agent-identity/) (7 Aug 2026).
- **Policy-as-code:** [AWS AgentCore Policy](https://aws.amazon.com/about-aws/whats-new/2026/03/policy-amazon-bedrock-agentcore-generally-available) (Cedar) went GA on 3 Mar 2026.
- **SOC 2:** CC8.1 is technology-neutral. Auditors want an approver who is not the author plus tamper-evident logs, and are "improvising" without AICPA guidance ([CSA note](https://labs.cloudsecurityalliance.org/research/csa-research-note-soc2-ai-controls-gap-20260830-csa-styled/), 30 Aug 2026).
- **EU AI Act:** Article 50 transparency applied from 2 Aug 2026 ([Cooley](https://www.cooley.com/news/insight/2026/2026-08-03-eu-ai-act-transparency-obligations-take-effect-2-august-2026), 3 Aug 2026). Commentary places coding assistants outside high-risk.
- **Prompt injection:** architectural limits (lethal trifecta, Rule of Two) beat filters ([Help Net Security on OWASP](https://helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures), 11 Jun 2026).

### 6. Observability and cost

- **OpenTelemetry GenAI conventions** are still "Development" status ([agent spans spec](https://raw.githubusercontent.com/open-telemetry/semantic-conventions-genai/main/docs/gen-ai/gen-ai-agent-spans.md), 2026).
- **Claude Code** exports OTel cost and token metrics (traces in beta), and headless JSON returns `total_cost_usd` with a per-model breakdown ([monitoring](https://code.claude.com/docs/en/monitoring-usage)†, [headless](https://code.claude.com/docs/en/headless)†).
- **Langfuse** traces Claude Code and Codex via Stop hooks ([guide](https://langfuse.com/resources/engineering/coding-agent-tracing), Jul 2026).
- **Routing** by phase cut one workflow from about $100 to $15–20 per run; the suggested metric is cost per accepted task ([Arize](https://arize.com/blog/how-i-cut-coding-agent-costs-with-model-harness-routing/), 2026, vendor). Another benchmark found routing 74% cheaper but about 6 points less accurate ([LangChain/Switchyard](https://langchain.com/blog/switchyard-agent-routing-benchmark), 2026).

### 7. Interop

- **MCP 2026-07-28:** stateless core, Tasks moved to an extension, OAuth/OIDC alignment ([Claude blog](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude)†, 28 Jul 2026).
- **A2A:** v1.0 with signed agent cards ([Google](https://opensource.googleblog.com/2026/04/a-year-of-open-collaboration-celebrating-the-anniversary-of-a2a.html), Apr 2026); joined the Agentic AI Foundation ([Axios](https://axios.com/2026/08/17/a2a-agentic-ai-foundation-open-ai-standards), 17 Aug 2026).
- **ACP:** registry launched 28 Jan 2026; Copilot CLI, Codex, Claude and Cursor are reported as supported ([Zed](https://zed.dev/acp)).

### 8. Durable execution

- Engines replay only the in-flight step ([comparison](https://hackernoon.com/durable-execution-for-ai-agents-langgraph-dbos-inngest-and-temporal-compared), 2026).
- Thoughtworks flags [ignoring durability in agent workflows](https://www.thoughtworks.com/radar/techniques/ignoring-durability-in-agent-workflows) (2026).
- Nothing specific to coding CLIs was found.

### 9. Company-OS comparables

- **[Paperclip](https://paperclip.ing/docs)** (Mar 2026): org chart, budgets, goals, audit log.
- **Spec Kit `assess`**: the closest to bet-shaping.
- **[gstack](https://github.com/garrytan/gstack)** (2026): office-hours, CEO/eng plan review, review, ship, retro.
- **BMAD**: analyst, PM and architect roles.
- **Symphony** and **StrongDM's factory**: build-side only.
- None was found that combines kill criteria, human sign-off bound to a commit, and a mandatory cross-vendor reviewer.

## A. Placement

| Practice area | What leaders do now | Bridgie | Most valuable next step |
|---|---|---|---|
| Decide before build | Spec Kit `assess`, gstack plan reviews; no kill criteria found | Ahead (as far as found) | Publish the bet schema as a reusable skill |
| Spec to plan to tasks | EARS, steering, requirement-to-task traceability (Kiro, Spec Kit) | On par | Light track for low-risk bets |
| Living specs | Delta specs merged on archive (OpenSpec); `converge` (Spec Kit) | Behind | Delta specs plus a drift check at accept |
| Parallel execution | Dependency-aware task list, file ownership, hierarchy, 3–5 workers | Matches the recommended shape since 0.7.0; not yet proven on a real bet | Overlap verification with building; run it on a real bet |
| Isolation | OS sandbox with network allowlist; microVM or container per agent | Behind | Turn on vendor sandboxes by default for build agents |
| Runner-run tests | CI as hard gate; property tests (Kiro); mutation testing (Radar) | On par; ahead on tiers, missing mutation | Mutation score on changed code |
| Independent review | Fresh-context reviewer plus verification step; cross-vendor optional | On par (stricter policy, benefit unproven) | Add a finding-verification pass |
| Reviewer calibration | Seeded-bug sets; log-based tuning | Missing | Seeded-bug eval per reviewer model |
| Human approval and audit | Approver not the author; agent messages are not consent | Ahead of the coding tools surveyed | Export the acceptance package as an in-toto attestation |
| Code provenance | Agent Trace RFC; nothing settled | On par (own format) | Emit Agent Trace records |
| Cost and observability | Per-run $ and tokens; OTel; cost per accepted task | Behind | Capture `total_cost_usd` and usage from CLI JSON |
| Model routing | Frontier model plans, cheaper models execute | Partial (quota fallback only) | Route by task size |
| Memory | Short index plus on-demand topic files | Behind | Scoped gotchas loaded per path |
| Interop | MCP, ACP, Agent Skills | Missing | Ship as Agent Skills; MCP status/decision server later |
| CI/PR | Agents open PRs; review bots on PRs | Missing | Optional PR carrying the acceptance package, never auto-merged |
| Durability | Step-level replay | On par for a local CLI | Idempotent step keys in an append-only journal |

## B. Improvements, by value for effort

1. **Capture tokens and dollars per task** from CLI JSON and report cost per accepted task; it is already in Claude Code's output (finding 6).
2. **Seeded-bug eval for each reviewer model**, because the best public reviewers score 40–60% F1 and Anthropic says evaluators need calibration (finding 3).
3. **Parallelism with file ownership, a dependency graph and a serial merge queue that re-runs verify**, capped at 3–5 (finding 2). *Done in 0.7.0.*
4. **Default-on sandbox and network allowlist for build agents**, since worktrees isolate nothing and even Anthropic's classifier misses 17% (finding 5).
5. **Mutation testing on changed code as a verify tier**, the named guard against always-green agent tests (finding 3).
6. **A light track for low-risk bets**, since weight on small changes is the most repeated criticism of spec-driven tools (finding 1).
7. **Delta specs merged at accept, plus a drift check**, to avoid stale specs (finding 1).
8. **Reviewer finding-verification pass with a "skip style" rule**, to cut false positives the way Claude Code Review does (findings 3 and 4).
9. **Export acceptance as in-toto plus Agent Trace, with an optional PR output**, putting evidence where SOC 2 auditors look (finding 5).
10. **Package the flow as Agent Skills and add OTel spans behind a flag**; skills are stable and widely adopted, the OTel conventions are not yet (findings 6 and 7).

The working order is 1, 2, 4, 5, then 6 to 10. Items 1 to 5 are done in 0.7.0: tokens and cost per task, `bridgie eval reviewer`, parallel builds, sandboxed build seats, and the mutation tier.

## C. Unverified or conflicting

- **Hosts that could not be opened**, so their pages were not read directly: martinfowler.com, arxiv.org, openai.com, cursor.com, github.blog, modelcontextprotocol.io, opentelemetry.io, aaif.io, axios.com.
- **Parallel speedups:** no controlled data. Cursor's and OpenAI's figures are self-reported, and Symphony's gain is given as "500%" in one version of the post and "sixfold" in another.
- **Cross-vendor review:** evidence conflicts. One preprint found 56.5% of defects caught by only one model ([Zenodo](https://zenodo.org/records/20519585), 3 Jun 2026). Another found a same-model fresh session matched cross-model on code ([arXiv 2610.01471](https://arxiv.org/abs/2610.01471), Oct 2026).
- **Review benchmarks:** vendor-run and mutually inconsistent (Greptile, Qodo, GitHub, Martian).
- **Secondary-only claims:** Kiro GA date, Jules wind-down, Tessl's "pivot", Radar Vol. 35 ring assignments, EU high-risk delay to Dec 2027, and a COSO AI change-management guide.
- **Agent commits:** no source found for a standard on signed agent commits, or for AICPA guidance on AI-written code.
- **Fowler taxonomy:** the article on spec-first / spec-anchored / spec-as-source could not be opened, so it was not relied on.
- **"Ahead" ratings** rest on not finding a comparable, which is weaker than finding that none exists.

## Bridgie's own measurement (parallel builds)

Simulated from the recorded timings and the real dependency graph of a 41-task money-risk bet (23.5 h
building, 6.8 h reviewing; not a rerun):

| Tasks built at once | Agent time | Speedup |
|---|---|---|
| 1 (as it ran) | 30.4 h | 1.0x |
| 2 | 23.0 h | 1.3x |
| 3 | 19.3 h | 1.6x |
| 4 or more | about 18.5 h | 1.65x |

Verification is one task at a time and the longest dependency chain is 11.8 h, so the curve flattens. A
scheduler that also verified while building would reach about 2.2x.
