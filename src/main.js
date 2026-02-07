import { games } from './games.js';
import { trackGameStart, trackGameEnd, trackMetric } from './telemetry.js';

const gamesContainer = document.getElementById('games');
const modal = document.getElementById('game-modal');
const modalTitle = document.getElementById('modal-title');
const dosContainer = document.getElementById('dos-container');
const closeBtn = document.getElementById('close-modal');

let currentDos = null;
let gameStartTime = null;
let currentGameId = null;

// Render game grid
function renderGames() {
  gamesContainer.innerHTML = games.map(game => `
    <div class="game-card" data-game-id="${game.id}">
      <img src="${game.cover}" alt="${game.title}" loading="lazy" 
           onerror="this.src='/covers/placeholder.jpg'">
      <div class="game-title">
        <span>${game.title}</span>
        <span class="text-gray-400 text-xs block">${game.year}</span>
      </div>
    </div>
  `).join('');

  // Add click handlers
  gamesContainer.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.dataset.gameId;
      const game = games.find(g => g.id === gameId);
      if (game) launchGame(game);
    });
  });
}

// Launch game in modal
async function launchGame(game) {
  modalTitle.textContent = game.title;
  dosContainer.innerHTML = '<div class="loader"></div>';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';

  currentGameId = game.id;
  gameStartTime = Date.now();
  trackGameStart(game.id, game.title);

  try {
    // Load js-dos dynamically
    const { Dos } = await import('js-dos');
    
    dosContainer.innerHTML = '';
    const canvas = document.createElement('canvas');
    canvas.id = 'dos-canvas';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '80vh';
    dosContainer.appendChild(canvas);

    currentDos = await Dos(canvas, {
      url: game.bundle,
      autoStart: true
    });
  } catch (err) {
    console.error('Failed to load game:', err);
    dosContainer.innerHTML = `
      <div class="text-center p-8">
        <p class="text-red-400 mb-4">Failed to load ${game.title}</p>
        <p class="text-gray-500 text-sm">Game bundle may be missing or corrupted.</p>
      </div>
    `;
  }
}

// Close modal
function closeGame() {
  if (currentDos) {
    currentDos.stop?.();
    currentDos = null;
  }

  if (gameStartTime && currentGameId) {
    const duration = Date.now() - gameStartTime;
    const game = games.find(g => g.id === currentGameId);
    trackGameEnd(currentGameId, game?.title || currentGameId, duration);
    trackMetric('game_session_duration', duration, { gameId: currentGameId });
    gameStartTime = null;
    currentGameId = null;
  }

  modal.classList.add('hidden');
  modal.classList.remove('flex');
  dosContainer.innerHTML = '';
  document.body.style.overflow = '';
}

closeBtn.addEventListener('click', closeGame);

// ESC to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
    closeGame();
  }
});

// Init
renderGames();
