#!/usr/bin/env bash
# scripts/setup-admin-auth.sh
#
# Creates / updates the htpasswd file used by the nginx basic-auth gate on
# /admin, /api/trigger/* and /api/scripts/*. Run once on the VPS to seed the
# first admin user, then again to rotate passwords or add more users.
#
# Usage:
#   sudo scripts/setup-admin-auth.sh                     # prompts for username + password (create)
#   sudo scripts/setup-admin-auth.sh <username>           # prompts for password (create OR update)
#   sudo scripts/setup-admin-auth.sh --delete <username>  # remove a user
#
# Requirements: apache2-utils (htpasswd) installed — `apt install apache2-utils`.

set -euo pipefail

HTPASSWD_FILE="${HTPASSWD_FILE:-/etc/nginx/.htpasswd}"
HTPASSWD_GROUP="${HTPASSWD_GROUP:-www-data}"   # Debian/Ubuntu nginx group

usage() {
    sed -n '2,14p' "$0"
    exit 64
}

delete_user() {
    local user="$1"
    if [[ ! -f "$HTPASSWD_FILE" ]]; then
        echo "htpasswd file $HTPASSWD_FILE does not exist; nothing to delete." >&2
        exit 1
    fi
    if ! grep -q "^${user}:" "$HTPASSWD_FILE"; then
        echo "user '$user' not found in $HTPASSWD_FILE" >&2
        exit 1
    fi
    # Rewrite without the matching line; htpasswd has no --delete-on-stdin.
    local tmp
    tmp="$(mktemp)"
    grep -v "^${user}:" "$HTPASSWD_FILE" > "$tmp"
    install -m 0640 -o root -g "$HTPASSWD_GROUP" "$tmp" "$HTPASSWD_FILE"
    rm -f "$tmp"
    echo "removed user '$user' from $HTPASSWD_FILE"
}

add_or_update_user() {
    local user="$1"

    if ! id "$HTPASSWD_GROUP" >/dev/null 2>&1; then
        echo "group '$HTPASSWD_GROUP' not found; set HTPASSWD_GROUP or create the group." >&2
        exit 1
    fi

    local -a flags=(-B)   # bcrypt — strongest hash apache2-utils ships
    if [[ ! -f "$HTPASSWD_FILE" ]]; then
        flags+=(-c)
        touch "$HTPASSWD_FILE"
    fi

    # htpasswd will prompt for the password if we don't pass -p / stdin.
    htpasswd "${flags[@]}" "$HTPASSWD_FILE" "$user"
    chmod 0640 "$HTPASSWD_FILE"
    chown root:"$HTPASSWD_GROUP" "$HTPASSWD_FILE"

    echo
    echo "wrote entry for '$user' to $HTPASSWD_FILE"
    echo "testing config and reloading nginx…"
    nginx -t
    systemctl reload nginx
    echo "done. visit https://$(hostname -f)/admin — browser will prompt for credentials."
}

main() {
    if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
        usage
    fi

    if [[ "${1:-}" == "--delete" ]]; then
        [[ -n "${2:-}" ]] || { echo "--delete requires a username" >&2; usage; }
        delete_user "$2"
        nginx -t && systemctl reload nginx
        exit 0
    fi

    if [[ $EUID -ne 0 ]]; then
        echo "must be run as root (needs to write $HTPASSWD_FILE and reload nginx)" >&2
        exit 1
    fi

    local user="${1:-}"
    if [[ -z "$user" ]]; then
        read -r -p "admin username: " user
        [[ -n "$user" ]] || { echo "username required" >&2; exit 1; }
    fi

    add_or_update_user "$user"
}

main "$@"
