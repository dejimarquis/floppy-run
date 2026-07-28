# Floppy.run — Product Requirements Document

## What Is This?

A retro gaming website where people can play classic-style games instantly in their browser. No downloads, no accounts, no friction.

**One-liner:** Classic games. Zero friction.

---

## The Problem

You want to play Road Rash, Burnout, or that 3D-pinball game you loved as a kid. But:
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
| 3D-pinball | TBD | The classic windows xp game |

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

---