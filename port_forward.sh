#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
OUT_IF="${2:-}"
DEST_IP="${3:-}"

PORTS=(80 4000)

if [[ -z "$ACTION" || -z "$OUT_IF" || -z "$DEST_IP" ]]; then
  echo "Usage:"
  echo "  $0 enable  <out-interface> <destination-ip>"
  echo "  $0 disable <out-interface> <destination-ip>"
  echo
  echo "Example:"
  echo "  $0 enable eth1 192.168.50.10"
  exit 1
fi

enable_forward() {
  echo 1 > /proc/sys/net/ipv4/ip_forward

  for PORT in "${PORTS[@]}"; do
    # Forward incoming traffic on any interface to DEST_IP
    iptables -t nat -C PREROUTING -p tcp --dport "$PORT" \
      -j DNAT --to-destination "${DEST_IP}:${PORT}" 2>/dev/null || \
    iptables -t nat -A PREROUTING -p tcp --dport "$PORT" \
      -j DNAT --to-destination "${DEST_IP}:${PORT}"

    # Allow forwarded traffic out the stated interface
    iptables -C FORWARD -p tcp -o "$OUT_IF" -d "$DEST_IP" --dport "$PORT" \
      -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -p tcp -o "$OUT_IF" -d "$DEST_IP" --dport "$PORT" \
      -j ACCEPT

    # Allow return traffic back
    iptables -C FORWARD -p tcp -i "$OUT_IF" -s "$DEST_IP" --sport "$PORT" \
      -m state --state ESTABLISHED,RELATED \
      -j ACCEPT 2>/dev/null || \
    iptables -A FORWARD -p tcp -i "$OUT_IF" -s "$DEST_IP" --sport "$PORT" \
      -m state --state ESTABLISHED,RELATED \
      -j ACCEPT
  done

  # Masquerade traffic leaving the stated interface
  iptables -t nat -C POSTROUTING -o "$OUT_IF" -d "$DEST_IP" \
    -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -o "$OUT_IF" -d "$DEST_IP" \
    -j MASQUERADE

  echo "Enabled forwarding for ports: ${PORTS[*]} -> $DEST_IP via $OUT_IF"
}

disable_forward() {
  for PORT in "${PORTS[@]}"; do
    while iptables -t nat -C PREROUTING -p tcp --dport "$PORT" \
      -j DNAT --to-destination "${DEST_IP}:${PORT}" 2>/dev/null; do
      iptables -t nat -D PREROUTING -p tcp --dport "$PORT" \
        -j DNAT --to-destination "${DEST_IP}:${PORT}"
    done

    while iptables -C FORWARD -p tcp -o "$OUT_IF" -d "$DEST_IP" --dport "$PORT" \
      -j ACCEPT 2>/dev/null; do
      iptables -D FORWARD -p tcp -o "$OUT_IF" -d "$DEST_IP" --dport "$PORT" \
        -j ACCEPT
    done

    while iptables -C FORWARD -p tcp -i "$OUT_IF" -s "$DEST_IP" --sport "$PORT" \
      -m state --state ESTABLISHED,RELATED \
      -j ACCEPT 2>/dev/null; do
      iptables -D FORWARD -p tcp -i "$OUT_IF" -s "$DEST_IP" --sport "$PORT" \
        -m state --state ESTABLISHED,RELATED \
        -j ACCEPT
    done
  done

  while iptables -t nat -C POSTROUTING -o "$OUT_IF" -d "$DEST_IP" \
    -j MASQUERADE 2>/dev/null; do
    iptables -t nat -D POSTROUTING -o "$OUT_IF" -d "$DEST_IP" \
      -j MASQUERADE
  done

  echo "Disabled forwarding for ports: ${PORTS[*]} -> $DEST_IP via $OUT_IF"
}

case "$ACTION" in
  enable)
    enable_forward
    ;;
  disable)
    disable_forward
    ;;
  *)
    echo "Invalid action: $ACTION"
    echo "Use: enable or disable"
    exit 1
    ;;
esac
