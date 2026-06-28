const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Device mode ('desktop' | 'mobile') ---
let deviceMode = 'desktop';

// --- Background images (per device, with custom override) ---
const bgDesktop = new Image();
bgDesktop.src = 'images/backgrounddesktop.jpg';
const bgMobile = new Image();
bgMobile.src = 'images/backgroundmobile.jpg';

// Custom uploaded background (overrides default when set)
let customBgImage = null;

// Returns the active background image for the current device
function activeBg() {
  if (customBgImage) return customBgImage;
  return deviceMode === 'mobile' ? bgMobile : bgDesktop;
}

// --- Enemy images ---
const enemyImg = new Image();
enemyImg.src = 'images/enemy.png';
const bossEnemyImg = new Image();
bossEnemyImg.src = 'images/boss enemy.png';

// --- Spaceship texture ---
const shipImages = { centre: new Image() };
shipImages.centre.src = 'images/fighter centre.png';

// --- Bullet images ---
const bulletImg1 = new Image();
bulletImg1.src = 'images/bullet1.png';
const bulletImg2 = new Image();
bulletImg2.src = 'images/bullet2.png';

// --- Player ---
const player = {
  x: canvas.width / 2,
  y: canvas.height - 70,
  width: 70,
  height: 70,
  speed: 5
};

// --- Game state ---
let gameRunning = false;
let gameOver    = false;
let gamePaused  = false;
let score = 0;
let lives = 3;
let level = 1;
let _diffStep = 0; // cached; updated in updateLevel()
const MAX_LIVES        = 3;
const POINTS_PER_LEVEL = 100;

// --- High score (persisted across sessions) ---
let highScore = parseInt(localStorage.getItem('spaceShooterHighScore') || '0', 10);

function updateHighScore() {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('spaceShooterHighScore', highScore);
  }
}
// Legacy variables kept only so resetGame/pauseToMenu don't error
let shieldActive  = false;
let shieldEndTime = 0;
const SHIELD_DURATION = 10000; // matches power-up duration

// --- Bullets ---
const bullets = [];
const BULLET_SPEED_BASE = 8;
// After level 3, bullet speed increases by 0.5 per difficultyStep (capped at 18)
function bulletSpeed() {
  return _diffStep >= 2 ? Math.min(18, BULLET_SPEED_BASE + (_diffStep - 1) * 0.5) : BULLET_SPEED_BASE;
}
const BULLET_WIDTH  = 4;
const BULLET_HEIGHT = 12;
const SHOOT_COOLDOWN = 250;
let lastShotTime = 0;

// --- Input modes ---
const inputMode = { move: 'mouse', attack: 'mouse' };

// --- Rebindable controls ---
const bindings = {
  left:   ['ArrowLeft', 'a'],
  right:  ['ArrowRight', 'd'],
  attack: [' ']
};

const keys = { left: false, right: false, attack: false };

// Reverse lookup: lowercase key string → action name. Rebuilt on rebind.
const keyToAction = new Map();
function buildKeyMap() {
  keyToAction.clear();
  for (const [action, keyList] of Object.entries(bindings)) {
    for (const k of keyList) keyToAction.set(k.toLowerCase(), action);
  }
}
buildKeyMap();

function getActionForKey(key) {
  return keyToAction.get(key.toLowerCase()) ?? null;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') { if (gameOver) { restartGame(); return; } }
  if (e.key === 'Escape') {
    if (gameOver) return;
    if (gamePaused) { resumeGame(); return; }
    if (gameRunning) { pauseGame(); return; }
    return;
  }
  if (listeningFor) { rebind(listeningFor, e.key); return; }
  const action = getActionForKey(e.key);
  if (action) { keys[action] = true; if (e.key === ' ') e.preventDefault(); }
});

document.addEventListener('keyup', (e) => {
  const action = getActionForKey(e.key);
  if (action) keys[action] = false;
});

// --- Mouse ---
let mouseX = null;

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
});

canvas.addEventListener('mouseleave', () => { mouseX = null; });

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && inputMode.attack === 'mouse') keys.attack = true;
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) keys.attack = false;
});

// --- Touch controls (mobile) ---
let touchX = null;

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  resumeAudio();
  const rect = canvas.getBoundingClientRect();
  touchX = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  touchX = (e.touches[0].clientX - rect.left) * (canvas.width / rect.width);
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  touchX = null;
}, { passive: false });

// --- Audio ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playShootSound() {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.12);
  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
  osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.12);
}

function playExplosionSound() {
  const bufferSize = audioCtx.sampleRate * 0.25;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = 180; filter.Q.value = 0.8;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.6, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
  source.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
  source.start(audioCtx.currentTime); source.stop(audioCtx.currentTime + 0.25);
}

function resumeAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }
document.addEventListener('keydown',   resumeAudio, { once: true });
document.addEventListener('mousedown', resumeAudio, { once: true });
document.addEventListener('touchstart', resumeAudio, { once: true });

// --- Shoot ---
function shoot(now) {
  const cooldown = isRapidfire() ? SHOOT_COOLDOWN / 2 : SHOOT_COOLDOWN;
  if (now - lastShotTime < cooldown) return;
  lastShotTime = now;
  const tipY = player.y - player.height / 2;
  if (isTripleshot()) {
    bullets.push({ x: player.x - 14, y: tipY });
    bullets.push({ x: player.x,      y: tipY });
    bullets.push({ x: player.x + 14, y: tipY });
  } else {
    bullets.push({ x: player.x, y: tipY });
  }
  playShootSound();
}

// --- Draw player ---
function drawPlayer() {
  const { x, y, width: w, height: h } = player;
  const img = shipImages.centre;

  // Shield glow ring when power-up is active
  if (isPowerShield()) {
    const remaining = Math.max(0, (activePowerups.shield.endTime - Date.now()) / POWERUP_DURATION);
    ctx.beginPath();
    ctx.arc(x, y, w * 0.65, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 220, 255, ${0.4 + remaining * 0.5})`;
    ctx.shadowColor = '#00ddff';
    ctx.shadowBlur  = 18;
    ctx.lineWidth   = 3;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  if (img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2);
    ctx.lineTo(x - w / 2, y + h / 2);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.closePath();
    ctx.fillStyle = '#0055ff';
    ctx.fill();
  }
}

// --- Draw bullets ---
function drawBullets() {
  // Use bullet2 when rapidfire or tripleshot power-up is active, else bullet1
  const hasPowerup = isRapidfire() || isTripleshot();
  const img = hasPowerup ? bulletImg2 : bulletImg1;
  const useImg = img.complete && img.naturalWidth > 0;

  if (!useImg) {
    // Fallback: yellow rectangle
    ctx.fillStyle = hasPowerup ? '#ff8800' : '#ffee00';
    ctx.shadowColor = hasPowerup ? '#ff4400' : '#ffaa00';
    ctx.shadowBlur = 6;
  }

  for (const b of bullets) {
    if (useImg) {
      ctx.drawImage(img, b.x - BULLET_WIDTH / 2, b.y - BULLET_HEIGHT / 2, BULLET_WIDTH, BULLET_HEIGHT);
    } else {
      ctx.fillRect(b.x - BULLET_WIDTH / 2, b.y - BULLET_HEIGHT / 2, BULLET_WIDTH, BULLET_HEIGHT);
    }
  }

  ctx.shadowBlur = 0;
}

// --- Particles ---
const particles = [];
const EXPLOSION_COLORS = ['#ff6600', '#ff3300', '#ffaa00', '#ff0000', '#ffcc44'];

function spawnExplosion(x, y, isBoss) {
  const count  = isBoss ? 28 : 14;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = isBoss ? (2 + Math.random() * 5) : (1.5 + Math.random() * 3.5);
    const size  = isBoss ? (3 + Math.random() * 4) : (2 + Math.random() * 3);
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      color: EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)],
      alpha: 1,
      decay: 0.02 + Math.random() * 0.03
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.93; p.vy *= 0.93;
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
const BOSS_SIZE           = 64;
const BOSS_SPEED          = 1.2;
const BOSS_SPAWN_INTERVAL = 30000;
let boss          = null;
let lastBossSpawn = 0;

function spawnBoss(now) {
  if (boss) return;
  if (now - lastBossSpawn < BOSS_SPAWN_INTERVAL) return;
  lastBossSpawn = now;
  const hp = 2 + Math.floor(Math.random() * 4);
  boss = { x: BOSS_SIZE / 2 + Math.random() * (canvas.width - BOSS_SIZE), y: -BOSS_SIZE / 2, hp, maxHp: hp };
}

function drawBoss() {
  if (!boss) return;
  const { x, y } = boss;
  const s = BOSS_SIZE;

  if (bossEnemyImg.complete && bossEnemyImg.naturalWidth > 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);   // -90° left so right-facing boss faces downward
    ctx.drawImage(bossEnemyImg, -s / 2, -s / 2, s, s);
    ctx.restore();
  } else {
    const grad = ctx.createLinearGradient(x - s/2, y - s/2, x + s/2, y + s/2);
    grad.addColorStop(0, '#cc44ff'); grad.addColorStop(1, '#660099');
    ctx.fillStyle = grad;
    ctx.fillRect(x - s/2, y - s/2, s, s);
    ctx.strokeStyle = '#dd00ff'; ctx.shadowColor = '#cc00ff';
    ctx.shadowBlur = 16; ctx.lineWidth = 2;
    ctx.strokeRect(x - s/2, y - s/2, s, s);
    ctx.shadowBlur = 0;
  }

  // Health bar
  const barW = s, barH = 7, barX = x - s/2, barY = y - s/2 - barH - 4;
  const hpPct = boss.hp / boss.maxHp;
  ctx.fillStyle = '#330033'; ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = hpPct > 0.5 ? '#cc44ff' : (hpPct > 0.25 ? '#ff88ff' : '#ff44aa');
  ctx.fillRect(barX, barY, barW * hpPct, barH);
  ctx.strokeStyle = '#dd00ff'; ctx.lineWidth = 1; ctx.strokeRect(barX, barY, barW, barH);

  ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#ffffff'; ctx.fillText('BOSS', x, barY);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function bulletHitsBoss(bullet) {
  if (!boss) return false;
  const m = HIT_MARGIN;
  return (
    bullet.x + BULLET_WIDTH  / 2 > boss.x - BOSS_SIZE / 2 - m &&
    bullet.x - BULLET_WIDTH  / 2 < boss.x + BOSS_SIZE / 2 + m &&
    bullet.y + BULLET_HEIGHT / 2 > boss.y - BOSS_SIZE / 2 - m &&
    bullet.y - BULLET_HEIGHT / 2 < boss.y + BOSS_SIZE / 2 + m
  );
}

function updateBoss(now) {
  spawnBoss(now);
  if (!boss) return;
  boss.y += BOSS_SPEED;
  if (boss.y - BOSS_SIZE / 2 > canvas.height) {
    boss = null;
    // Boss crossing bottom = instant game over
    lives = 0;
    triggerGameOver();
  }
}

function checkBulletBossCollisions(now) {
  if (!boss) return;
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    if (bulletHitsBoss(bullets[bi])) {
      bullets.splice(bi, 1);
      boss.hp--;
      if (boss.hp <= 0) {
        spawnExplosion(boss.x, boss.y, true);
        playExplosionSound();
        score += boss.maxHp * 10;
        const bx = boss.x, by = boss.y;
        boss = null;
        lastBossSpawn = now;
        // Drop a random power-up at boss position
        spawnPowerup(bx, by);
      }
      break;
    }
  }
}

// --- Enemies ---
const enemies = [];
const ENEMY_SIZE    = 32;
const HIT_MARGIN    = 2;  // bullet counts as hit within 2px around the enemy edge
// --- Difficulty scaling ---
// Levels 1-10: increase every 2 levels (step = 0.5 levels worth of increments)
// Level 11+:   increase every level
function difficultyStep() { return _diffStep; }

function enemySpeed()         { return (2 + difficultyStep() * 0.4) * (isDebuff() ? 0.4 : 1); }
function enemySpawnInterval() { return Math.max(200, 1000 - difficultyStep() * 80); }
let lastEnemySpawn = 0;

function spawnEnemy(now) {
  if (now - lastEnemySpawn < enemySpawnInterval()) return;
  lastEnemySpawn = now;
  const x = Math.random() * (canvas.width - ENEMY_SIZE) + ENEMY_SIZE / 2;
  enemies.push({ x, y: -ENEMY_SIZE / 2 });
}

function drawEnemies() {
  const useImg = enemyImg.complete && enemyImg.naturalWidth > 0;
  for (const enemy of enemies) {
    if (useImg) {
      ctx.save();
      ctx.translate(enemy.x, enemy.y);
      ctx.rotate(Math.PI / 2);   // +90° right so right-facing enemy faces downward
      ctx.drawImage(enemyImg, -ENEMY_SIZE / 2, -ENEMY_SIZE / 2, ENEMY_SIZE, ENEMY_SIZE);
      ctx.restore();
    } else {
      const grad = ctx.createLinearGradient(
        enemy.x - ENEMY_SIZE/2, enemy.y - ENEMY_SIZE/2,
        enemy.x + ENEMY_SIZE/2, enemy.y + ENEMY_SIZE/2
      );
      grad.addColorStop(0, '#ff4444'); grad.addColorStop(1, '#aa0000');
      ctx.fillStyle = grad;
      ctx.fillRect(enemy.x - ENEMY_SIZE/2, enemy.y - ENEMY_SIZE/2, ENEMY_SIZE, ENEMY_SIZE);
      ctx.strokeStyle = '#ff0000'; ctx.shadowColor = '#ff2200';
      ctx.shadowBlur = 8; ctx.lineWidth = 1.5;
      ctx.strokeRect(enemy.x - ENEMY_SIZE/2, enemy.y - ENEMY_SIZE/2, ENEMY_SIZE, ENEMY_SIZE);
      ctx.shadowBlur = 0;
    }
  }
}

// AABB collision — hitbox expanded 2px outward so near-misses count as hits
function bulletHitsEnemy(bullet, enemy) {
  const m = HIT_MARGIN;
  return (
    bullet.x + BULLET_WIDTH  / 2 > enemy.x - ENEMY_SIZE / 2 - m &&
    bullet.x - BULLET_WIDTH  / 2 < enemy.x + ENEMY_SIZE / 2 + m &&
    bullet.y + BULLET_HEIGHT / 2 > enemy.y - ENEMY_SIZE / 2 - m &&
    bullet.y - BULLET_HEIGHT / 2 < enemy.y + ENEMY_SIZE / 2 + m
  );
}

function updateEnemies(now) {
  spawnEnemy(now);
  const spd = enemySpeed();
  for (let i = enemies.length - 1; i >= 0; i--) {
    enemies[i].y += spd;
    if (enemies[i].y - ENEMY_SIZE / 2 > canvas.height) {
      enemies.splice(i, 1);
      if (isPowerShield()) continue; // shield power-up active — no life lost
      lives--;
      if (lives <= 0) { lives = 0; triggerGameOver(); }
    }
  }
}

function checkBulletEnemyCollisions() {
  for (let bi = bullets.length - 1; bi >= 0; bi--) {
    for (let ei = enemies.length - 1; ei >= 0; ei--) {
      if (bulletHitsEnemy(bullets[bi], enemies[ei])) {
        const ex = enemies[ei].x, ey = enemies[ei].y;
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

// --- Power-ups ---
const POWERUP_SIZE     = 36;
const POWERUP_SPEED    = 1.6;
const POWERUP_DURATION = 10000; // 10 seconds for timed power-ups
const POWERUP_INTERVAL = 120000; // 2 minutes passive drop

const POWERUP_TYPES = ['health', 'shield', 'rapidfire', 'tripleshot', 'debuff'];

const powerupImgs = {};
const powerupSrcs = {
  health:     'images/health.png',
  shield:     'images/sheild.png',
  rapidfire:  'images/2xattack.png',
  tripleshot: 'images/trippleatack.png',
  debuff:     'images/Debuff.png'
};
for (const [type, src] of Object.entries(powerupSrcs)) {
  const img = new Image();
  img.src = src;
  powerupImgs[type] = img;
}

// Active power-up state
const activePowerups = {
  shield:     { active: false, endTime: 0 },
  rapidfire:  { active: false, endTime: 0 },
  tripleshot: { active: false, endTime: 0 },
  debuff:     { active: false, endTime: 0 }
};

const fallingPowerups = [];
let lastPassivePowerup = 0;

function randomPowerupType() {
  return POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
}

function spawnPowerup(x, y) {
  fallingPowerups.push({ x, y, type: randomPowerupType() });
}

function spawnPassivePowerup(now) {
  if (now - lastPassivePowerup < POWERUP_INTERVAL) return;
  lastPassivePowerup = now;
  const x = POWERUP_SIZE / 2 + Math.random() * (canvas.width - POWERUP_SIZE);
  spawnPowerup(x, -POWERUP_SIZE / 2);
}

function applyPowerup(type) {
  const now = Date.now();
  if (type === 'health') {
    if (lives < MAX_LIVES) lives++;
    return; // no timer needed
  }
  activePowerups[type].active  = true;
  activePowerups[type].endTime = now + POWERUP_DURATION;
}

function updatePowerups(now) {
  spawnPassivePowerup(now);

  // Move falling power-ups down
  for (let i = fallingPowerups.length - 1; i >= 0; i--) {
    const pu = fallingPowerups[i];
    pu.y += POWERUP_SPEED;

    // Check player catch
    const hw = player.width  / 2;
    const hh = player.height / 2;
    if (
      pu.x + POWERUP_SIZE / 2 > player.x - hw &&
      pu.x - POWERUP_SIZE / 2 < player.x + hw &&
      pu.y + POWERUP_SIZE / 2 > player.y - hh &&
      pu.y - POWERUP_SIZE / 2 < player.y + hh
    ) {
      applyPowerup(pu.type);
      fallingPowerups.splice(i, 1);
      continue;
    }

    // Off screen
    if (pu.y - POWERUP_SIZE / 2 > canvas.height) fallingPowerups.splice(i, 1);
  }

  // Expire timed power-ups
  for (const [type, state] of Object.entries(activePowerups)) {
    if (state.active && now >= state.endTime) state.active = false;
  }
}

const POWERUP_FALLBACK_COLORS = { health:'#ff4466', shield:'#00ddff', rapidfire:'#ffee00', tripleshot:'#ff8800', debuff:'#88ff44' };

function drawPowerups() {
  for (const pu of fallingPowerups) {
    const img = powerupImgs[pu.type];
    const s   = POWERUP_SIZE;
    // Glow pulse
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur  = 10;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, pu.x - s / 2, pu.y - s / 2, s, s);
    } else {
      // Fallback coloured circle
      ctx.fillStyle = POWERUP_FALLBACK_COLORS[pu.type] || '#ffffff';
      ctx.beginPath(); ctx.arc(pu.x, pu.y, s / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  }
}

// Expose helper for shoot() to check power-ups
function isRapidfire()  { return activePowerups.rapidfire.active;  }
function isTripleshot() { return activePowerups.tripleshot.active; }
function isDebuff()     { return activePowerups.debuff.active;     }
function isPowerShield(){ return activePowerups.shield.active;     }

function updateLevel() {
  const newLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;
  if (newLevel > level) {
    level = newLevel;
    _diffStep = level <= 10 ? Math.floor((level - 1) / 2) : 5 + (level - 10);
  }
}

// --- Shield timer handled by updatePowerups ---
function updateShield() {} // no-op; shield is now a power-up

// --- Update ---
function update() {
  const now = Date.now();
  // Active target X: touch on mobile, mouse on desktop
  const targetX = (deviceMode === 'mobile' && touchX !== null) ? touchX :
                  (inputMode.move === 'mouse' && mouseX !== null) ? mouseX : null;

  if (targetX !== null) {
    const diff = targetX - player.x;
    if (Math.abs(diff) > 1) player.x += diff * 0.15;
  }

  if (inputMode.move === 'keyboard') {
    if (keys.left)  player.x -= player.speed;
    if (keys.right) player.x += player.speed;
  }

  const halfW = player.width / 2;
  if (player.x - halfW < 0)            player.x = halfW;
  if (player.x + halfW > canvas.width) player.x = canvas.width - halfW;

  // Auto-shoot on mobile; manual otherwise
  if (deviceMode === 'mobile' || keys.attack) shoot(now);

  const bspd = bulletSpeed();
  for (let i = bullets.length - 1; i >= 0; i--) {
    bullets[i].y -= bspd;
    if (bullets[i].y + BULLET_HEIGHT / 2 < 0) bullets.splice(i, 1);
  }

  updateLevel();
  updateShield();
  updatePowerups(now);
  updateEnemies(now);
  updateBoss(now);
  checkBulletEnemyCollisions();
  checkBulletBossCollisions(now);
  updateParticles();
}

// --- HUD helpers ---
let _hudScale = 1; // set once per draw() call
function hudScale() { return _hudScale; }

let _bgSrc = { img: null, cw: 0, ch: 0, x: 0, y: 0, w: 0, h: 0 };

function drawBackground() {
  const bg = activeBg();
  if (bg && bg.complete && bg.naturalWidth > 0) {
    if (bg !== _bgSrc.img || canvas.width !== _bgSrc.cw || canvas.height !== _bgSrc.ch) {
      const imgW = bg.naturalWidth, imgH = bg.naturalHeight;
      const cR = canvas.width / canvas.height, iR = imgW / imgH;
      if (iR > cR) { _bgSrc.h = imgH; _bgSrc.w = imgH * cR; _bgSrc.x = (imgW - _bgSrc.w) / 2; _bgSrc.y = 0; }
      else         { _bgSrc.w = imgW; _bgSrc.h = imgW / cR;  _bgSrc.x = 0; _bgSrc.y = (imgH - _bgSrc.h) / 2; }
      _bgSrc.img = bg; _bgSrc.cw = canvas.width; _bgSrc.ch = canvas.height;
    }
    ctx.drawImage(bg, _bgSrc.x, _bgSrc.y, _bgSrc.w, _bgSrc.h, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#000010'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawBadge(text, bx, by) {
  const sc = hudScale();
  const padX = 14 * sc, padY = 10 * sc, fontSize = 18 * sc;
  ctx.font = `bold ${fontSize}px Arial`;
  const boxW = ctx.measureText(text).width + padX * 2;
  const boxH = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(10,30,120,0.75)';
  ctx.beginPath(); ctx.roundRect(bx, by, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(80,140,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(text, bx + padX, by + boxH / 2);
  ctx.textBaseline = 'alphabetic';
  return boxH;
}

function drawScore() { drawBadge(`SCORE  ${score}`, 16, 16); }

function drawLevel() {
  const text = `LEVEL  ${level}`;
  const sc = hudScale(), padX = 14 * sc, fontSize = 18 * sc;
  ctx.font = `bold ${fontSize}px Arial`;
  const boxW = ctx.measureText(text).width + padX * 2;
  drawBadge(text, (canvas.width - boxW) / 2, 16);
}

function drawLives() {
  const sc = hudScale();
  const heartSize = 18 * sc, padX = 14 * sc, padY = 10 * sc, fontSize = 18 * sc;
  const shieldOn = isPowerShield();
  const label = shieldOn ? '🛡 SHIELD' : 'LIVES';
  ctx.font = `bold ${fontSize}px Arial`;
  const labelW = ctx.measureText(label).width;
  const totalIconW = MAX_LIVES * (heartSize + 6 * sc) - 6 * sc;
  const boxW = padX * 2 + labelW + 10 * sc + (shieldOn ? 0 : totalIconW);
  const boxH = fontSize + padY * 2;
  const boxX = canvas.width - boxW - 16;
  const boxY = 16;

  ctx.fillStyle = shieldOn ? 'rgba(0,80,160,0.85)' : 'rgba(10,30,120,0.75)';
  ctx.beginPath(); ctx.roundRect(boxX, boxY, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = shieldOn ? '#00ddff' : 'rgba(80,140,255,0.6)';
  ctx.lineWidth = 1.5; ctx.stroke();

  ctx.fillStyle = shieldOn ? '#00eeff' : '#ffffff';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(label, boxX + padX, boxY + boxH / 2);

  if (!shieldOn) {
    const iconsX = boxX + padX + labelW + 10 * sc;
    ctx.font = `${heartSize}px Arial`;
    for (let i = 0; i < MAX_LIVES; i++) {
      ctx.fillStyle = i < lives ? '#ff4466' : 'rgba(255,255,255,0.15)';
      ctx.fillText('♥', iconsX + i * (heartSize + 6 * sc), boxY + boxH / 2);
    }
  }

  ctx.textBaseline = 'alphabetic'; ctx.font = `bold ${18 * sc}px Arial`;
}

// --- Active power-up HUD (bottom-left icons with timer bars) ---
function drawActivePowerupHUD() {
  const sc = hudScale();
  const iconSize = 28 * sc;
  const padding  = 6 * sc;
  const barH     = 4 * sc;
  const startX   = 16;
  let   curX     = startX;
  const baseY    = canvas.height - iconSize - barH - padding * 2 - 16;

  const now = Date.now();
  for (const [type, state] of Object.entries(activePowerups)) {
    if (!state.active) continue;
    const img      = powerupImgs[type];
    const fraction = Math.max(0, (state.endTime - now) / POWERUP_DURATION);

    // Icon background
    ctx.fillStyle = 'rgba(0,0,20,0.7)';
    ctx.beginPath();
    ctx.roundRect(curX, baseY, iconSize, iconSize, 4 * sc);
    ctx.fill();

    // Icon
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 6;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, curX, baseY, iconSize, iconSize);
    } else {
      ctx.fillStyle = POWERUP_FALLBACK_COLORS[type] || '#fff';
      ctx.beginPath(); ctx.arc(curX + iconSize/2, baseY + iconSize/2, iconSize/2 - 2, 0, Math.PI*2); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Timer bar
    const barY  = baseY + iconSize + padding;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(curX, barY, iconSize, barH);
    ctx.fillStyle = fraction > 0.3 ? '#00ffaa' : '#ff4444';
    ctx.fillRect(curX, barY, iconSize * fraction, barH);

    curX += iconSize + padding;
  }
}

function draw() {
  _hudScale = deviceMode === 'mobile' ? Math.min(canvas.width / 800, canvas.height / 600) * 1.4 : 1;
  drawBackground();
  drawParticles();
  drawPowerups();
  drawEnemies();
  drawBoss();
  drawBullets();
  drawPlayer();
  drawScore();
  drawLevel();
  drawLives();
  drawActivePowerupHUD();
}

// --- Game over screen ---
function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2, cy = canvas.height / 2;
  ctx.font = 'bold 72px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff2222'; ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 24;
  ctx.fillText('GAME OVER', cx, cy - 70); ctx.shadowBlur = 0;
  ctx.font = 'bold 28px Arial'; ctx.fillStyle = '#ffffff';
  ctx.fillText(`Score: ${score}`, cx, cy - 10);
  ctx.font = 'bold 20px Arial'; ctx.fillStyle = '#ffd700';
  ctx.fillText(`Best: ${highScore}`, cx, cy + 26);
  ctx.font = '20px Arial'; ctx.fillStyle = '#ffdd88';
  ctx.fillText('Press R to Restart', cx, cy + 64);
  ctx.font = '16px Arial'; ctx.fillStyle = '#aac8ff';
  ctx.fillText('or click  ▶ Menu  below', cx, cy + 96);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
}

function triggerGameOver() {
  updateHighScore();
  gameRunning = false; gameOver = true;
  keys.left = false; keys.right = false; keys.attack = false;
  draw(); drawGameOver();
  restartBtn.style.display  = 'block';
  goMenuBtn.style.display   = 'block';
  playBtn.style.display     = 'none';
  gameOverScore.textContent = `Score: ${score}`;
  document.getElementById('gameOverHigh').textContent = `Best: ${highScore}`;
  gameOverInfo.style.display  = 'block';
  menuTitle.style.display     = 'none';
  menuTagline.style.display   = 'none';
  menu.style.display          = 'flex';
}

// --- Reset ---
function resetGame() {
  score = 0; lives = MAX_LIVES; level = 1; _diffStep = 0;
  gameOver = false; gamePaused = false;
  shieldActive = false; shieldEndTime = 0;
  enemies.length = 0; bullets.length = 0; particles.length = 0;
  fallingPowerups.length = 0;
  for (const state of Object.values(activePowerups)) { state.active = false; state.endTime = 0; }
  lastPassivePowerup = 0;
  boss = null; player.x = canvas.width / 2;
  keys.left = false; keys.right = false; keys.attack = false;
  lastEnemySpawn = 0; lastBossSpawn = 0;
}

function restartGame() {
  resetGame();
  menu.style.display = 'none';
  restartBtn.style.display = 'none'; goMenuBtn.style.display = 'none';
  playBtn.style.display    = 'block';
  gameOverInfo.style.display = 'none';
  menuTitle.style.display    = 'block'; menuTagline.style.display = 'block';
  gameRunning = true; gameLoop();
}

// --- Game loop ---
function gameLoop() {
  if (!gameRunning) return;
  update(); draw();
  requestAnimationFrame(gameLoop);
}

// --- Pause ---
function pauseGame() {
  gameRunning = false; gamePaused = true;
  keys.left = false; keys.right = false; keys.attack = false;
  pauseMenu.style.display = 'flex';
}

function resumeGame() {
  gamePaused = false; gameRunning = true;
  pauseMenu.style.display = 'none';
  gameLoop();
}

function goToMainMenu() {
  gamePaused = false;
  pauseMenu.style.display = 'none';
  pauseToMenu();
}

function pauseToMenu() {
  gameRunning = false; gameOver = false; gamePaused = false;
  keys.left = false; keys.right = false; keys.attack = false;
  enemies.length = 0; bullets.length = 0; particles.length = 0;
  boss = null; score = 0; lives = MAX_LIVES; level = 1;
  shieldActive = false; shieldEndTime = 0;
  fallingPowerups.length = 0;
  for (const state of Object.values(activePowerups)) { state.active = false; state.endTime = 0; }
  lastPassivePowerup = 0;
  // Always restore desktop canvas when returning to main menu
  applyDesktopMode();
  player.x = canvas.width / 2;
  restartBtn.style.display = 'none'; goMenuBtn.style.display = 'none';
  playBtn.style.display    = 'block';
  gameOverInfo.style.display = 'none';
  menuTitle.style.display    = 'block'; menuTagline.style.display = 'block';
  menu.style.display = 'flex';
  drawBackground(); drawPlayer();
}

// --- Mobile canvas setup ---
function applyMobileMode() {
  document.body.classList.add('mobile-mode');
  canvas.width  = 480;
  canvas.height = 854;
  player.x = canvas.width / 2;
  player.y = canvas.height - 90;
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {});
  }
  inputMode.attack = 'auto';
  inputMode.move   = 'touch';
}

function applyDesktopMode() {
  document.body.classList.remove('mobile-mode');
  // Restore canvas to fixed desktop size and remove any inline CSS overrides
  canvas.width  = 800;
  canvas.height = 600;
  canvas.style.width  = '';
  canvas.style.height = '';
  player.x = canvas.width / 2;
  player.y = canvas.height - 70;
  if (screen.orientation && screen.orientation.unlock) {
    screen.orientation.unlock();
  }
  inputMode.attack = 'mouse';
  inputMode.move   = 'mouse';
}

// --- DOM refs ---
const pauseMenu      = document.getElementById('pauseMenu');
const resumeBtn      = document.getElementById('resumeBtn');
const pauseGoMenuBtn = document.getElementById('pauseGoMenuBtn');
const menu           = document.getElementById('menu');
const playBtn        = document.getElementById('playBtn');
const restartBtn     = document.getElementById('restartBtn');
const goMenuBtn      = document.getElementById('goMenuBtn');
const controlsBtn    = document.getElementById('controlsBtn');
const controlsPanel  = document.getElementById('controlsPanel');
const backBtn        = document.getElementById('backBtn');
const bindNote       = document.getElementById('bindNote');
const moveBindsEl    = document.getElementById('moveBinds');
const attackBindsEl  = document.getElementById('attackBinds');
const gameOverInfo   = document.getElementById('gameOverInfo');
const gameOverScore  = document.getElementById('gameOverScore');
const menuTitle      = document.getElementById('menuTitle');
const menuTagline    = document.getElementById('menuTagline');

// --- Device toggle ---
document.getElementById('deviceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  deviceMode = btn.dataset.device;
  document.querySelectorAll('#deviceToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.device === deviceMode);
  });
  // Hide controls button on mobile (not needed — auto attack + touch)
  controlsBtn.style.display = deviceMode === 'mobile' ? 'none' : '';
});

// --- Controls panel ---
function displayKey(key) {
  if (key === ' ')          return 'Space';
  if (key === 'ArrowLeft')  return '← Arrow';
  if (key === 'ArrowRight') return '→ Arrow';
  if (key === 'ArrowUp')    return '↑ Arrow';
  if (key === 'ArrowDown')  return '↓ Arrow';
  return key.length === 1 ? key.toUpperCase() : key;
}

function refreshBindLabels() {
  document.getElementById('key-left').textContent   = bindings.left.map(displayKey).join(' / ');
  document.getElementById('key-right').textContent  = bindings.right.map(displayKey).join(' / ');
  document.getElementById('key-attack').textContent = bindings.attack.map(displayKey).join(' / ');
}

function refreshBindVisibility() {
  moveBindsEl.classList.toggle('visible',   inputMode.move   === 'keyboard');
  attackBindsEl.classList.toggle('visible', inputMode.attack === 'keyboard');
}

function refreshToggles() {
  document.querySelectorAll('#moveToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === inputMode.move);
  });
  document.querySelectorAll('#attackToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === inputMode.attack);
  });
}

document.getElementById('moveToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn'); if (!btn) return;
  inputMode.move = btn.dataset.mode;
  if (inputMode.move === 'mouse') { keys.left = false; keys.right = false; }
  refreshToggles(); refreshBindVisibility(); stopListening();
});

document.getElementById('attackToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn'); if (!btn) return;
  inputMode.attack = btn.dataset.mode;
  keys.attack = false;
  refreshToggles(); refreshBindVisibility(); stopListening();
});

let listeningFor = null;

function rebind(action, newKey) {
  const blocked = ['Escape','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];
  if (blocked.includes(newKey)) { stopListening(); return; }
  for (const [a, keyList] of Object.entries(bindings)) {
    const idx = keyList.map(k => k.toLowerCase()).indexOf(newKey.toLowerCase());
    if (idx !== -1 && a !== action) keyList.splice(idx, 1);
  }
  bindings[action] = [newKey];
  buildKeyMap();
  stopListening();
  bindNote.textContent = `✓ Bound to "${displayKey(newKey)}"`;
  setTimeout(() => { bindNote.textContent = ''; }, 2000);
}

function stopListening() {
  if (listeningFor) {
    const btn = document.querySelector(`.bind-btn[data-action="${listeningFor}"]`);
    if (btn) btn.classList.remove('listening');
  }
  listeningFor = null; refreshBindLabels();
}

document.querySelectorAll('.bind-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    if (listeningFor === action) { stopListening(); return; }
    stopListening(); listeningFor = action;
    btn.classList.add('listening');
    bindNote.textContent = `Press any key for "${action}"…`;
  });
});

controlsBtn.addEventListener('click', () => {
  menu.style.display = 'none';
  refreshBindLabels(); refreshToggles(); refreshBindVisibility();
  bindNote.textContent = '';
  controlsPanel.style.display = 'flex';
});

backBtn.addEventListener('click', () => {
  stopListening(); controlsPanel.style.display = 'none'; menu.style.display = 'flex';
});

function startGame() {
  if (deviceMode === 'mobile') applyMobileMode();
  else                         applyDesktopMode();
  resetGame();
  gameRunning = true;
  menu.style.display = 'none';
  gameLoop();
}

playBtn.addEventListener('click',        startGame);
restartBtn.addEventListener('click',     restartGame);
goMenuBtn.addEventListener('click',      pauseToMenu);
resumeBtn.addEventListener('click',      resumeGame);
pauseGoMenuBtn.addEventListener('click', goToMainMenu);

// --- Background upload ---
const bgUpload     = document.getElementById('bgUpload');
const bgResetBtn   = document.getElementById('bgResetBtn');
const bgUploadName = document.getElementById('bgUploadName');

bgUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    customBgImage = img;
    bgUploadName.textContent = `✓ ${file.name}`;
    drawBackground(); drawPlayer();
  };
  img.src = url;
});

bgResetBtn.addEventListener('click', () => {
  customBgImage = null;
  bgUpload.value = '';
  bgUploadName.textContent = '';
  drawBackground(); drawPlayer();
});

// --- Initial menu frame ---
function drawMenuFrame() { drawBackground(); drawPlayer(); }

bgDesktop.onload  = drawMenuFrame;
bgDesktop.onerror = drawMenuFrame;
