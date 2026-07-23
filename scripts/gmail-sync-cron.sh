#!/bin/sh
# Called by launchd (com.nqlogistics.gmailsync) every 5 minutes to trigger Gmail sync
# without anyone opening the web app. Reads CRON_SECRET from .env so the secret lives
# in exactly one place; the API's Bearer check is what authorizes this call.
set -eu
cd "$(dirname "$0")/.."

SECRET=$(grep '^CRON_SECRET=' .env | cut -d= -f2- | tr -d '"')
if [ -z "$SECRET" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') CRON_SECRET không có trong .env — bỏ qua." >&2
  exit 1
fi

# A backlog-clearing run takes 4-5 minutes (150 messages/run), so allow up to 15. launchd
# never starts a second instance of the same job while one is running, and the route returns
# 202 immediately if a sync is already in progress — so long runs can't pile up.
HTTP_CODE=$(curl -s -o /tmp/nqlogistics-gmailsync-last.json -w "%{http_code}" \
  --max-time 900 \
  -X POST http://localhost:3000/api/gmail/sync \
  -H "Authorization: Bearer $SECRET")

echo "$(date '+%Y-%m-%d %H:%M:%S') sync HTTP $HTTP_CODE"
case "$HTTP_CODE" in
  200|202) ;;
  *) cat /tmp/nqlogistics-gmailsync-last.json >&2 ;;
esac
