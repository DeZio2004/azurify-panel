# AZURIFY panel

**AZURIFY by DeZio** · [azurify.win](https://azurify.win)

A glass-styled Xray management panel with a client portal, built for running your own
VPN service from a small VPS.

- Glass / neon web UI for the whole panel, login and subscription pages
- **Client portal** at `/clientportal/`: each client signs in to see usage, links, QR
  codes and app downloads (see [PORTAL.md](PORTAL.md))
- **Shared ports**: several TCP inbounds (for example VLESS and Trojan) on one port such
  as 443, wired automatically through fallbacks
- Installs from a prebuilt release in about a minute, even on a 1 GB VPS

## Install (Ubuntu / Debian, as root)

```bash
bash <(curl -Ls https://raw.githubusercontent.com/DeZio2004/azurify-panel/main/install.sh)
```

It prints the panel address, username and password at the end. Running it again updates
the panel and keeps your data.

## Manage

```bash
azurify-ui
```

The menu starts and stops the panel, changes the port or login, and sets up an SSL
certificate for your domain (option 20).

## Build

A GitHub Actions workflow (`.github/workflows/azurify-release.yml`) builds the panel and
publishes the `latest` release that the installer downloads. To build by hand you need Go
and Node (see `go.mod` and `.nvmrc`):

```bash
cd frontend && npm ci && npm run build && cd ..
CGO_ENABLED=1 go build -o azurify-ui .
```

## Credits and licence

AZURIFY is a modified version of [3x-ui](https://github.com/MHSanaei/3x-ui) by MHSanaei
and contributors, released under the GNU GPL v3 (see [LICENSE](LICENSE)). It is distributed
under the same licence, and its source is this repository. The Go module path still carries
the original name so the code keeps compiling.
