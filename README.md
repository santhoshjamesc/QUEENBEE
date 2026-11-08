# Queen

Queen is a desktop app (Electron + React + TypeScript) that orchestrates Claude Code. It runs a "Queen" Claude Code session per project, plus hired worker agents, a watchdog, skills, code intelligence and a pixel-art office view. Data is stored locally in SQLite.

## Build location

The packaged macOS build (Apple Silicon, unsigned) is produced at:

```
app/release/mac-arm64/Queen.app
```

The build is about 295 MB because it bundles Electron, so it is **not committed to this repository**. Build it yourself with the steps below.

To open it, run `open app/release/mac-arm64/Queen.app`. The app is unsigned, so on another Mac use right-click → Open to get past Gatekeeper.

## Requirements

- macOS (Apple Silicon). Windows is untested.
- Node.js and npm
- Claude Code CLI installed and logged in (`claude`)

## Setup and build

```bash
cd app
npm install

npm run dev           # run in development
npm run build         # compile to app/out
npm run package       # build app/release/mac-arm64/Queen.app
npm run package:dmg   # build a DMG into app/release/
npm test              # unit tests
QUEEN_REAL=1 npm test # also run tests against a real claude session
```

## Repository layout

| Path | Contents |
|---|---|
| `app/src/main` | Electron main process: sessions, Queen, skills, code intelligence, SQLite |
| `app/src/renderer` | React UI (chat, office, skills, intel) |
| `app/src/preload`, `app/src/shared` | Preload bridge and shared types |
| `app/test` | Vitest tests |
| `Requirements.md`, `Design.md`, `Task.md`, `Tasks/`, `Docs/` | Spec, design and progress notes (`Docs/Progress.md` has milestone status and known limits) |
