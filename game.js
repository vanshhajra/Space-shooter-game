const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Background image ---
const bgImage = new Image();
bgImage.src = 'space.jpg';

// --- Spaceship texture (centre only) ---
const shipImages = {
  centre: new Image()
};
shipImages.centre.src = 'fighter centre.png';

// --- Player ---
const player = {
  x: canvas.width / 2,
  y: canvas.height - 70,
  width:  82,
  height: 82,
  speed: 5
};

// --- Game state ---
let gameRunning = false;
let gameOver    = false;
let gamePaused  = false;
let score = 0;
let lives = 3;
let level = 1;
const MAX_LIVES = 3;
const POINTS_PER_LEVEL = 100;   // score threshold to advance a level

// --- Bullets ---
const bullets = [];
const BULLET_SPEED = 8;
const BULLET_WIDTH = 4;
const BULLET_HEIGHT = 12;
const SHOOT_COOLDOWN = 250; // milliseconds
let lastShotTime = 0;

// --- Input modes ---
// 'mouse' | 'keyboard' for movement; 'mouse' | 'keyboard' for attack
const inputMode = {
  move:   'mouse',     // default: mouse follows cursor
  attack: 'mouse'      // default: left click shoots
};

// --- Rebindable controls (keyboard keys per action) ---
const bindings = {
  left:   ['ArrowLeft', 'a'],
  right:  ['ArrowRight', 'd'],
  attack: [' ']
};

// --- Keyboard state ---
const keys = {
  left:   false,
  right:  false,
  attack: false
};

function getActionForKey(key) {
  for (const [action, keyList] of Object.entries(bindings)) {
    if (keyList.map(k => k.toLowerCase()).includes(key.toLowerCase())) return action;
  }
  return null;
}

document.addEventListener('keydown', (e) => {
  // R — restart after game over
  if (e.key === 'r' || e.key === 'R') {
    if (gameOver) { restartGame(); return; }
  }
  // Escape — toggle pause (only during active gameplay)
  if (e.key === 'Escape') {
    if (gameOver) return;
    if (gamePaused) { resumeGame(); return; }
    if (gameRunning) { pauseGame(); return; }
    return;
  }
  if (listeningFor) {
    rebind(listeningFor, e.key);
    return;
  }
  const action = getActionForKey(e.key);
  if (action) {
    keys[action] = true;
    if (e.key === ' ') e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  const action = getActionForKey(e.key);
  if (action) keys[action] = false;
});

// --- Mouse position tracking ---
let mouseX = null;

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
});

canvas.addEventListener('mouseleave', () => {
  mouseX = null;
});

// --- Mouse left-click to shoot (only in mouse attack mode) ---
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && inputMode.attack === 'mouse') keys.attack = true;
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) keys.attack = false;
});

// --- Audio (Web Audio API — no files needed) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Short laser "pew" for shooting
function playShootSound() {
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.12);

  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);

  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.12);
}

// Explosion burst for enemy destroyed
function playExplosionSound() {
  // White-noise burst via AudioBuffer
  const bufferSize = audioCtx.sampleRate * 0.25; // 0.25 s
  const buffer     = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data       = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;

  // Band-pass filter to give it a punchy "boom" character
  const filter = audioCtx.createBiquadFilter();
  filter.type            = 'bandpass';
  filter.frequency.value = 180;
  filter.Q.value         = 0.8;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  source.start(audioCtx.currentTime);
  source.stop(audioCtx.currentTime + 0.25);
}

// Resume AudioContext on first user interaction (browser autoplay policy)
function resumeAudio() {
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
document.addEventListener('keydown',   resumeAudio, { once: true });
document.addEventListener('mousedown', resumeAudio, { once: true });

function shoot() {
  const now = Date.now();
  if (now - lastShotTime < SHOOT_COOLDOWN) return;
  lastShotTime = now;

  bullets.push({
    x: player.x,
    y: player.y - player.height / 2  // tip of the triangle
  });

  playShootSound();
}

// --- Draw player spaceship using centre sprite ---
function drawPlayer() {
  const x = player.x;
  const y = player.y;
  const w = player.width;
  const h = player.height;

  const img = shipImages.centre;

  if (img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    // Fallback triangle while image loads
    ctx.beginPath();
    ctx.moveTo(x,         y - h / 2);
    ctx.lineTo(x - w / 2, y + h / 2);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.closePath();
    ctx.fillStyle = '#0055ff';
    ctx.fill();
  }
}

// --- Draw all bullets ---
function drawBullets() {
  ctx.fillStyle = '#ffee00';
  ctx.shadowColor = '#ffaa00';
  ctx.shadowBlur = 6;

  for (const bullet of bullets) {
    ctx.fillRect(
      bullet.x - BULLET_WIDTH / 2,
      bullet.y - BULLET_HEIGHT / 2,
      BULLET_WIDTH,
      BULLET_HEIGHT
    );
  }

  // Reset shadow so it doesn't affect other drawings
  ctx.shadowBlur = 0;
}

// --- Particles ---
const particles = [];

function spawnExplosion(x, y, isBoss) {
  const count  = isBoss ? 28 : 14;
  const colors = ['#ff6600', '#ff3300', '#ffaa00', '#ff0000', '#ffcc44'];
  for (let i = 0; i < count; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const speed  = isBoss ? (2 + Math.random() * 5) : (1.5 + Math.random() * 3.5);
    const size   = isBoss ? (3 + Math.random() * 4) : (2 + Math.random() * 3);
    particles.push({
      x, y,
      vx:      Math.cos(angle) * speed,
      vy:      Math.sin(angle) * speed,
      size,
      color:   colors[Math.floor(Math.random() * colors.length)],
      alpha:   1,
      decay:   0.02 + Math.random() * 0.03   // fade speed
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x     += p.vx;
    p.y     += p.vy;
    p.vx    *= 0.93;   // friction
    p.vy    *= 0.93;
    p.alpha -= p.decay;
    if (p.alpha <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle   = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur  = 0;
}

// --- Boss ---
const BOSS_SIZE            = 64;
const BOSS_SPEED           = 1.2;
const BOSS_SPAWN_INTERVAL  = 30000; // 30 seconds
let boss            = null;
let lastBossSpawn   = 0;   // starts counting from game start

function spawnBoss(now) {
  if (boss) return;                              // only one boss at a time
  if (now - lastBossSpawn < BOSS_SPAWN_INTERVAL) return;
  lastBossSpawn = now;

  const hp = 2 + Math.floor(Math.random() * 4); // 2–5
  boss = {
    x:    BOSS_SIZE / 2 + Math.random() * (canvas.width - BOSS_SIZE),
    y:    -BOSS_SIZE / 2,
    hp,
    maxHp: hp
  };
}

function drawBoss() {
  if (!boss) return;
  const { x, y } = boss;
  const s = BOSS_SIZE;

  // Purple gradient body
  const grad = ctx.createLinearGradient(x - s/2, y - s/2, x + s/2, y + s/2);
  grad.addColorStop(0, '#cc44ff');
  grad.addColorStop(1, '#660099');
  ctx.fillStyle = grad;
  ctx.fillRect(x - s/2, y - s/2, s, s);

  // Purple glow border
  ctx.strokeStyle = '#dd00ff';
  ctx.shadowColor = '#cc00ff';
  ctx.shadowBlur  = 16;
  ctx.lineWidth   = 2;
  ctx.strokeRect(x - s/2, y - s/2, s, s);
  ctx.shadowBlur  = 0;

  // Health bar
  const barW  = s;
  const barH  = 7;
  const barX  = x - s/2;
  const barY  = y - s/2 - barH - 4;
  const hpPct = boss.hp / boss.maxHp;

  ctx.fillStyle = '#330033';
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = hpPct > 0.5 ? '#cc44ff' : (hpPct > 0.25 ? '#ff88ff' : '#ff44aa');
  ctx.fillRect(barX, barY, barW * hpPct, barH);

  ctx.strokeStyle = '#dd00ff';
  ctx.lineWidth   = 1;
  ctx.strokeRect(barX, barY, barW, barH);

  // "BOSS" label
  ctx.font         = 'bold 11px Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle    = '#ffffff';
  ctx.fillText('BOSS', x, barY);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

function bulletHitsBoss(bullet) {
  if (!boss) return false;
  return (
    bullet.x + BULLET_WIDTH  / 2 > boss.x - BOSS_SIZE / 2 &&
    bullet.x - BULLET_WIDTH  / 2 < boss.x + BOSS_SIZE / 2 &&
    bullet.y + BULLET_HEIGHT / 2 > boss.y - BOSS_SIZE / 2 &&
    bullet.y - BULLET_HEIGHT / 2 < boss.y + BOSS_SIZE / 2
  );
}

function updateBoss(now) {
  spawnBoss(now);
  if (!boss) return;

  boss.y += BOSS_SPEED;

  // Boss reached the bottom — lose a life, remove boss
  if (boss.y - BOSS_SIZE / 2 > canvas.height) {
    boss = null;
    lives--;
    if (lives <= 0) { lives = 0; triggerGameOver(); }
  }
}

function checkBulletBossCollisions() {
  if (!boss) return;
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    if (bulletHitsBoss(bullets[bi])) {
      bullets.splice(bi, 1);
      boss.hp--;
      if (boss.hp <= 0) {
        spawnExplosion(boss.x, boss.y, true);
        playExplosionSound();
        score += boss.maxHp * 10;     // e.g. 5 hp = 50 pts
        boss = null;
        lastBossSpawn = Date.now();   // reset 30 s timer after kill
      }
      break;
    }
  }
}

const enemies = [];
const ENEMY_SIZE   = 32;
// Speed and spawn interval scale with level
function enemySpeed()          { return 2  + (level - 1) * 0.4; }        // +0.4 px/frame per level
function enemySpawnInterval()  { return Math.max(300, 1000 - (level - 1) * 100); } // -100 ms per level, min 300 ms
let lastEnemySpawn = 0;

function spawnEnemy() {
  const now = Date.now();
  if (now - lastEnemySpawn < enemySpawnInterval()) return;
  lastEnemySpawn = now;

  const x = Math.random() * (canvas.width - ENEMY_SIZE) + ENEMY_SIZE / 2;
  enemies.push({ x, y: -ENEMY_SIZE / 2 });
}

function drawEnemies() {
  for (const enemy of enemies) {
    // Red gradient fill
    const grad = ctx.createLinearGradient(
      enemy.x - ENEMY_SIZE / 2, enemy.y - ENEMY_SIZE / 2,
      enemy.x + ENEMY_SIZE / 2, enemy.y + ENEMY_SIZE / 2
    );
    grad.addColorStop(0, '#ff4444');
    grad.addColorStop(1, '#aa0000');

    ctx.fillStyle = grad;
    ctx.fillRect(enemy.x - ENEMY_SIZE / 2, enemy.y - ENEMY_SIZE / 2, ENEMY_SIZE, ENEMY_SIZE);

    // Red glow border
    ctx.strokeStyle = '#ff0000';
    ctx.shadowColor  = '#ff2200';
    ctx.shadowBlur   = 8;
    ctx.lineWidth    = 1.5;
    ctx.strokeRect(enemy.x - ENEMY_SIZE / 2, enemy.y - ENEMY_SIZE / 2, ENEMY_SIZE, ENEMY_SIZE);
    ctx.shadowBlur = 0;
  }
}

// AABB collision between a bullet and an enemy
function bulletHitsEnemy(bullet, enemy) {
  return (
    bullet.x + BULLET_WIDTH  / 2 > enemy.x - ENEMY_SIZE / 2 &&
    bullet.x - BULLET_WIDTH  / 2 < enemy.x + ENEMY_SIZE / 2 &&
    bullet.y + BULLET_HEIGHT / 2 > enemy.y - ENEMY_SIZE / 2 &&
    bullet.y - BULLET_HEIGHT / 2 < enemy.y + ENEMY_SIZE / 2
  );
}

function updateEnemies() {
  spawnEnemy();

  const spd = enemySpeed();
  for (let i = enemies.length - 1; i >= 0; i--) {
    enemies[i].y += spd;
    if (enemies[i].y - ENEMY_SIZE / 2 > canvas.height) {
      enemies.splice(i, 1);
      lives--;
      if (lives <= 0) {
        lives = 0;
        triggerGameOver();
      }
    }
  }
}

function checkBulletEnemyCollisions() {
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      if (bulletHitsEnemy(bullets[bi], enemies[ei])) {
        const ex = enemies[ei].x;
        const ey = enemies[ei].y;
        bullets.splice(bi, 1);
        enemies.splice(ei, 1);
        spawnExplosion(ex, ey, false);
        playExplosionSound();
        score += 10;
        break;
      }
    }
  }
}

function update() {
  // Mouse follow — only when move mode is 'mouse'
  if (inputMode.move === 'mouse' && mouseX !== null) {
    const diff = mouseX - player.x;
    if (Math.abs(diff) > 1) {
      player.x += diff * 0.15;
    }
  }

  // Keyboard movement — only when move mode is 'keyboard'
  if (inputMode.move === 'keyboard') {
    if (keys.left)  player.x -= player.speed;
    if (keys.right) player.x += player.speed;
  }

  // Keep ship within canvas boundaries
  const halfW = player.width / 2;
  if (player.x - halfW < 0)             player.x = halfW;
  if (player.x + halfW > canvas.width)  player.x = canvas.width - halfW;

  // Shoot
  if (keys.attack) shoot();

  // Move bullets upward and remove ones that left the screen
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= BULLET_SPEED;
    if (bullets[i].y + BULLET_HEIGHT / 2 < 0) {
      bullets.splice(i, 1);
    }
  }

  // Enemies + boss + particles
  const now = Date.now();
  updateLevel();
  updateEnemies();
  updateBoss(now);
  checkBulletEnemyCollisions();
  checkBulletBossCollisions();
  updateParticles();
}

// --- Draw lives (top-right) ---
function drawLives() {
  const heartSize = 18;
  const padX = 14;
  const padY = 10;
  const fontSize = 18;
  const label = 'LIVES';

  ctx.font = `bold ${fontSize}px Arial`;
  const labelW  = ctx.measureText(label).width;
  const totalIconW = MAX_LIVES * (heartSize + 6) - 6;
  const boxW = padX * 2 + labelW + 10 + totalIconW;
  const boxH = fontSize + padY * 2;
  const boxX = canvas.width - boxW - 16;
  const boxY = 16;

  // Blue badge background
  ctx.fillStyle = 'rgba(10, 30, 120, 0.75)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(80, 140, 255, 0.6)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // "LIVES" label
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText(label, boxX + padX, boxY + boxH / 2);

  // Heart icons — filled for remaining, dim for lost
  const iconsStartX = boxX + padX + labelW + 10;
  const iconsY      = boxY + boxH / 2;

  for (let i = 0; i < MAX_LIVES; i++) {
    ctx.font = `${heartSize}px Arial`;
    ctx.fillStyle = i < lives ? '#ff4466' : 'rgba(255,255,255,0.15)';
    ctx.fillText('♥', iconsStartX + i * (heartSize + 6), iconsY);
  }

  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 18px Arial';
}

// --- Game Over screen (drawn on canvas) ---
function drawGameOver() {
  // Darken the canvas
  ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width  / 2;
  const cy = canvas.height / 2;

  // "GAME OVER"
  ctx.font         = 'bold 72px Arial';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#ff2222';
  ctx.shadowColor  = '#ff0000';
  ctx.shadowBlur   = 24;
  ctx.fillText('GAME OVER', cx, cy - 60);
  ctx.shadowBlur   = 0;

  // Final score
  ctx.font      = 'bold 28px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`Score: ${score}`, cx, cy);

  // Press R
  ctx.font      = '20px Arial';
  ctx.fillStyle = '#ffdd88';
  ctx.fillText('Press R to Restart', cx, cy + 50);

  // Go to Menu hint
  ctx.font      = '16px Arial';
  ctx.fillStyle = '#aac8ff';
  ctx.fillText('or click  ▶ Menu  below', cx, cy + 84);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

// --- Trigger game over ---
function triggerGameOver() {
  gameRunning = false;
  gameOver    = true;
  keys.left   = false;
  keys.right  = false;
  keys.attack = false;

  // Draw the final frame + overlay
  draw();
  drawGameOver();

  // Show the menu with Restart + Go to Menu buttons visible
  restartBtn.style.display  = 'block';
  goMenuBtn.style.display   = 'block';
  playBtn.style.display     = 'none';
  // Show game over info, hide normal title/tagline
  gameOverScore.textContent = `Score: ${score}`;
  gameOverInfo.style.display  = 'block';
  menuTitle.style.display     = 'none';
  menuTagline.style.display   = 'none';
  menu.style.display          = 'flex';
}

// --- Shared reset helper ---
function resetGame() {
  score           = 0;
  lives           = MAX_LIVES;
  level           = 1;
  gameOver        = false;
  gamePaused      = false;
  enemies.length  = 0;
  bullets.length  = 0;
  particles.length = 0;
  boss            = null;
  player.x        = canvas.width / 2;
  keys.left       = false;
  keys.right      = false;
  keys.attack     = false;
  lastEnemySpawn  = 0;
  lastBossSpawn   = 0;
}

// --- Restart without going through menu ---
function restartGame() {
  resetGame();
  menu.style.display        = 'none';
  restartBtn.style.display  = 'none';
  goMenuBtn.style.display   = 'none';
  playBtn.style.display     = 'block';
  gameOverInfo.style.display  = 'none';
  menuTitle.style.display     = 'block';
  menuTagline.style.display   = 'block';
  gameRunning = true;
  gameLoop();
}

// --- Level system ---
function updateLevel() {
  const newLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;
  if (newLevel > level) {
    level = newLevel;
  }
}

// --- Draw level badge (top-center) ---
function drawLevel() {
  const text     = `LEVEL  ${level}`;
  const padX     = 14;
  const padY     = 10;
  const fontSize = 18;

  ctx.font = `bold ${fontSize}px Arial`;
  const textW = ctx.measureText(text).width;
  const boxW  = textW + padX * 2;
  const boxH  = fontSize + padY * 2;
  const boxX  = (canvas.width - boxW) / 2;   // centered
  const boxY  = 16;

  // Blue badge (same palette as score/lives)
  ctx.fillStyle = 'rgba(10, 30, 120, 0.75)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();

  ctx.strokeStyle = 'rgba(80, 140, 255, 0.6)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText(text, boxX + padX, boxY + boxH / 2);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

// --- Draw score badge (top-left) ---
function drawScore() {
  const text    = `SCORE  ${score}`;
  const padX    = 14;
  const padY    = 10;
  const fontSize = 18;

  ctx.font = `bold ${fontSize}px Arial`;
  const textW = ctx.measureText(text).width;
  const boxX  = 16;
  const boxY  = 16;
  const boxW  = textW + padX * 2;
  const boxH  = fontSize + padY * 2;

  // Blue background with slight transparency
  ctx.fillStyle = 'rgba(10, 30, 120, 0.75)';
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();

  // Subtle blue border
  ctx.strokeStyle = 'rgba(80, 140, 255, 0.6)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // White score text
  ctx.fillStyle    = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText(text, boxX + padX, boxY + boxH / 2);

  // Reset baseline/align for other draw calls
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign    = 'left';
}

function drawBackground() {
  if (bgImage.complete && bgImage.naturalWidth > 0) {
    const imgW = bgImage.naturalWidth;
    const imgH = bgImage.naturalHeight;
    const canvasRatio = canvas.width / canvas.height;
    const imgRatio    = imgW / imgH;

    let srcX, srcY, srcW, srcH;

    if (imgRatio > canvasRatio) {
      // Image is wider than canvas — crop sides
      srcH = imgH;
      srcW = imgH * canvasRatio;
      srcX = (imgW - srcW) / 2;
      srcY = 0;
    } else {
      // Image is taller than canvas — crop top/bottom
      srcW = imgW;
      srcH = imgW / canvasRatio;
      srcX = 0;
      srcY = (imgH - srcH) / 2;
    }

    ctx.drawImage(bgImage, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#000010';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// --- Draw everything ---
function draw() {
  drawBackground();
  drawParticles();
  drawEnemies();
  drawBoss();
  drawBullets();
  drawPlayer();
  drawScore();
  drawLevel();
  drawLives();
}

// --- Game loop ---
function gameLoop() {
  if (!gameRunning) return;   // stop the loop when paused/in menu
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// --- Pause (ESC) — keeps all game state intact ---
function pauseGame() {
  gameRunning = false;
  gamePaused  = true;
  keys.left   = false;
  keys.right  = false;
  keys.attack = false;
  pauseMenu.style.display = 'flex';
}

function resumeGame() {
  gamePaused  = false;
  gameRunning = true;
  pauseMenu.style.display = 'none';
  gameLoop();
}

// --- Go to main menu — resets everything ---
function goToMainMenu() {
  gamePaused  = false;
  pauseMenu.style.display = 'none';
  pauseToMenu();
}

// --- Pause and show main menu (full reset) ---
function pauseToMenu() {
  gameRunning = false;
  gameOver    = false;
  gamePaused  = false;
  keys.left   = false;
  keys.right  = false;
  keys.attack = false;
  enemies.length   = 0;
  bullets.length   = 0;
  particles.length = 0;
  boss     = null;
  score    = 0;
  lives    = MAX_LIVES;
  level    = 1;
  player.x = canvas.width / 2;
  restartBtn.style.display  = 'none';
  goMenuBtn.style.display   = 'none';
  playBtn.style.display     = 'block';
  gameOverInfo.style.display  = 'none';
  menuTitle.style.display     = 'block';
  menuTagline.style.display   = 'block';
  menu.style.display = 'flex';
  drawBackground();
  drawPlayer();
}

// --- Menu ---
const pauseMenu       = document.getElementById('pauseMenu');
const resumeBtn       = document.getElementById('resumeBtn');
const pauseGoMenuBtn  = document.getElementById('pauseGoMenuBtn');
const menu          = document.getElementById('menu');
const playBtn       = document.getElementById('playBtn');
const restartBtn    = document.getElementById('restartBtn');
const goMenuBtn     = document.getElementById('goMenuBtn');
const controlsBtn   = document.getElementById('controlsBtn');
const controlsPanel = document.getElementById('controlsPanel');
const backBtn       = document.getElementById('backBtn');
const bindNote      = document.getElementById('bindNote');
const moveBindsEl   = document.getElementById('moveBinds');
const attackBindsEl = document.getElementById('attackBinds');
const gameOverInfo  = document.getElementById('gameOverInfo');
const gameOverScore = document.getElementById('gameOverScore');
const menuTitle     = document.getElementById('menuTitle');
const menuTagline   = document.getElementById('menuTagline');

// Pretty-print a key name for display
function displayKey(key) {
  if (key === ' ')          return 'Space';
  if (key === 'ArrowLeft')  return '← Arrow';
  if (key === 'ArrowRight') return '→ Arrow';
  if (key === 'ArrowUp')    return '↑ Arrow';
  if (key === 'ArrowDown')  return '↓ Arrow';
  return key.length === 1 ? key.toUpperCase() : key;
}

// Update the displayed key labels in the controls panel
function refreshBindLabels() {
  document.getElementById('key-left').textContent   = bindings.left.map(displayKey).join(' / ');
  document.getElementById('key-right').textContent  = bindings.right.map(displayKey).join(' / ');
  document.getElementById('key-attack').textContent = bindings.attack.map(displayKey).join(' / ');
}

// Show/hide bind rows based on current modes
function refreshBindVisibility() {
  moveBindsEl.classList.toggle('visible',   inputMode.move   === 'keyboard');
  attackBindsEl.classList.toggle('visible', inputMode.attack === 'keyboard');
}

// Update toggle button active states
function refreshToggles() {
  document.querySelectorAll('#moveToggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === inputMode.move);
  });
  document.querySelectorAll('#attackToggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === inputMode.attack);
  });
}

// --- Toggle group clicks ---
document.getElementById('moveToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  inputMode.move = btn.dataset.mode;
  // In mouse mode clear keyboard move keys so ship doesn't drift
  if (inputMode.move === 'mouse') { keys.left = false; keys.right = false; }
  refreshToggles();
  refreshBindVisibility();
  stopListening();
});

document.getElementById('attackToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  inputMode.attack = btn.dataset.mode;
  keys.attack = false;
  refreshToggles();
  refreshBindVisibility();
  stopListening();
});

// --- Rebind logic ---
let listeningFor = null;

function rebind(action, newKey) {
  const blocked = ['Escape', 'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];
  if (blocked.includes(newKey)) { stopListening(); return; }

  for (const [a, keyList] of Object.entries(bindings)) {
    const idx = keyList.map(k => k.toLowerCase()).indexOf(newKey.toLowerCase());
    if (idx !== -1 && a !== action) keyList.splice(idx, 1);
  }

  bindings[action] = [newKey];
  stopListening();
  bindNote.textContent = `✓ Bound to "${displayKey(newKey)}"`;
  setTimeout(() => { bindNote.textContent = ''; }, 2000);
}

function stopListening() {
  if (listeningFor) {
    const btn = document.querySelector(`.bind-btn[data-action="${listeningFor}"]`);
    if (btn) btn.classList.remove('listening');
  }
  listeningFor = null;
  refreshBindLabels();
}

document.querySelectorAll('.bind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (listeningFor === action) { stopListening(); return; }
    stopListening();
    listeningFor = action;
    btn.classList.add('listening');
    bindNote.textContent = `Press any key for "${action}"…`;
  });
});

// Controls panel navigation
controlsBtn.addEventListener('click', () => {
  menu.style.display = 'none';
  refreshBindLabels();
  refreshToggles();
  refreshBindVisibility();
  bindNote.textContent = '';
  controlsPanel.style.display = 'flex';
});

backBtn.addEventListener('click', () => {
  stopListening();
  controlsPanel.style.display = 'none';
  menu.style.display = 'flex';
});

function startGame() {
  resetGame();
  gameRunning = true;
  menu.style.display = 'none';
  gameLoop();
}

playBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', restartGame);
goMenuBtn.addEventListener('click', pauseToMenu);
resumeBtn.addEventListener('click', resumeGame);
pauseGoMenuBtn.addEventListener('click', goToMainMenu);

function drawMenuFrame() {
  drawBackground();
  drawPlayer();
}

bgImage.onload  = drawMenuFrame;
bgImage.onerror = drawMenuFrame;
