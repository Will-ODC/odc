#!/bin/sh
set -eu

# Run after the official image's template hooks. Defaults live here so both
# unset and empty settings keep the existing compose stack working.
: "${PULSE_API_UPSTREAM:=api:8080}"
: "${PULSE_DNS_RESOLVER:=127.0.0.11}"
export PULSE_API_UPSTREAM PULSE_DNS_RESOLVER

# These values become nginx syntax. Allow one host:port and one resolver,
# including bracketed IPv6, but never whitespace, quotes or extra directives.
case "$PULSE_API_UPSTREAM$PULSE_DNS_RESOLVER" in
    *[[:space:]]*)
        echo 'Invalid Pulse nginx setting: whitespace is not allowed' >&2
        exit 1
        ;;
esac
if ! printf '%s\n' "$PULSE_API_UPSTREAM" | LC_ALL=C grep -Eq '^([A-Za-z0-9][A-Za-z0-9._-]*|\[[A-Fa-f0-9:]+\]):[0-9]+$'; then
    echo 'Invalid PULSE_API_UPSTREAM: expected host:port or [IPv6]:port' >&2
    exit 1
fi
if ! printf '%s\n' "$PULSE_DNS_RESOLVER" | LC_ALL=C grep -Eq '^([A-Za-z0-9][A-Za-z0-9.-]*|\[[A-Fa-f0-9:]+\])(:[0-9]+)?$'; then
    echo 'Invalid PULSE_DNS_RESOLVER: expected one DNS address, with IPv6 in brackets' >&2
    exit 1
fi

case "${PULSE_REAL_IP_HEADER:-}" in
    '')
        cat > "/etc/nginx/pulse-proxy-mode.conf" <<'EOF'
# Direct/compose mode: no trusted real-IP sources or forwarded protocol.
map "" $pulse_forwarded_proto {
    default $scheme;
}
EOF
        ;;
    X-Real-IP)
        # Railway overwrites X-Real-IP and only its edge may reach this port.
        # Its edge ranges are unpublished, so this is an explicit trust opt-in.
        cat > "/etc/nginx/pulse-proxy-mode.conf" <<'EOF'
set_real_ip_from 0.0.0.0/0;
set_real_ip_from ::/0;
real_ip_header X-Real-IP;
real_ip_recursive off;
map $http_x_forwarded_proto $pulse_forwarded_proto {
    default $scheme;
    http http;
    https https;
}
EOF
        ;;
    *)
        echo 'Invalid PULSE_REAL_IP_HEADER: use X-Real-IP or leave empty' >&2
        exit 1
        ;;
esac

# A strict allowlist preserves nginx's own $uri, $remote_addr and other vars.
envsubst '${PULSE_API_UPSTREAM} ${PULSE_DNS_RESOLVER}' \
    < "/etc/nginx/pulse-nginx.conf.template" \
    > "/etc/nginx/conf.d/default.conf"
