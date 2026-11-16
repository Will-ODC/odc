#!/bin/sh
# Runtime checks against a built web image; no real API, mail or database.
# Run from the repository root: sh apps/pulse-web/test/nginx-smoke.sh pulse-web:682
set -eu
image=${1:-pulse-web:682}
prefix="pulse-nginx-682-$$"
network="$prefix-net"
web="$prefix-web"
api1="$prefix-api1"
api2="$prefix-api2"
work=$(mktemp -d)

cleanup() {
    docker rm -f "$web" "$api1" "$api2" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

# A private upstream exposes the headers nginx actually sends. Its rate-limit
# key is the forwarded client address, matching the API's one-hop trust model.
write_upstream() {
    cat > "$work/$1.conf" <<'EOF'
events {}
http {
    access_log off;
    error_log /var/log/nginx/error.log crit;
    limit_req_zone $http_x_real_ip zone=clients:1m rate=1r/m;
    server {
        listen 8080;
        location = /api/limited {
            limit_req zone=clients;
            limit_req_status 429;
            root /usr/share/nginx/html;
            try_files /index.html =404;
        }
        location / {
            return 200 "BACKEND|$http_x_real_ip|$http_x_forwarded_for|$http_x_forwarded_proto|$request_uri";
        }
    }
}
EOF
    sed "s/BACKEND/$1/" "$work/$1.conf" > "$work/$1-rendered.conf"
}

start_upstream() {
    docker run -d --name "$1" --network "$network" --network-alias alternate-api \
        -v "$work/$2-rendered.conf:/etc/nginx/nginx.conf:ro" \
        nginx:1.29-alpine >/dev/null
}

start_web() {
    docker run -d --name "$web" --network "$network" -p 127.0.0.1::8080 \
        -e PULSE_API_UPSTREAM=alternate-api:8080 \
        -e "PULSE_REAL_IP_HEADER=$1" "$image" >/dev/null
    port=$(docker port "$web" 8080/tcp | sed 's/.*://')
    base="http://127.0.0.1:$port"
    attempts=0
    until curl -fsS "$base/api/ready" >/dev/null 2>&1; do
        attempts=$((attempts + 1))
        [ "$attempts" -lt 30 ] || { docker logs "$web"; exit 1; }
        sleep 1
    done
    docker exec "$web" nginx -t
}

request() {
    curl -fsS --max-time 15 -H "X-Real-IP: $1" \
        -H 'X-Forwarded-For: 192.0.2.99, 192.0.2.100' \
        -H 'X-Forwarded-Proto: https' "$base$2"
}

expect_status() {
    actual=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
        -H "X-Real-IP: $1" "$base/api/limited")
    [ "$actual" = "$2" ] || { echo "Expected $2, got $actual" >&2; exit 1; }
}

docker network create "$network" >/dev/null
write_upstream first
write_upstream second
start_upstream "$api1" first
start_web ''

# Direct mode must discard all client-supplied address/protocol assertions.
body=$(request 198.51.100.1 '/api/check?keep=yes')
# curl reaches the published port through the network's gateway, so that is
# the TCP peer nginx sees; any client-sent address must be ignored.
peer=$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$network")
[ "$body" = "first|$peer|$peer|http|/api/check?keep=yes" ]
expect_status 198.51.100.1 200
expect_status 198.51.100.2 429
docker rm -f "$web" >/dev/null

start_web X-Real-IP
for path in '/api/check?keep=yes' '/api/poll-images?keep=yes'; do
    body=$(request 198.51.100.1 "$path")
    [ "$body" = "first|198.51.100.1|198.51.100.1|https|$path" ]
done
expect_status 198.51.100.1 200
expect_status 198.51.100.1 429
expect_status 198.51.100.2 200

# Allocate the replacement before removing the first so Docker gives it a
# different address. The web container must recover without restart/reload.
start_upstream "$api2" second
old_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$api1")
new_ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$api2")
[ "$old_ip" != "$new_ip" ]
docker rm -f "$api1" >/dev/null
attempts=0
until [ "$(request 198.51.100.1 /api/check 2>/dev/null || true)" = 'second|198.51.100.1|198.51.100.1|https|/api/check' ]; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 30 ] || { echo 'DNS refresh failed' >&2; exit 1; }
    sleep 1
done
body=$(request 198.51.100.1 '/api/poll-images?keep=yes')
[ "$body" = 'second|198.51.100.1|198.51.100.1|https|/api/poll-images?keep=yes' ]

docker stop "$api2" >/dev/null
token="nginx-smoke-secret-$$"
for path in /api/sign-in/redeem /api/poll-images; do
    status=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base$path?token=$token")
    [ "$status" = 502 ]
done
curl -fsS "$base/sign-in?token=$token" >/dev/null
docker logs "$web" > "$work/web.log" 2>&1
if grep -Fq "$token" "$work/web.log"; then
    echo 'Token leaked into nginx logs' >&2
    exit 1
fi
# The official image links both logs to stdout/stderr. Confirm the log capture
# was live, rather than passing simply because no access log was collected.
grep -q 'GET /api/sign-in/redeem HTTP/1.1" 502' "$work/web.log"
echo 'PASS: forwarding, trust opt-in, separate buckets, DNS refresh, log privacy'
