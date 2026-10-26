#!/usr/bin/env bash
# AZURIFY panel installer for Ubuntu/Debian (amd64, arm64).
# Installs the prebuilt panel from the repo's "latest" release; falls back to building
# from source on this machine when no release exists (that needs about 2 GB of RAM).
#
#   bash <(curl -Ls https://raw.githubusercontent.com/DeZio2004/azurify-panel/main/install.sh)
#
# Re-running it updates the panel in place; the database in /etc/x-ui is kept.
# Options (environment): AZURIFY_REPO, AZURIFY_BRANCH, XUI_PORT.

set -euo pipefail

AZURIFY_REPO="${AZURIFY_REPO:-DeZio2004/azurify-panel}"
AZURIFY_BRANCH="${AZURIFY_BRANCH:-main}"
XRAY_VERSION="${XRAY_VERSION:-v26.10.21}"

INSTALL_DIR=/usr/local/x-ui
DB_DIR=/etc/x-ui
LOG_DIR=/var/log/x-ui
SRC_DIR=/opt/azurify-src
TOOLS_DIR=/opt/azurify-tools

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
plain='\033[0m'

info() { echo -e "${green}[azurify]${plain} $*"; }
warn() { echo -e "${yellow}[azurify]${plain} $*"; }
die() { echo -e "${red}[azurify] $*${plain}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo -i)."
command -v apt-get > /dev/null || die "This installer supports Ubuntu/Debian only."

case "$(uname -m)" in
    x86_64 | amd64)
        GOARCH=amd64
        NODE_ARCH=x64
        XRAY_ZIP=64
        ;;
    aarch64 | arm64)
        GOARCH=arm64
        NODE_ARCH=arm64
        XRAY_ZIP=arm64-v8a
        ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
esac

info "Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl tar unzip ca-certificates openssl cron

# --- prebuilt release (preferred: building needs about 2 GB of RAM) ---------
# The GitHub Actions workflow publishes azurify-linux-<arch>.tar.gz to the "latest"
# release. Set AZURIFY_BUILD=source to compile on this machine instead.
STAGE=""
RELEASE_URL="https://github.com/$AZURIFY_REPO/releases/download/latest/azurify-linux-${GOARCH}.tar.gz"
if [[ "${AZURIFY_BUILD:-auto}" != "source" ]] && curl -fsIL -o /dev/null "$RELEASE_URL"; then
    info "Downloading the prebuilt panel..."
    # /var/tmp is on disk; /tmp can be a small RAM-backed folder.
    mkdir -p /var/tmp
    STAGE=$(mktemp -d -p /var/tmp azurify.XXXXXX)
    curl -fL "$RELEASE_URL" | tar -xz -C "$STAGE" --strip-components=1
else
    warn "No prebuilt release found; building from source (needs about 2 GB of RAM or swap)."
fi

build_from_source() {
apt-get install -y wget git xz-utils build-essential
mkdir -p "$TOOLS_DIR"

# --- source ---------------------------------------------------------------
if [[ -d "$SRC_DIR/.git" ]]; then
    info "Updating source in $SRC_DIR..."
    git -C "$SRC_DIR" fetch --depth 1 origin "$AZURIFY_BRANCH"
    git -C "$SRC_DIR" reset --hard FETCH_HEAD
else
    info "Cloning https://github.com/$AZURIFY_REPO ..."
    rm -rf "$SRC_DIR"
    git clone --depth 1 --branch "$AZURIFY_BRANCH" "https://github.com/$AZURIFY_REPO.git" "$SRC_DIR"
fi
cd "$SRC_DIR"

# --- toolchains -----------------------------------------------------------
GO_WANT=$(sed -n 's/^go \([0-9.]*\)$/\1/p' go.mod | head -n 1)
[[ -n "$GO_WANT" ]] || die "Could not read the Go version from go.mod."
if [[ ! -x "$TOOLS_DIR/go/bin/go" ]] || [[ "$("$TOOLS_DIR/go/bin/go" env GOVERSION 2> /dev/null)" != "go$GO_WANT" ]]; then
    info "Installing Go $GO_WANT..."
    rm -rf "$TOOLS_DIR/go"
    curl -fL "https://go.dev/dl/go${GO_WANT}.linux-${GOARCH}.tar.gz" | tar -xz -C "$TOOLS_DIR"
fi

NODE_MAJOR=$(sed -n 's/^\([0-9]*\).*/\1/p' .nvmrc 2> /dev/null | head -n 1)
NODE_MAJOR="${NODE_MAJOR:-26}"
if [[ ! -x "$TOOLS_DIR/node/bin/node" ]] || [[ "$("$TOOLS_DIR/node/bin/node" -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
    info "Installing Node.js $NODE_MAJOR..."
    node_index="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
    node_file=$(curl -fsL "$node_index/SHASUMS256.txt" | awk -v a="linux-${NODE_ARCH}.tar.xz" '$2 ~ a"$" {print $2; exit}')
    [[ -n "$node_file" ]] || die "Could not find Node.js $NODE_MAJOR for linux-$NODE_ARCH."
    rm -rf "$TOOLS_DIR/node" "$TOOLS_DIR/${node_file%.tar.xz}"
    curl -fL "$node_index/$node_file" | tar -xJ -C "$TOOLS_DIR"
    mv "$TOOLS_DIR/${node_file%.tar.xz}" "$TOOLS_DIR/node"
fi

export PATH="$TOOLS_DIR/go/bin:$TOOLS_DIR/node/bin:$PATH"

# --- build ----------------------------------------------------------------
info "Building the web UI..."
(cd frontend && npm ci --no-audit --no-fund --ignore-scripts && npm run build)

info "Building the panel (this takes a few minutes)..."
CGO_ENABLED=1 go build -p 1 -trimpath -ldflags "-s -w" -o "$SRC_DIR/x-ui" .
STAGE="$SRC_DIR"
}

if [[ -z "$STAGE" ]]; then
    build_from_source
fi
cd "$STAGE"

# --- install --------------------------------------------------------------
was_running=false
if systemctl is-active --quiet x-ui 2> /dev/null; then
    was_running=true
    systemctl stop x-ui
fi

mkdir -p "$INSTALL_DIR/bin" "$DB_DIR" "$LOG_DIR"
install -m 0755 "$STAGE/x-ui" "$INSTALL_DIR/x-ui"
install -m 0755 "$STAGE/x-ui.sh" "$INSTALL_DIR/x-ui.sh"
install -m 0755 "$STAGE/x-ui.sh" /usr/bin/x-ui

xray_bin="$INSTALL_DIR/bin/xray-linux-${GOARCH}"
if [[ ! -x "$xray_bin" ]]; then
    info "Downloading Xray-core $XRAY_VERSION..."
    tmp=$(mktemp -d -p /var/tmp azurify.XXXXXX)
    curl -fL -o "$tmp/xray.zip" "https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}/Xray-linux-${XRAY_ZIP}.zip"
    unzip -q -o "$tmp/xray.zip" xray -d "$tmp"
    install -m 0755 "$tmp/xray" "$xray_bin"
    rm -rf "$tmp"
fi

info "Downloading geo data..."
cd "$INSTALL_DIR/bin"
curl -fLRo geoip.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat || warn "geoip.dat download failed"
curl -fLRo geosite.dat https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat || warn "geosite.dat download failed"
cd "$STAGE"

install -m 0644 "$STAGE/x-ui.service.debian" /etc/systemd/system/x-ui.service
systemctl daemon-reload
systemctl enable x-ui > /dev/null 2>&1

# --- first-run settings ---------------------------------------------------
if [[ ! -f "$DB_DIR/x-ui.db" ]]; then
    info "First install: generating credentials..."
    panel_user=$(openssl rand -hex 4)
    panel_pass=$(openssl rand -hex 8)
    panel_port="${XUI_PORT:-$((RANDOM % 40000 + 10000))}"
    panel_path=$(openssl rand -hex 6)
    "$INSTALL_DIR/x-ui" setting -username "$panel_user" -password "$panel_pass" -port "$panel_port" -webBasePath "$panel_path" > /dev/null
    server_ip=$(curl -fsL --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')
    first_install=true
else
    first_install=false
fi

systemctl start x-ui
sleep 2
systemctl is-active --quiet x-ui || die "x-ui failed to start. Check: journalctl -u x-ui -n 50"

info "Done."
if [[ "$first_install" == true ]]; then
    echo
    echo "  Panel URL : http://${server_ip}:${panel_port}/${panel_path}/"
    echo "  Username  : ${panel_user}"
    echo "  Password  : ${panel_pass}"
    echo
    echo "  Client portal (give clients this link): http://${server_ip}:${panel_port}/clientportal/"
    echo
    warn "Save these now. Open the panel port in your firewall (ufw allow ${panel_port}/tcp)."
    warn "Use a domain + SSL certificate (x-ui menu) so clients sign in over https."
else
    if [[ "$was_running" == true ]]; then info "Panel updated and restarted."; fi
fi
echo "  Manage with: x-ui"
echo "  App download links shown to clients can be changed in /etc/default/x-ui:"
echo "    PORTAL_NETMOD_WINDOWS_URL, PORTAL_NETMOD_ANDROID_URL, PORTAL_NPV_IOS_URL, PORTAL_NPV_ANDROID_URL"
