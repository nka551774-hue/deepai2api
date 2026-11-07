#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = 0 ]; then
  if [ -L "$data_dir" ]; then
    echo 'DATA_DIR must be a directory, not a symbolic link' >&2
    exit 1
  fi
  mkdir -p "$data_dir"
  for state_file in "$data_dir/state.json" "$data_dir/state.json.tmp"; do
    if [ -L "$state_file" ] || { [ -e "$state_file" ] && [ ! -f "$state_file" ]; }; then
      echo 'State files must be regular files, not symbolic links or devices' >&2
      exit 1
    fi
    if [ -f "$state_file" ]; then
      chown app:app "$state_file"
    fi
  done
  # Only the state directory and its two files need ownership changes.
  # Keep other bind-mounted content and its permissions intact.
  chown app:app "$data_dir"
  exec su-exec app "$@"
fi

exec "$@"
