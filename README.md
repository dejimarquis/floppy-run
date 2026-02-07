# Floppy.run

Retro PC games from the 90s. No ads, no bloat, just play.

## Stack
- **Vite** - Fast dev/build
- **Tailwind CSS** - Clean, minimal styling
- **js-dos** - DOS emulation in the browser
- **Azure** - Telemetry + hosting (planned)

## Setup

```bash
npm install
npm run dev
```

## Adding Games

1. Create a `.jsdos` bundle using [js-dos bundler](https://js-dos.com/docs/bundler)
2. Add to `public/bundles/`
3. Add cover image to `public/covers/`
4. Add entry to `src/games.js`

## Telemetry

Uses Azure Application Insights JavaScript SDK. Set `FLOPPY_APPINSIGHTS_CONNECTION_STRING` in your env.

Auto-tracked:
- Page views, sessions, user counts (DAU/MAU built-in)
- Browser info, geo, performance

Custom events:
- `game_start` - Game launched (gameId, gameTitle)
- `game_end` - Game closed (gameId, gameTitle, durationMs)
- `game_session_duration` - Metric for session length

## Deployment

Build for production:
```bash
npm run build
```

Deploy `dist/` to Azure Static Web Apps, Cloudflare Pages, or Vercel.

## Legal

Games included are abandonware. For educational/preservation purposes.
