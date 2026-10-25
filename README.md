# HoloSynth

Neon sci-fi collectible card battler for iPhone. Rip packs, build a team of 3, battle friends by invite code.

- `shared/cards.json`: all 114 cards (stats, moves, rarity), used by both the server and the app.
- `server/`: Cloudflare Worker + D1 game server (accounts, collection, packs, battles). `npm test` runs the rule tests; `node test/e2e.mjs <url>` plays a full match against a server.
- `app/`: SwiftUI iPhone app (XcodeGen spec in `app/project.yml`; card art in `app/HoloSynth/Resources/Art`).
- `.github/workflows/build.yml`: every push to `main` deploys the server and builds an unsigned IPA.

## Install on iPhone

In SideStore, add the source `https://<worker>.workers.dev/source.json`, or install `https://<worker>.workers.dev/HoloSynth.ipa` directly.
The latest build log is at `/build.txt`.
