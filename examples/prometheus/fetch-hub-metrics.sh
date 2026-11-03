#!/bin/sh
# Copies the hub's metrics file into node_exporter's textfile collector directory.
# Run it from cron or a systemd timer (every 15 minutes is plenty). Docs: docs/outputs.md.
#
#   HUB_METRICS_URL               https://<host>/<base>/data/metrics/hub.prom   (required)
#   TEXTFILE_DIR                  node_exporter --collector.textfile.directory  (required)
#   CF_ACCESS_CLIENT_ID           Cloudflare Access service token id             (optional)
#   CF_ACCESS_CLIENT_SECRET_FILE  file holding the service token secret          (optional)
#
# The previous file is replaced only by an HTTP 200 response that looks like a metrics file
# (it starts with "# HELP"). A redirect to a login page, an HTML page or any error keeps the
# previous file and exits non-zero. The secret is never printed.
set -eu

: "${HUB_METRICS_URL:?set HUB_METRICS_URL}"
: "${TEXTFILE_DIR:?set TEXTFILE_DIR}"

tmp="$TEXTFILE_DIR/hub.prom.$$"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

if [ -n "${CF_ACCESS_CLIENT_ID:-}" ]; then
  : "${CF_ACCESS_CLIENT_SECRET_FILE:?set CF_ACCESS_CLIENT_SECRET_FILE with CF_ACCESS_CLIENT_ID}"
  # The secret goes through a curl config file on stdin, never on the command line.
  status=$(
    {
      printf 'header = "CF-Access-Client-Id: %s"\n' "$CF_ACCESS_CLIENT_ID"
      printf 'header = "CF-Access-Client-Secret: %s"\n' "$(cat "$CF_ACCESS_CLIENT_SECRET_FILE")"
    } | curl --fail --silent --show-error --max-time 30 --config - \
      --output "$tmp" --write-out '%{http_code}' "$HUB_METRICS_URL"
  )
else
  status=$(curl --fail --silent --show-error --max-time 30 \
    --output "$tmp" --write-out '%{http_code}' "$HUB_METRICS_URL")
fi

if [ "$status" != "200" ]; then
  echo "fetch-hub-metrics: HTTP $status, keeping the previous file" >&2
  exit 1
fi
if [ "$(head -c 6 "$tmp")" != "# HELP" ]; then
  echo "fetch-hub-metrics: not a metrics file, keeping the previous file" >&2
  exit 1
fi

mv "$tmp" "$TEXTFILE_DIR/hub.prom"
