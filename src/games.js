// Self-hosted js-dos bundles
// To add games:
// 1. Go to https://dos.zone and find the game
// 2. Open browser dev tools, Network tab
// 3. Click play, find the .jsdos request
// 4. Download and save to /public/bundles/

export const games = [
  {
    id: "doom",
    title: "DOOM",
    year: 1993,
    genre: "FPS",
    description: "Rip and tear. The game that defined shooters.",
    cover: "/covers/doom.jpg",
    bundle: "/bundles/doom.jsdos"
  },
  {
    id: "digger",
    title: "Digger",
    year: 1983,
    genre: "Arcade",
    description: "Collect emeralds, avoid monsters.",
    cover: "/covers/digger.jpg",
    bundle: "/bundles/digger.jsdos"
  }
];
