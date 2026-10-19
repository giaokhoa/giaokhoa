#!/usr/bin/env bash
set -euo pipefail

sudo install -d -o vscode -g vscode /home/vscode/.config/gh /home/vscode/.config/tunnel-client

case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/gh"
GH_CONFIG_DIR="$tmp/gh" gh release download   --repo openai/tunnel-client   --pattern "tunnel-client-v*-linux-${arch}.zip"   --dir "$tmp"

unzip -p "$tmp"/*.zip tunnel-client > "$tmp/tunnel-client"
sudo install -m 0755 "$tmp/tunnel-client" /usr/local/bin/tunnel-client

pnpm dlx playwright install --with-deps chromium
