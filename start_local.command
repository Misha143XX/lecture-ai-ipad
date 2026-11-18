#!/bin/bash
set -e
cd "$(dirname "$0")"
echo "Lecture AI iPad Preview: http://localhost:8765"
(sleep 1; open 'http://localhost:8765') >/dev/null 2>&1 &
python3 -m http.server 8765 --bind 127.0.0.1
