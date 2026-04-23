#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "▸ installing dashboard bridge deps..."
cd dashboard
npm install --silent

echo "▸ installing frontend deps..."
cd frontend
npm install --silent

cd ../..
echo
echo "✓ done. Start the dashboard with:"
echo "    cd dashboard && npm run dev"
echo
echo "Then open http://localhost:3100"
