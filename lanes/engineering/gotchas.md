# Engineering lane gotchas
- 2026-08: a shared-contract field change ran seven review rounds without the web consumer ever appearing in the packet; always trace consumers with a command, not memory.
- 2026-09: a diff packet that included the run directory grew to 3.1M characters and the reviewer refused it; packets exclude `.bridgie/runs/**`.
- 2026-08: a QA seat without repository access invented a finding with a line number that did not exist; verifiers must read the repo or abort.
