#!/bin/sh
# ES modules won't load over file://, so serve the folder over HTTP.
# Usage: ./serve.sh [port]
port="${1:-8000}"
echo "Serving on http://localhost:${port}  (Ctrl+C to stop)"
exec python3 -m http.server "${port}"
