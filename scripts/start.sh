#!/bin/bash
set -e

MAX_RETRIES=15
RETRY_DELAY=5

echo "Waiting for database to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES: running prisma migrate deploy..."
  if npx prisma migrate deploy; then
    echo "Migrations applied successfully."
    break
  fi

  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: Could not reach database after $MAX_RETRIES attempts. Exiting."
    exit 1
  fi

  echo "Database not ready. Retrying in ${RETRY_DELAY}s..."
  sleep $RETRY_DELAY
done

exec npm start -- -p "${PORT:-3000}"
