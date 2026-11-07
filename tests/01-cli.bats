#!/usr/bin/env bats
load helpers

@test "bridgie version prints the VERSION file" {
  run bridgie version
  [ "$status" -eq 0 ]
  [ "$output" = "bridgie $(cat "$BRIDGIE_HOME/VERSION")" ]
}

@test "unknown command fails with a clear message" {
  run bridgie nosuchthing
  [ "$status" -ne 0 ]
  [[ "$output" == *"unknown command: nosuchthing"* ]]
}

@test "help lists the commands" {
  run bridgie help
  [ "$status" -eq 0 ]
  [[ "$output" == *"init"* ]]
  [[ "$output" == *"doctor"* ]]
}
