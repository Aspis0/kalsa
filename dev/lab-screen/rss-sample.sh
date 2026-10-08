#!/bin/sh
# Lab-only: samples the engine's resident set size (KB) every 2 s until it exits.
# The peak is the max of the file. RSS counts mapped weight pages the engine has
# touched, so it is the memory the process holds, not the file size.
# usage: rss-sample.sh <pidfile> <out.txt>
pid=$(cat "$1")
: > "$2"
while kill -0 "$pid" 2>/dev/null; do
  ps -o rss= -p "$pid" >> "$2" 2>/dev/null
  sleep 2
done
