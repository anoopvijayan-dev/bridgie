# shellcheck shell=bash
# bridgie seat-run <slug> <loop/seat> [--task T] — run one seat and print its run directory.
# shellcheck source=../lib/seat.sh
source "$BRIDGIE_HOME/runner/lib/seat.sh"

cmd_seat_run() {
  [[ $# -ge 2 ]] || die "usage: bridgie seat-run <slug> <loop/seat> [--task T]"
  run_seat "$@"
}
