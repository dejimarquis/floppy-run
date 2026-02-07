// Chain Gang - Motorcycle Combat Racer
// Top-down arcade racing with combat

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// Game state
let gameRunning = false;
let score = 0;
let distance = 0;

// Player
const player = {
  x: W / 2,
  y: H - 100,
  width: 20,
  height: 40,
  speed: 0,
  maxSpeed: 12,
  acceleration: 0.15,
  friction: 0.02,
  health: 100,
  punching: null, // 'left', 'right', or null
  punchTimer: 0,
  chainOut: false,
  chainTimer: 0,
  invincible: 0
};

// Road
const road = {
  laneWidth: 80,
  lanes: 4,
  scroll: 0,
  lineGap: 40
};

// Rivals
let rivals = [];
const RIVAL_COLORS = ['#e22', '#22e', '#2e2', '#ee2', '#e2e'];

// Traffic (cars)
let traffic = [];

// Input
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; e.preventDefault(); });
document.addEventListener('keyup', e => { keys[e.code] = false; });

// UI Elements
const scoreEl = document.getElementById('score');
const speedEl = document.getElementById('speed');
const healthEl = document.getElementById('health');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

function startGame() {
  gameRunning = true;
  score = 0;
  distance = 0;
  player.x = W / 2;
  player.y = H - 100;
  player.speed = 0;
  player.health = 100;
  player.punching = null;
  player.chainOut = false;
  player.invincible = 0;
  rivals = [];
  traffic = [];
  
  // Spawn initial rivals
  for (let i = 0; i < 3; i++) {
    spawnRival();
  }
  
  startScreen.style.display = 'none';
  gameOverScreen.style.display = 'none';
  requestAnimationFrame(gameLoop);
}

function spawnRival() {
  const lane = Math.floor(Math.random() * road.lanes);
  rivals.push({
    x: 60 + lane * road.laneWidth + road.laneWidth / 2,
    y: -50 - Math.random() * 300,
    width: 18,
    height: 38,
    speed: 3 + Math.random() * 2,
    color: RIVAL_COLORS[Math.floor(Math.random() * RIVAL_COLORS.length)],
    health: 30,
    attacking: false,
    attackTimer: 0
  });
}

function spawnTraffic() {
  const lane = Math.floor(Math.random() * road.lanes);
  const isLeft = Math.random() > 0.5;
  traffic.push({
    x: 60 + lane * road.laneWidth + road.laneWidth / 2,
    y: isLeft ? H + 50 : -100,
    width: 30,
    height: 50,
    speed: isLeft ? -2 : 1,
    color: ['#555', '#666', '#777', '#888'][Math.floor(Math.random() * 4)]
  });
}

function update() {
  // Player input
  if (keys['ArrowUp'] || keys['KeyW']) {
    player.speed = Math.min(player.speed + player.acceleration, player.maxSpeed);
  }
  if (keys['ArrowDown'] || keys['KeyS']) {
    player.speed = Math.max(player.speed - player.acceleration * 2, 0);
  }
  if (keys['ArrowLeft'] || keys['KeyA']) {
    player.x -= 4;
  }
  if (keys['ArrowRight'] || keys['KeyD']) {
    player.x += 4;
  }
  
  // Punch
  if (keys['KeyZ'] && !player.punching) {
    player.punching = 'left';
    player.punchTimer = 15;
  }
  if (keys['KeyX'] && !player.punching) {
    player.punching = 'right';
    player.punchTimer = 15;
  }
  
  // Chain attack
  if (keys['Space'] && !player.chainOut) {
    player.chainOut = true;
    player.chainTimer = 30;
  }
  
  // Update punch/chain timers
  if (player.punchTimer > 0) {
    player.punchTimer--;
    if (player.punchTimer === 0) player.punching = null;
  }
  if (player.chainTimer > 0) {
    player.chainTimer--;
    if (player.chainTimer === 0) player.chainOut = false;
  }
  if (player.invincible > 0) player.invincible--;
  
  // Friction
  player.speed = Math.max(0, player.speed - player.friction);
  
  // Boundaries
  player.x = Math.max(50, Math.min(W - 50, player.x));
  
  // Scroll road
  road.scroll += player.speed;
  distance += player.speed;
  score = Math.floor(distance / 10);
  
  // Spawn rivals
  if (rivals.length < 5 && Math.random() < 0.01) {
    spawnRival();
  }
  
  // Spawn traffic
  if (traffic.length < 4 && Math.random() < 0.02) {
    spawnTraffic();
  }
  
  // Update rivals
  rivals.forEach(rival => {
    // Move relative to player speed
    rival.y += player.speed - rival.speed;
    
    // Basic AI - try to match player lane
    if (rival.y > 0 && rival.y < H) {
      if (rival.x < player.x - 30) rival.x += 1;
      if (rival.x > player.x + 30) rival.x -= 1;
    }
    
    // Attack player if close
    if (Math.abs(rival.x - player.x) < 40 && Math.abs(rival.y - player.y) < 50) {
      if (!rival.attacking && Math.random() < 0.05) {
        rival.attacking = true;
        rival.attackTimer = 20;
      }
    }
    
    if (rival.attackTimer > 0) {
      rival.attackTimer--;
      if (rival.attackTimer === 0) {
        rival.attacking = false;
        // Deal damage if still close
        if (Math.abs(rival.x - player.x) < 40 && Math.abs(rival.y - player.y) < 50) {
          if (player.invincible === 0) {
            player.health -= 10;
            player.invincible = 30;
          }
        }
      }
    }
    
    // Check if player punch hits rival
    if (player.punchTimer > 8 && player.punchTimer < 12) {
      const punchX = player.punching === 'left' ? player.x - 30 : player.x + 30;
      if (Math.abs(punchX - rival.x) < 25 && Math.abs(player.y - rival.y) < 40) {
        rival.health -= 15;
        rival.x += player.punching === 'left' ? -20 : 20;
        score += 50;
      }
    }
    
    // Check chain attack
    if (player.chainOut && player.chainTimer > 15) {
      const chainReach = 60;
      if (Math.abs(player.x - rival.x) < chainReach && Math.abs(player.y - rival.y) < 50) {
        rival.health -= 25;
        rival.x += (rival.x > player.x) ? 30 : -30;
        score += 100;
      }
    }
  });
  
  // Remove dead/offscreen rivals
  rivals = rivals.filter(r => r.health > 0 && r.y < H + 100 && r.y > -200);
  
  // Update traffic
  traffic.forEach(car => {
    car.y += player.speed + car.speed;
    
    // Collision with player
    if (Math.abs(car.x - player.x) < (car.width + player.width) / 2 &&
        Math.abs(car.y - player.y) < (car.height + player.height) / 2) {
      if (player.invincible === 0) {
        player.health -= 30;
        player.speed = Math.max(0, player.speed - 5);
        player.invincible = 60;
      }
    }
  });
  
  // Remove offscreen traffic
  traffic = traffic.filter(c => c.y > -100 && c.y < H + 100);
  
  // Check game over
  if (player.health <= 0) {
    gameRunning = false;
    gameOverScreen.style.display = 'flex';
    finalScoreEl.textContent = score;
  }
  
  // Update UI
  scoreEl.textContent = score;
  speedEl.textContent = Math.floor(player.speed * 15);
  const healthBars = Math.max(0, Math.floor(player.health / 10));
  healthEl.textContent = '█'.repeat(healthBars) + '░'.repeat(10 - healthBars);
  healthEl.style.color = player.health > 50 ? '#0f0' : player.health > 25 ? '#ff0' : '#f00';
}

function draw() {
  // Clear
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, W, H);
  
  // Draw road
  ctx.fillStyle = '#333';
  ctx.fillRect(40, 0, road.lanes * road.laneWidth + 40, H);
  
  // Road edges
  ctx.fillStyle = '#ff0';
  ctx.fillRect(40, 0, 4, H);
  ctx.fillRect(40 + road.lanes * road.laneWidth + 36, 0, 4, H);
  
  // Lane lines
  ctx.fillStyle = '#fff';
  const lineOffset = road.scroll % road.lineGap;
  for (let lane = 1; lane < road.lanes; lane++) {
    const x = 60 + lane * road.laneWidth;
    for (let y = -road.lineGap + lineOffset; y < H + road.lineGap; y += road.lineGap) {
      ctx.fillRect(x - 2, y, 4, 20);
    }
  }
  
  // Draw traffic
  traffic.forEach(car => {
    ctx.fillStyle = car.color;
    ctx.fillRect(car.x - car.width / 2, car.y - car.height / 2, car.width, car.height);
    // Windshield
    ctx.fillStyle = '#aaf';
    ctx.fillRect(car.x - car.width / 2 + 4, car.y - car.height / 2 + 5, car.width - 8, 12);
  });
  
  // Draw rivals
  rivals.forEach(rival => {
    // Bike body
    ctx.fillStyle = rival.color;
    ctx.fillRect(rival.x - rival.width / 2, rival.y - rival.height / 2, rival.width, rival.height);
    
    // Rider
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(rival.x, rival.y - 10, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Attack indicator
    if (rival.attacking) {
      ctx.fillStyle = '#f00';
      ctx.fillRect(rival.x - 20, rival.y, 40, 4);
    }
  });
  
  // Draw player
  const flash = player.invincible > 0 && player.invincible % 6 < 3;
  if (!flash) {
    // Bike
    ctx.fillStyle = '#f80';
    ctx.fillRect(player.x - player.width / 2, player.y - player.height / 2, player.width, player.height);
    
    // Rider
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(player.x, player.y - 10, 8, 0, Math.PI * 2);
    ctx.fill();
    
    // Helmet
    ctx.fillStyle = '#f00';
    ctx.beginPath();
    ctx.arc(player.x, player.y - 12, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw punch
  if (player.punching && player.punchTimer > 5) {
    ctx.fillStyle = '#ff0';
    const punchX = player.punching === 'left' ? player.x - 25 : player.x + 15;
    ctx.fillRect(punchX, player.y - 5, 15, 10);
  }
  
  // Draw chain
  if (player.chainOut && player.chainTimer > 10) {
    ctx.strokeStyle = '#aaa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    const chainX = player.x + Math.sin(player.chainTimer * 0.5) * 50;
    const chainY = player.y - 30;
    ctx.lineTo(chainX, chainY);
    ctx.stroke();
    
    // Chain end
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(chainX, chainY, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function gameLoop() {
  if (!gameRunning) return;
  
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// Initial draw
draw();
