import '../style.css'

interface Game {
  slug: string
  title: string
  description: string
  color: string
}

const games: Game[] = [
  { slug: 'road-rage', title: 'Road Rage', description: 'Motorcycle combat racing. Punch rivals off their bikes. Win the race.', color: '#ff6600' },
  { slug: 'space-pinball', title: 'Space Pinball', description: 'Classic 3D pinball with missions, multiball, and high scores.', color: '#00ccff' },
]

function renderGameCard(game: Game): string {
  return `
    <a href="/play/${game.slug}" class="game-card">
      <div class="game-card-thumb" style="background-color: ${game.color}"></div>
      <h2>${game.title}</h2>
      <p>${game.description}</p>
    </a>
  `
}

export function renderHomepage(): void {
  const app = document.getElementById('app')
  if (app) {
    app.innerHTML = `
      <div class="homepage">
        <header class="site-header">
          <h1>FLOPPY.RUN</h1>
          <p class="site-tagline">Classic Games. Zero Friction.</p>
        </header>
        <main class="game-grid">
          ${games.map(renderGameCard).join('')}
        </main>
      </div>
    `
  }
}
