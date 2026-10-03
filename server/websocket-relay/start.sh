#!/bin/sh
set -eu

node /opt/stapxs-relay/index.mjs &
relay_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

terminate() {
    kill "$relay_pid" "$nginx_pid" 2>/dev/null || true
}

trap terminate INT TERM

while kill -0 "$relay_pid" 2>/dev/null &&
    kill -0 "$nginx_pid" 2>/dev/null; do
    sleep 1
done

terminate
wait "$relay_pid" 2>/dev/null || true
wait "$nginx_pid" 2>/dev/null || true
exit 1
