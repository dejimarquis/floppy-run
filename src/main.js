import { games } from './games.js';
import { trackGameStart, trackGameEnd, trackMetric } from './telemetry.js';

const gamesContainer = document.getElementById('games');
const modal = document.getElementById('game-modal');
const modalTitle = document.getElementById('modal-title');
const gameContainer = document.getElementById('game-container');
const closeBtn = document.getElementById('close-modal');

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

  gamesContainer.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const gameId = card.dataset.gameId;
      const game = games.find(g => g.id === gameId);
      if (game) launchGame(game);
    });
  });
}

// Launch game
async function launchGame(game) {
  modalTitle.textContent = game.title;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';

  currentGameId = game.id;
  gameStartTime = Date.now();
  trackGameStart(game.id, game.title);

  // DOS games - open in new tab (DOS.Zone)
  if (game.system === 'dos' && game.dosUrl) {
    gameContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full p-8 text-center">
        <p class="text-xl mb-4">Opening ${game.title}...</p>
        <p class="text-gray-400 mb-6">DOS games run on DOS.Zone in a new tab.</p>
        <a href="${game.dosUrl}" target="_blank" rel="noopener" 
           class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg text-lg font-medium">
          Play ${game.title} →
        </a>
      </div>
    `;
    return;
  }

  // Console games - EmulatorJS
  if (game.rom) {
    gameContainer.innerHTML = `<div id="ejs-game" style="width:100%;height:100%;"></div>`;

    window.EJS_player = '#ejs-game';
    window.EJS_gameUrl = game.rom;
    window.EJS_core = game.system;
    window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
    window.EJS_startOnLoaded = true;
    window.EJS_color = '#1f2937';
    window.EJS_backgroundColor = '#000';
    window.EJS_disableDatabases = true;

    const script = document.createElement('script');
    script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
    script.onerror = () => {
      gameContainer.innerHTML = `
        <div class="flex flex-col items-center justify-center h-full p-8 text-center">
          <p class="text-red-400 text-xl mb-4">Failed to load emulator</p>
          <p class="text-gray-400">Check your connection and try again.</p>
        </div>
      `;
    };
    document.body.appendChild(script);
  } else {
    // No ROM available
    gameContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full p-8 text-center">
        <p class="text-yellow-400 text-xl mb-4">ROM not found</p>
        <p class="text-gray-400 mb-2">Add the ROM file to play:</p>
        <code class="bg-gray-800 px-4 py-2 rounded text-sm">/roms/${game.id}.${game.system === 'nes' ? 'nes' : game.system === 'snes' ? 'sfc' : 'md'}</code>
      </div>
    `;
  }
}

// Close modal
function closeGame() {
  if (gameStartTime && currentGameId) {
    const duration = Date.now() - gameStartTime;
    const game = games.find(g => g.id === currentGameId);
    trackGameEnd(currentGameId, game?.title || currentGameId, duration);
    trackMetric('game_session_duration', duration, { gameId: currentGameId });
    gameStartTime = null;
    currentGameId = null;
  }

  // Clean up EmulatorJS
  if (window.EJS_emulator) {
    try { window.EJS_emulator.exit(); } catch(e) {}
  }
  delete window.EJS_player;
  delete window.EJS_gameUrl;
  delete window.EJS_core;
  delete window.EJS_emulator;

  modal.classList.add('hidden');
  modal.classList.remove('flex');
  gameContainer.innerHTML = '';
  document.body.style.overflow = '';
  
  document.querySelectorAll('script[src*="emulatorjs"]').forEach(s => s.remove());
}

closeBtn.addEventListener('click', closeGame);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
    closeGame();
  }
});

renderGames();
