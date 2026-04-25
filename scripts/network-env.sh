#!/usr/bin/env bash

set -euo pipefail

list_ipv4_interfaces() {
  if command -v ip >/dev/null 2>&1; then
    ip -o -4 addr show up scope global \
      | awk '{print $2 "|" $4}' \
      | awk -F'|' '!seen[$0]++ { split($2, cidr, "/"); print $1 "|" cidr[1] }'
    return
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    ifconfig \
      | awk '
          /^[a-zA-Z0-9]/ { iface=$1; sub(":", "", iface) }
          /inet / && $2 != "127.0.0.1" { print iface "|" $2 }
        ' \
      | awk -F'|' '!seen[$0]++ { print $0 }'
    return
  fi

  return 1
}

print_interface_choices() {
  local entries=("$@")

  if [ "${#entries[@]}" -eq 0 ]; then
    echo "  No global IPv4 interfaces were detected." >&2
    return
  fi

  local index=1
  local entry
  for entry in "${entries[@]}"; do
    local iface="${entry%%|*}"
    local ip="${entry#*|}"
    printf "  %d. %s (%s)\n" "$index" "$iface" "$ip" >&2
    index=$((index + 1))
  done
}

read_interface_entries() {
  mapfile -t NETWORK_ENV_INTERFACE_ENTRIES < <(list_ipv4_interfaces || true)
}

choose_single_ip() {
  local prompt="$1"
  local current_value="${2:-}"

  read_interface_entries

  echo "$prompt" >&2
  print_interface_choices "${NETWORK_ENV_INTERFACE_ENTRIES[@]}"

  if [ -n "$current_value" ]; then
    echo "  Press Enter to keep current: $current_value" >&2
  fi

  if [ "${#NETWORK_ENV_INTERFACE_ENTRIES[@]}" -eq 0 ]; then
    printf "%s" "$current_value"
    return
  fi

  local selection
  read -r -p "Choose one interface number: " selection

  if [ -z "$selection" ]; then
    printf "%s" "$current_value"
    return
  fi

  if ! [[ "$selection" =~ ^[0-9]+$ ]]; then
    echo "Invalid selection. Keeping current value." >&2
    printf "%s" "$current_value"
    return
  fi

  if [ "$selection" -lt 1 ] || [ "$selection" -gt "${#NETWORK_ENV_INTERFACE_ENTRIES[@]}" ]; then
    echo "Selection out of range. Keeping current value." >&2
    printf "%s" "$current_value"
    return
  fi

  local chosen_entry="${NETWORK_ENV_INTERFACE_ENTRIES[$((selection - 1))]}"
  printf "%s" "${chosen_entry#*|}"
}

choose_multiple_ips() {
  local prompt="$1"

  read_interface_entries

  echo "$prompt" >&2
  print_interface_choices "${NETWORK_ENV_INTERFACE_ENTRIES[@]}"
  echo "  Enter comma-separated interface numbers, or press Enter for none." >&2

  if [ "${#NETWORK_ENV_INTERFACE_ENTRIES[@]}" -eq 0 ]; then
    return
  fi

  local selection
  read -r -p "Choose interface numbers: " selection

  if [ -z "$selection" ]; then
    return
  fi

  local part
  local -a chosen_ips=()
  IFS=',' read -r -a parts <<< "$selection"
  for part in "${parts[@]}"; do
    part="$(printf "%s" "$part" | tr -d '[:space:]')"

    if ! [[ "$part" =~ ^[0-9]+$ ]]; then
      continue
    fi

    if [ "$part" -lt 1 ] || [ "$part" -gt "${#NETWORK_ENV_INTERFACE_ENTRIES[@]}" ]; then
      continue
    fi

    local chosen_entry="${NETWORK_ENV_INTERFACE_ENTRIES[$((part - 1))]}"
    chosen_ips+=("${chosen_entry#*|}")
  done

  if [ "${#chosen_ips[@]}" -gt 0 ]; then
    printf "%s\n" "${chosen_ips[@]}" | awk '!seen[$0]++'
  fi
}

upsert_env_var() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local temp_file

  temp_file="$(mktemp)"

  if [ -f "$env_file" ] && grep -q "^${key}=" "$env_file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { updated = 0 }
      $0 ~ ("^" key "=") {
        print key "=" value
        updated = 1
        next
      }
      { print }
      END {
        if (!updated) {
          print key "=" value
        }
      }
    ' "$env_file" > "$temp_file"
  else
    if [ -f "$env_file" ]; then
      cat "$env_file" > "$temp_file"
    fi
    printf "%s=%s\n" "$key" "$value" >> "$temp_file"
  fi

  mv "$temp_file" "$env_file"
}

generate_random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if [ -r /dev/urandom ]; then
    od -An -N 32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi

  printf "%s%s" "$(date +%s)" "$RANDOM$RANDOM$RANDOM"
}

set_userscript_config_value() {
  local script_file="$1"
  local key="$2"
  local value="$3"
  local temp_file

  if [ ! -f "$script_file" ]; then
    return
  fi

  temp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    {
      pattern = "^[[:space:]]*" key ":[[:space:]]*\"[^\"]*\",[[:space:]]*$"

      if ($0 ~ pattern) {
        indent = substr($0, 1, match($0, /[^[:space:]]/) - 1)
        print indent key ": \"" value "\","
        next
      }

      print
    }
  ' "$script_file" > "$temp_file"

  mv "$temp_file" "$script_file"
}
