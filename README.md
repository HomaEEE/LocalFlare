# LocalFlare

VS Code / Antigravity extension for sharing local Herd, Valet, MAMP and manually configured domains through Cloudflare Tunnel.

## MVP scope

- Scan common local PHP development environments: Laravel Herd, Laravel Valet, MAMP, `/etc/hosts`, workspace `.env` `APP_URL`, custom project roots such as `~/Sites`, and `localflare.extraDomains`.
- Pick a local domain from a VS Code quick pick or the LocalFlare activity-bar side panel, grouped into local projects and active tunnels.
- Start a free `trycloudflare.com` quick tunnel with `cloudflared tunnel --url <origin>`.
- Run `cloudflared tunnel login` for Cloudflare authorization.
- Create and route a named tunnel for a custom Cloudflare hostname.

## Running locally

This repository keeps the compiled `dist/` entrypoint committed because VS Code and Antigravity load `package.json#main` directly from `./dist/extension.js`. After TypeScript changes, run `npm run compile` before installing or launching the extension.

If `cloudflared` is not on your PATH, use the gear icon in the LocalFlare side panel to select the executable. LocalFlare also checks common Homebrew/Linux install paths automatically.

## Development plan

1. Harden scanners with fixture-driven tests for Herd/Valet/MAMP config variants across macOS, Linux, and Windows.
2. Add status model for active tunnels, persisted recent domains, and one-click stop/restart commands in the tree view.
3. Add cloudflared bootstrap checks: version detection, install instructions, and configurable binary path.
4. Add Cloudflare account/zone discovery via `cloudflared` credentials or Cloudflare API token stored in VS Code SecretStorage.
5. Improve named tunnel flow: select zone, validate hostname, generate config YAML, and support multiple ingress rules.
6. Package for VS Code and Antigravity compatibility, then add CI for lint, compile, and VSIX publishing.

## Critical questions

- Should custom-domain automation use only `cloudflared` CLI, or may the extension also call the Cloudflare API with an API token?
- Which OS is the first release target: macOS only, or macOS + Windows + Linux?
- Should LocalFlare manage one active tunnel globally, or multiple simultaneous tunnels per workspace?
- Which default project roots should ship besides `~/Sites`?
