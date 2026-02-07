// Floppy.run Game Catalog
// Mix of DOS shareware classics + original browser games

export const games = [
  // === ORIGINALS ===
  {
    id: "chain-gang",
    title: "Chain Gang",
    year: 2026,
    genre: "Racing",
    description: "Motorcycle combat racer. Punch rivals off their bikes.",
    cover: "/covers/chain-gang.jpg",
    type: "html",
    url: "/games/chain-gang/"
  },
  
  // === DOS SHAREWARE ===
  {
    id: "doom",
    title: "DOOM",
    year: 1993,
    genre: "FPS",
    description: "Rip and tear. The game that defined shooters.",
    cover: "/covers/doom.jpg",
    type: "dos",
    bundle: "/bundles/doom.jsdos"
  },
  {
    id: "wolf3d",
    title: "Wolfenstein 3D",
    year: 1992,
    genre: "FPS",
    description: "The original Nazi-killing FPS.",
    cover: "/covers/wolf3d.jpg",
    type: "dos",
    bundle: "/bundles/wolf3d.jsdos"
  },
  {
    id: "prince",
    title: "Prince of Persia",
    year: 1990,
    genre: "Platformer",
    description: "Save the princess in 60 minutes.",
    cover: "/covers/prince-of-persia.jpg",
    type: "dos",
    bundle: "/bundles/prince.jsdos"
  },
  {
    id: "keen4",
    title: "Commander Keen 4",
    year: 1991,
    genre: "Platformer",
    description: "8-year-old genius saves the galaxy.",
    cover: "/covers/commander-keen.jpg",
    type: "dos",
    bundle: "/bundles/keen4.jsdos"
  },
  {
    id: "digger",
    title: "Digger",
    year: 1983,
    genre: "Arcade",
    description: "Collect emeralds, avoid monsters.",
    cover: "/covers/digger.jpg",
    type: "dos",
    bundle: "/bundles/digger.jsdos"
  }
];
