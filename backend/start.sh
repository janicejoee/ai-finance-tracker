#!/usr/bin/env bash

cd "$(dirname "$0")"

if [ -f ".venv/bin/python" ]; then
  exec .venv/bin/python server.py
fi

exec python3 server.py