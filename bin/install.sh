#!/bin/sh
# Kept for old instructions: setup is plain Node now and works the same on every OS.
#   node bin/bridgie.mjs setup        (PowerShell, cmd, Git Bash, macOS, Linux)
d=${0%/*}; [ "$d" = "$0" ] && d=.
exec node "$d/bridgie.mjs" setup "$@"
