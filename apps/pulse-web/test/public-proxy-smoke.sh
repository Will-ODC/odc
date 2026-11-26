#!/bin/sh
# The public proxy end to end (ADR-0048 decision 11): the built web image in
# front of the real API image and a throwaway Postgres, checked only through
# nginx's port, as a browser or an AI app would reach a deployment.
#
# Run from the repository root after building both images:
#   sh apps/pulse-web/test/public-proxy-smoke.sh pulse-web:ci pulse-api:ci
# No mail is sent: nothing here asks for a sign-in link.
set -eu
web_image=${1:-pulse-web:ci}
api_image=${2:-pulse-api:ci}
prefix="pulse-proxy-smoke-$$"
network="$prefix-net"
db="$prefix-db"
api="$prefix-api"
web="$prefix-web"
work=$(mktemp -d)

cleanup() {
    docker rm -f "$web" "$api" "$db" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

fail() {
    echo "FAIL: $*" >&2
    docker logs "$api" 2>&1 | tail -20 >&2 || true
    exit 1
}

docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
    -e POSTGRES_USER=pulse -e POSTGRES_PASSWORD=pulse -e POSTGRES_DB=pulse \
    --tmpfs /var/lib/postgresql/data postgres:17 >/dev/null

# The web container first: its published port decides the public origin the
# API is configured with, and nginx resolves the API name per request.
# Real-IP mode, as on Railway, so the test can play distinct clients.
docker run -d --name "$web" --network "$network" -p 127.0.0.1::8080 \
    -e PULSE_API_UPSTREAM=api:8080 -e PULSE_REAL_IP_HEADER=X-Real-IP \
    "$web_image" >/dev/null
port=$(docker port "$web" 8080/tcp | head -n 1 | sed 's/.*://')
origin="http://127.0.0.1:$port"
base="$origin"

attempts=0
until docker exec "$db" pg_isready -U pulse -d pulse >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 60 ] || fail 'Postgres did not start'
    sleep 1
done

# Throwaway secrets; the mail key is never used because no link is asked for.
docker run -d --name "$api" --network "$network" --network-alias api \
    -e PULSE_DATABASE_URL=postgres://pulse:pulse@"$db":5432/pulse \
    -e PULSE_WEB_ORIGIN="$origin" \
    -e PULSE_SESSION_SECRET="smoke-session-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
    -e PULSE_CONFIRMATION_KEY="smoke-confirm-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
    -e PULSE_RESEND_API_KEY=re_smoke_never_used \
    -e PULSE_MAIL_FROM='Pulse smoke <smoke@example.test>' \
    "$api_image" >/dev/null

# Ready when the API answers through nginx (a missing poll is its own 404).
attempts=0
until [ "$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "$base/api/polls/smoke-none" || true)" = 404 ]; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 90 ] || fail 'API not reachable through nginx'
    sleep 1
done

# One public-vote poll with one named vote, written by SQL: creation still
# refuses "public" until ADR-0048 step 4b.
docker exec -i "$db" psql -q -v ON_ERROR_STOP=1 -U pulse -d pulse >/dev/null <<'SQL'
insert into voter (id, community, assurance, claimed_at, proof_emails_opt_in, session_generation)
  values ('smoke-voter', null, 'email', now(), false, 0);
insert into member_profile (voter_id, public_id, display_name, bio, visible, created_at, updated_at)
  values ('smoke-voter', gen_random_uuid(), 'Ada Smoke', '', true, now(), now());
insert into polls (id, question, method, created_at, accepts_suggestions, vote_privacy)
  values ('smoke-public', 'Smoke test?', 'single', now(), false, 'public');
insert into poll_choice (id, poll_id, position, label) values
  (gen_random_uuid(), 'smoke-public', 0, 'Yes'),
  (gen_random_uuid(), 'smoke-public', 1, 'No');
insert into vote (id, poll_id, voter_id, cast_at, confirmation)
  values ('00000000-0000-4000-8000-00000000a001', 'smoke-public', 'pv:smoke', now(), repeat('a', 64));
insert into public_vote (vote_id, poll_id, voter_id, vote_privacy, account_id, list_key)
  values ('00000000-0000-4000-8000-00000000a001', 'smoke-public', 'pv:smoke', 'public', 'smoke-voter', gen_random_uuid());
insert into vote_choice (vote_id, choice_id)
  select '00000000-0000-4000-8000-00000000a001', id from poll_choice
   where poll_id = 'smoke-public' and position = 1;
SQL

# GET through nginx as client $1; prints the status, saves headers and body.
get() {
    curl -sS --max-time 15 -D "$work/headers" -o "$work/body" -w '%{http_code}' \
        -H "X-Real-IP: $1" "$base$2"
}
header() {
    tr -d '\r' < "$work/headers" | awk -v name="$1" '
        { split($0, part, ":") }
        tolower(part[1]) == tolower(name) { sub(/^[^:]*:[ \t]*/, ""); print }'
}

# One MCP JSON-RPC call through nginx as client $1, with extra curl args.
mcp() {
    client=$1 payload=$2
    shift 2
    curl -sS --max-time 15 -o "$work/body" -w '%{http_code}' \
        -H "X-Real-IP: $client" \
        -H 'Accept: application/json, text/event-stream' \
        -H 'Content-Type: application/json' \
        "$@" --data "$payload" "$base/api/mcp"
}
call() {
    printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":{"pollId":"smoke-public"}}}' "$1"
}
list_tools='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# The site loads, and an API read works.
[ "$(get 198.51.100.1 /)" = 200 ] || fail 'page did not load'
grep -q '<div id="root">' "$work/body" || fail 'page is not the client'
marker_suffix=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
query_marker="pulse-smoke-query-$marker_suffix"
referer_marker="pulse-smoke-referer-$marker_suffix"
[ "$(curl -sS --max-time 15 -o "$work/body" -w '%{http_code}' \
    -H 'X-Real-IP: 198.51.100.1' --referer "https://example.test/$referer_marker" \
    "$base/api/polls/smoke-public?smoke-marker-q=$query_marker")" = 200 ] || fail 'poll read'
grep -q '"votePrivacy":"public"' "$work/body" || fail 'poll lacks votePrivacy'

# Cache rules survive the proxy.
[ "$(get 198.51.100.1 /api/polls/smoke-public/public-votes)" = 200 ] || fail 'list read'
[ "$(header Cache-Control)" = no-store ] || fail "list Cache-Control: $(header Cache-Control)"
grep -q '"name":"Ada Smoke","choices":\[1\]' "$work/body" || fail 'list body'
[ "$(get 198.51.100.1 /api/polls/smoke-public/ballot)" = 200 ] || fail 'ballot read'
[ "$(header Cache-Control)" = 'private, no-store' ] || fail "ballot Cache-Control: $(header Cache-Control)"

# MCP through nginx with the configured origin: curl's Host is
# 127.0.0.1:<port>, which nginx must forward with its port.
[ "$(mcp 198.51.100.2 "$list_tools" -H "Origin: $origin")" = 200 ] || fail 'MCP tools/list'
grep -q '"get_public_votes"' "$work/body" || fail 'get_public_votes not listed'
[ "$(mcp 198.51.100.2 "$(call get_poll)" -H "Origin: $origin")" = 200 ] || fail 'MCP get_poll'
grep -q 'Smoke test?' "$work/body" || fail 'MCP get_poll body'
grep -q '"isError":true' "$work/body" && fail 'MCP get_poll was an error'
[ "$(mcp 198.51.100.2 "$(call get_public_votes)")" = 200 ] || fail 'MCP get_public_votes'
grep -q 'Ada Smoke' "$work/body" || fail 'MCP get_public_votes body'

# A foreign Origin or Host is refused.
[ "$(mcp 198.51.100.2 "$list_tools" -H 'Origin: https://evil.example')" = 403 ] || fail 'foreign Origin accepted'
[ "$(mcp 198.51.100.2 "$list_tools" -H 'Host: evil.example')" = 403 ] || fail 'foreign Host accepted'
[ "$(mcp 198.51.100.2 "$list_tools" -H "Host: 127.0.0.1")" = 403 ] || fail 'Host without its port accepted'
# The API's own loopback listener is no way in through the proxy.
for host in 127.0.0.1:8080 localhost:8080 "[::1]:8080"; do
    [ "$(mcp 198.51.100.2 "$list_tools" -H "Host: $host")" = 403 ] || fail "loopback Host $host accepted"
done

# publicVotesRateLimit: one bucket per forwarded client address (60 a
# minute), shared by HTTP and MCP. Client A spends its own over HTTP ...
i=0
while [ "$i" -lt 60 ]; do
    [ "$(get 198.51.100.10 /api/polls/smoke-public/public-votes)" = 200 ] || fail "A's read $i refused early"
    i=$((i + 1))
done
[ "$(get 198.51.100.10 /api/polls/smoke-public/public-votes)" = 429 ] || fail "A's 61st read allowed"
# A client's own internal header buys nothing (nginx drops it).
[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' -H 'X-Real-IP: 198.51.100.10' \
    -H 'X-Pulse-Internal: guess' "$base/api/polls/smoke-public/public-votes")" = 429 ] || fail 'internal header bypassed the limit'
# ... so its MCP call is refused from the same bucket ...
[ "$(mcp 198.51.100.10 "$(call get_public_votes)")" = 200 ] || fail "A's MCP call"
grep -q '"too_many_requests"' "$work/body" || fail "A's MCP call was not limited"
# ... while client B, over HTTP and over MCP, is not.
[ "$(get 198.51.100.11 /api/polls/smoke-public/public-votes)" = 200 ] || fail "B shares A's bucket"
[ "$(mcp 198.51.100.11 "$(call get_public_votes)")" = 200 ] || fail "B's MCP call"
grep -q 'Ada Smoke' "$work/body" || fail "B's MCP call shares A's bucket"

# The nginx image sends its access log to stdout.
docker logs "$web" > "$work/web.log" 2>&1 || fail 'could not collect nginx logs'
if grep -Fq "$query_marker" "$work/web.log"; then
    fail "query marker $query_marker leaked into nginx logs"
fi
if grep -Fq "$referer_marker" "$work/web.log"; then
    fail "Referer marker $referer_marker leaked into nginx logs"
fi
grep -Fq 'GET /api/polls/smoke-public HTTP/1.1" 200' "$work/web.log" || fail 'marked poll read missing from nginx access log'

echo 'PASS: page, API read, cache rules, MCP through nginx with the configured origin, foreign and loopback Host and foreign Origin refused, per-address shared list buckets, query and Referer absent from nginx logs'
