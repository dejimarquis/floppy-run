import { games } from './games.js';
import { trackGameStart, trackGameEnd, trackMetric } from './telemetry.js';

const gamesContainer = document.getElementById('games');
const modal = document.getElementById('game-modal');
const modalTitle = document.getElementById('modal-title');
const gameContainer = document.getElementById('game-container');
const closeBtn = document.getElementById('close-modal');

let currentDos = null;
let gameStartTime = null;
let currentGameId = null;

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

  gamesContainer.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const game = games.find(g => g.id === card.dataset.gameId);
      if (game) launchGame(game);
    });
  });
}

async function launchGame(game) {
  modalTitle.textContent = game.title;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';

  currentGameId = game.id;
  gameStartTime = Date.now();
  trackGameStart(game.id, game.title);

  gameContainer.innerHTML = '';
  const dosDiv = document.createElement('div');
  dosDiv.style.width = '100%';
  dosDiv.style.height = '100%';
  gameContainer.appendChild(dosDiv);

  // Desktop-optimized js-dos config
  currentDos = Dos(dosDiv, {
    url: game.bundle,
    autoStart: true,
    kiosk: true,           // Clean UI, no sidebars
    noCloud: true,
    noNetworking: true,
    theme: 'dark',
    scaleControls: 0,      // Hide touch controls
    mouseCapture: true,    // Capture mouse for FPS games
  });
}

function closeGame() {
  if (currentDos) {
    try { currentDos.stop(); } catch(e) {}
    currentDos = null;
  }

  if (gameStartTime && currentGameId) {
    const duration = Date.now() - gameStartTime;
    trackGameEnd(currentGameId, games.find(g => g.id === currentGameId)?.title, duration);
    trackMetric('game_session_duration', duration, { gameId: currentGameId });
    gameStartTime = null;
    currentGameId = null;
  }

  modal.classList.add('hidden');
  modal.classList.remove('flex');
  gameContainer.innerHTML = '';
  document.body.style.overflow = '';
}

closeBtn.addEventListener('click', closeGame);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeGame();
});

renderGames();
