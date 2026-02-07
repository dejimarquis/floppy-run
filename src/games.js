// Curated list of 90s classics
// Add your own ROM files to /public/roms/ 
// Systems: segaMD (Genesis), nes, snes, psx (PlayStation), n64

export const games = [
  // === GENESIS / MEGA DRIVE ===
  {
    id: "road-rash-2",
    title: "Road Rash II",
    year: 1992,
    genre: "Racing",
    system: "segaMD",
    description: "Motorcycle combat racing. Punch rivals off their bikes.",
    cover: "/covers/road-rash.jpg",
    rom: "/roms/road-rash-2.md"
  },
  {
    id: "sonic-2",
    title: "Sonic 2",
    year: 1992,
    genre: "Platformer",
    system: "segaMD",
    description: "Gotta go fast.",
    cover: "/covers/sonic-2.jpg",
    rom: "/roms/sonic-2.md"
  },
  {
    id: "streets-of-rage-2",
    title: "Streets of Rage 2",
    year: 1992,
    genre: "Beat 'em up",
    system: "segaMD",
    description: "Best beat 'em up ever made.",
    cover: "/covers/streets-of-rage-2.jpg",
    rom: "/roms/streets-of-rage-2.md"
  },

  // === NES ===
  {
    id: "contra",
    title: "Contra",
    year: 1988,
    genre: "Run & Gun",
    system: "nes",
    description: "Up up down down left right left right B A.",
    cover: "/covers/contra.jpg",
    rom: "/roms/contra.nes"
  },
  {
    id: "super-mario-bros-3",
    title: "Super Mario Bros. 3",
    year: 1988,
    genre: "Platformer",
    system: "nes",
    description: "The plumber's greatest 8-bit adventure.",
    cover: "/covers/super-mario-bros-3.jpg",
    rom: "/roms/super-mario-bros-3.nes"
  },

  // === SNES ===
  {
    id: "street-fighter-2",
    title: "Street Fighter II Turbo",
    year: 1993,
    genre: "Fighting",
    system: "snes",
    description: "Hadouken!",
    cover: "/covers/street-fighter-2.jpg",
    rom: "/roms/street-fighter-2-turbo.sfc"
  },
  {
    id: "donkey-kong-country",
    title: "Donkey Kong Country",
    year: 1994,
    genre: "Platformer",
    system: "snes",
    description: "Pre-rendered graphics blew our minds.",
    cover: "/covers/donkey-kong-country.jpg",
    rom: "/roms/donkey-kong-country.sfc"
  },
  {
    id: "super-metroid",
    title: "Super Metroid",
    year: 1994,
    genre: "Action-Adventure",
    system: "snes",
    description: "Atmospheric exploration perfected.",
    cover: "/covers/super-metroid.jpg",
    rom: "/roms/super-metroid.sfc"
  },

  // === DOS (via js-dos fallback) ===
  {
    id: "doom",
    title: "DOOM",
    year: 1993,
    genre: "FPS",
    system: "dos",
    description: "Rip and tear.",
    cover: "/covers/doom.jpg",
    rom: null,
    dosUrl: "https://dos.zone/doom-dec-10-1993/"
  },
  {
    id: "prince-of-persia",
    title: "Prince of Persia",
    year: 1989,
    genre: "Platformer",
    system: "dos",
    description: "Save the princess in 60 minutes.",
    cover: "/covers/prince-of-persia.jpg",
    rom: null,
    dosUrl: "https://dos.zone/prince-of-persia-oct-03-1990/"
  },
  {
    id: "wolf3d",
    title: "Wolfenstein 3D",
    year: 1992,
    genre: "FPS",
    system: "dos",
    description: "The original Nazi shooter.",
    cover: "/covers/wolf3d.jpg",
    rom: null,
    dosUrl: "https://dos.zone/wolfenstein-3d-may-05-1992/"
  },
  {
    id: "commander-keen",
    title: "Commander Keen 4",
    year: 1991,
    genre: "Platformer",
    system: "dos",
    description: "8-year-old genius saves the galaxy.",
    cover: "/covers/commander-keen.jpg",
    rom: null,
    dosUrl: "https://dos.zone/commander-keen-4-secret-of-the-oracle-dec-15-1991/"
  }
];
