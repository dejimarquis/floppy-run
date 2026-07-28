# Floppy.run — Product Requirements Document

## What Is This?

A retro gaming website where people can play classic-style games instantly in their browser. No downloads, no accounts, no friction.

**One-liner:** Classic games. Zero friction.

---

## The Problem

You want to play Road Rash, Burnout, or that ping pong game you loved as a kid. But:
- Original ROMs are legally risky
- Emulator setup is annoying
- Mobile games are full of ads and IAPs
- Nothing captures that simple, immediate fun anymore

## The Solution

Build a site with **original games that look and feel like the classics** — legally clean, browser-native, instant-play.

---

## Games We Want

These are the vibes we're chasing. For each copyrighted game, we build our own equivalent that captures the same feel.

| Classic | Our Version | Core Feel |
|---------|-------------|-----------|
| Road Rash | TBD | Motorcycle combat racing, punch rivals, chaotic fun |
| Burnout Legends | TBD | Arcade racing, takedowns, speed, crashes |
| Ping Pong / Table Tennis | TBD | Simple 2-player paddle game, satisfying physics |
| JumpStart (edu games) | TBD | Fun educational mini-games for kids |
| *(more to come)* | | |

**Important:** Our versions should look and feel like the originals — same energy, same fun — but be original IP we own.

---

## Core Principles

1. **Instant play** — Click and you're in the game. No loading screens, no tutorials, no sign-ups.

2. **Feels like the original** — If we're inspired by Road Rash, it should *feel* like Road Rash. Same chaos, same satisfaction.

3. **Desktop-first** — These games need keyboards. Mobile can come later for games that work with touch.

4. **No legal risk** — Everything we ship, we own. No ROMs, no ripped assets.

5. **Fast and light** — No bloated frameworks. Games should load in seconds.

---

## Site Structure

```
floppy.run/
├── Homepage
│   └── Grid of games, click to play
│
├── /play/[game-slug]
│   └── Full-screen game, minimal UI
│
└── That's it. Keep it simple.
```

---

## Technical Direction

**Open for interpretation.** The AI engineers should decide the best approach. Some guidelines:

- Static site (no backend needed for v1)
- Games can be vanilla JS, Canvas, WebGL, or whatever makes sense for the game
- Should work on modern browsers (Chrome, Firefox, Safari, Edge)
- Hosting: Azure Static Web Apps (or equivalent static host)
- Analytics: Something simple to track plays and engagement

---

## What Success Looks Like

- Someone lands on the site
- They see games they recognize the vibe of
- They click one and are playing within 2 seconds
- They have fun and come back

---

## What We're NOT Building (v1)

- User accounts
- Leaderboards
- Multiplayer
- Mobile apps
- Ads
- Monetization

Just games. Just fun. Ship it.

---

## Game Backlog

*To be expanded as Deji remembers more games:*

1. Road Rash style — motorcycle combat racer
2. Burnout style — arcade racer with takedowns
3. Ping Pong — classic table tennis
4. JumpStart style — educational mini-games
5. *(add more here)*

---

## Open Questions

- What art style? Pixel art? Low-poly 3D? Stylized 2D?
- Sound design approach?
- How many games for launch?
- Any specific mechanics from the originals that are must-haves?

---

*This doc is intentionally minimal. Let the engineers think fresh about implementation.*

*Last updated: 2026-02-08*
