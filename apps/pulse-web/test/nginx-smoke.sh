#!/bin/sh
# Runtime checks against a built web image; no real API, mail or database.
# Run from the repository root: sh apps/pulse-web/test/nginx-smoke.sh pulse-web:smoke
set -eu
image=${1:-pulse-web:smoke}
prefix="pulse-nginx-smoke-$$"
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
    limit_req_zone $http_x_forwarded_for zone=clients:1m rate=1r/m;
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
    docker exec "$web" sh -c 'printf "smoke asset\n" > /usr/share/nginx/html/assets/hsts-smoke.txt'
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

# Check response headers without treating expected HTTP errors as curl errors.
expect_hsts() {
    proto=$1 expected=$2 path=$3 expected_status=$4
    shift 4
    actual=$(curl -sS --max-time 15 -D "$work/headers" -o "$work/body" \
        -w '%{http_code}' -H "X-Forwarded-Proto: $proto" "$@" "$base$path")
    [ "$actual" = "$expected_status" ] || {
        echo "Expected $expected_status for $path, got $actual" >&2; exit 1;
    }
    value=$(tr -d '\r' < "$work/headers" | sed -n 's/^[Ss][Tt][Rr][Ii][Cc][Tt]-[Tt][Rr][Aa][Nn][Ss][Pp][Oo][Rr][Tt]-[Ss][Ee][Cc][Uu][Rr][Ii][Tt][Yy]:[[:space:]]*//p')
    [ "$value" = "$expected" ] || {
        echo "Unexpected HSTS for $path (protocol '$proto'): '$value'" >&2; exit 1;
    }
}

check_hsts_routes() {
    for path in / /sign-in /assets/hsts-smoke.txt /api/ /api/poll-images; do
        expect_hsts "$1" "$2" "$path" 200
    done
    expect_hsts "$1" "$2" /assets/missing-hsts-smoke.js 404
    expect_hsts "$1" "$2" /api/poll-images 413 \
        -H 'Content-Type: image/png' --data-binary "@$work/oversized"
    [ "$(cat "$work/body")" = '{"error":"image_too_large","message":"That picture is over 10 MB. Choose a smaller one."}' ]
}

docker network create "$network" >/dev/null
dd if=/dev/zero of="$work/oversized" bs=1048576 count=11 2>/dev/null
write_upstream first
write_upstream second
start_upstream "$api1" first
start_web ''
check_hsts_routes https ''

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
check_hsts_routes https 'max-age=31536000'
check_hsts_routes http ''
# Missing, unknown, mixed-case and multi-value protocols must not enable HSTS.
for proto in '' invalid HTTPS https,http; do
    expect_hsts "$proto" '' / 200
    expect_hsts "$proto" '' /api/ 200
done
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
# nginx keeps the stopped API's address for up to its 10 s resolver cache, and
# a connection to it hangs rather than failing; wait until the name stops
# resolving and nginx answers 502 at once.
attempts=0
until [ "$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' "$base/api/" || true)" = 502 ]; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 30 ] || { echo 'API stop not observed' >&2; exit 1; }
    sleep 1
done
for path in /api/ /api/poll-images; do
    expect_hsts https 'max-age=31536000' "$path" 502
    expect_hsts http '' "$path" 502
done
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
echo 'PASS: conditional HSTS, forwarding, trust opt-in, separate buckets, DNS refresh, log privacy'
