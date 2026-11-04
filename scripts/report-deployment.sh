#!/usr/bin/env bash
# Push step of the deployments ledger (docs/deployments-ledger.md, ADR 0015).
# Run at the end of an external deploy job (Azure DevOps, any CI with bash, openssl, curl, jq):
# records the deploy as a GitHub deployment with its final status. Idempotent: the same run and
# attempt are written once. Never prints the token.
#
# Environment:
#   GH_APP_ID, GH_INSTALLATION_ID, GH_KEY_FILE   deployment App (Deployments: read and write)
#   GH_OWNER, GH_REPO_NAME                       the GitHub repository (the mirror's origin)
#   SHA                                          deployed commit (same SHA as on GitHub)
#   ENV_NAME                                     GitHub environment name (dev, test, prod...)
#   STATE                                        success | failure
#   RUN_ID, RUN_URL, ATTEMPT                     the external run (ATTEMPT default 1)
#   FINISHED_AT                                  real end of the deploy, ISO 8601 UTC (required)
#   STARTED_AT, VERSION, PRODUCTION (true|false), SOURCE (default azure-devops)  optional
#   GH_API                                       default https://api.github.com
set -euo pipefail
set +x

: "${GH_APP_ID:?}" "${GH_INSTALLATION_ID:?}" "${GH_KEY_FILE:?}" "${GH_OWNER:?}" "${GH_REPO_NAME:?}"
: "${SHA:?}" "${ENV_NAME:?}" "${STATE:?}" "${RUN_ID:?}" "${RUN_URL:?}" "${FINISHED_AT:?}"
GH_API="${GH_API:-https://api.github.com}"
ATTEMPT="${ATTEMPT:-1}"
SOURCE="${SOURCE:-azure-devops}"
PRODUCTION="${PRODUCTION:-false}"
[[ "$STATE" == success || "$STATE" == failure ]] || { echo "STATE must be success or failure" >&2; exit 1; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA must be a full commit SHA" >&2; exit 1; }
[[ "$ATTEMPT" =~ ^[0-9]+$ ]] || { echo "ATTEMPT must be a number" >&2; exit 1; }

b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64)
claims=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now - 60)) $((now + 540)) "$GH_APP_ID" | b64)
signature=$(printf '%s.%s' "$header" "$claims" | openssl dgst -sha256 -sign "$GH_KEY_FILE" | b64)

# Token narrowed to this repository and to deployments: write.
token=$(curl -fsS -X POST "$GH_API/app/installations/$GH_INSTALLATION_ID/access_tokens" \
  -H "Authorization: Bearer $header.$claims.$signature" -H "Accept: application/vnd.github+json" \
  -d "$(jq -cn --arg r "$GH_REPO_NAME" '{repositories: [$r], permissions: {deployments: "write"}}')" |
  jq -r '.token // empty')
[[ -n "$token" ]] || { echo "could not obtain a GitHub token" >&2; exit 1; }
api() { curl -sS -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" "$@"; }
repo="$GH_API/repos/$GH_OWNER/$GH_REPO_NAME"

# Idempotency: the same source, run and attempt for this environment is one deploy.
existing=$(api -G "$repo/deployments" --data-urlencode "sha=$SHA" --data-urlencode "environment=$ENV_NAME" \
  --data-urlencode "per_page=100" |
  jq -r --arg s "$SOURCE" --arg r "$RUN_ID" --argjson a "$ATTEMPT" \
    '[.[] | select(.payload.ledger == 1 and .payload.source == $s and .payload.runId == $r and .payload.attempt == $a)] | first | .id // empty')
if [[ -n "$existing" ]]; then
  echo "already recorded (deployment $existing)"
  exit 0
fi

payload=$(jq -cn \
  --arg sha "$SHA" --arg env "$ENV_NAME" --arg src "$SOURCE" --arg run "$RUN_ID" --arg url "$RUN_URL" \
  --argjson attempt "$ATTEMPT" --arg started "${STARTED_AT:-}" --arg finished "$FINISHED_AT" \
  --arg version "${VERSION:-}" --argjson production "$PRODUCTION" \
  '{ref: $sha, environment: $env, auto_merge: false, required_contexts: [], transient_environment: false,
    production_environment: $production, description: ("Deployed by " + $src + " run " + $run)[0:140],
    payload: ({ledger: 1, source: $src, runId: $run, runUrl: $url, attempt: $attempt, finishedAt: $finished,
               declared: false, kind: "deploy"}
              + (if $version != "" then {version: $version} else {} end)
              + (if $started != "" then {startedAt: $started} else {} end))}')
response=$(api -w '\n%{http_code}' -X POST "$repo/deployments" -d "$payload")
code=${response##*$'\n'}
body=${response%$'\n'*}
if [[ "$code" == 422 ]]; then
  echo "commit not on GitHub: nothing recorded (is the mirror up to date?)"
  exit 0
fi
[[ "$code" == 201 ]] || { echo "deployment not created (HTTP $code)" >&2; exit 1; }
id=$(jq -r '.id' <<<"$body")
api -o /dev/null -X POST "$repo/deployments/$id/statuses" \
  -d "$(jq -cn --arg s "$STATE" --arg u "$RUN_URL" '{state: $s, log_url: $u}')"
echo "recorded deployment $id ($ENV_NAME, $STATE)"
