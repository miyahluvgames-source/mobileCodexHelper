# Remote Access and Codex-Focused Behavior

[中文](REMOTE_ACCESS.zh-CN.md) | [English](REMOTE_ACCESS.md)

This document describes the setup that has been validated in this repository, not an idealized architecture.

## Current working path

```text
iPhone / iPad / Mac browser
   ↓
Tailscale tailnet HTTP
   ↓
Local nginx proxy (127.0.0.1:8080)
   ↓
Local web app (127.0.0.1:3001)
   ↓
Codex sessions on the PC
```

The currently working entry points are:

- local app: `http://127.0.0.1:3001`
- local nginx: `http://127.0.0.1:8080`
- tailnet remote entry: `http://<hostname>`
- example: `http://fc-20230705vdmi`

## Important limitation

The current default publish path is tailnet-internal `HTTP`, not `HTTPS`.

That means:

- prefer `http://<hostname>`
- do not assume `https://<hostname>` will work
- if a browser, extension, or proxy upgrades the URL to `https://...`, access may fail

## Access from Mac / iPhone / iPad

First confirm:

- both the PC and the Mac / phone are logged into the same Tailscale tailnet
- the PC has already run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/enable-mobile-codex-remote.ps1
```

Then open one of these:

- `http://<hostname>`
- if short hostnames are unreliable in your environment, try `http://<hostname>.<tailnet>.ts.net`

A validated working example:

- `http://fc-20230705vdmi`

## Proxy and 502 issues

If the device uses a local proxy app or system-wide proxy, tailnet traffic may be intercepted and fail with symptoms such as:

- page cannot work correctly
- 502 Bad Gateway
- login page opens but follow-up requests fail

Preferred fixes:

- disable the proxy temporarily and retest
- or add these to your bypass / direct list:
  - `*.ts.net`
  - your current tailnet domain
  - `100.64.0.0/10`

## First-time device approval

When a new device signs in for the first time:

1. the phone or Mac waits for desktop approval
2. the Windows desktop control tool shows a pending device
3. you review the device name, platform, and IP
4. you approve it
5. the new device continues the login flow automatically

This is expected behavior, not an error.

## Main Codex-focused changes in this repo

### 1. Codex project and session naming

- project cards prefer a readable project name instead of a full Windows path
- Codex sessions prefer `thread_name` from `.codex/session_index.jsonl`
- older sessions without a useful `thread_name` still fall back to a summary title

### 2. More Codex-like mobile UI

- project name and session name are visible in the main view
- archived sessions are hidden by default
- `Add project` is visible again
- each project card exposes a clear `New Session` entry point
- home and empty-state copy now uses Codex-oriented wording

### 3. Arbitrary file upload from the chat composer

Hardened mode now allows direct file upload from the mobile chat composer into the current project conversation.

### 4. Desktop approval flow compatibility

- pending device approval is supported
- trusted-device whitelisting is supported
- the desktop approval tool is adapted for the current local Codex environment

## Fast troubleshooting order

1. confirm local `http://127.0.0.1:3001` opens
2. confirm the desktop tool shows both the app and nginx as healthy
3. confirm `tailscale serve status` points to `http://127.0.0.1:8080`
4. test from another device with `http://<hostname>`
5. if it fails, check for proxies and forced `https`
