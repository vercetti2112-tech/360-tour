#!/bin/sh
set -e
# Lần chạy đầu (DB trống) và SEED_DEMO=1: tạo dữ liệu demo để trải nghiệm ngay.
if [ "${SEED_DEMO:-1}" = "1" ]; then
  EMPTY=$(node --no-warnings -e "import('./server/db.js').then(({get})=>console.log(get('SELECT COUNT(*) n FROM projects').n===0?1:0))")
  if [ "$EMPTY" = "1" ]; then
    echo "[entrypoint] DB trống -> tạo dữ liệu demo..."
    node --no-warnings server/seed.js
  fi
fi
exec node --no-warnings server/index.js
