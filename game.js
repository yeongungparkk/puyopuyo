// ============================================================
//  PUYO PUYO — Single-Player Clone
//  Grid: 6 columns x 12 rows + 2 hidden rows above (total 14)
// ============================================================

// ---- Config ----
const COLS = 6;
const ROWS = 12;
const HIDDEN_ROWS = 2;          // spawn area above visible grid
const TOTAL_ROWS = ROWS + HIDDEN_ROWS;
const CELL = 50;                // pixel size of one cell
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple'];

const DROP_INTERVAL = 600;       // ms between gravity steps
const SOFT_DROP_INTERVAL = 40;    // ms when holding Down
const LOCK_DELAY = 400;           // ms before a grounded piece locks
const ANIM_POP_DELAY = 350;       // ms for pop animation
const ANIM_GRAVITY_DELAY = 250;   // ms for gravity re-drop

// ---- Canvas ----
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');

canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

// ---- Game State ----
let grid;               // 2D array [TOTAL_ROWS][COLS], null or color string
let currentPair;        // { puyos: [{r,c,color}, {r,c,color}], rotation: 0-3 }
let nextPair;
let score;
let chainCount;
let gameState;          // 'menu' | 'playing' | 'pausing' | 'gameover' | 'animating'
let dropTimer;
let dropInterval;
let lockTimer;
let lastTime;

// Animation state
let poppingPuyos;       // array of {r,c,color}
let popAnimTimer;
let gravityAnimTimer;

// ---- Color palette for drawing ----
const COLOR_MAP = {
  red:    { fill: '#e74c3c', light: '#ff6b5a', dark: '#a83020', eye: '#fff' },
  blue:   { fill: '#3498db', light: '#5ab0ea', dark: '#2070a0', eye: '#fff' },
  green:  { fill: '#2ecc71', light: '#4ee091', dark: '#1a9e50', eye: '#fff' },
  yellow: { fill: '#f1c40f', light: '#ffe03a', dark: '#c0a000', eye: '#333' },
  purple: { fill: '#9b59b6', light: '#bb79d6', dark: '#6e3a80', eye: '#fff' },
};

// ============================================================
//  INITIALIZATION
// ============================================================

function initGrid() {
  grid = [];
  for (let r = 0; r < TOTAL_ROWS; r++) {
    grid.push(new Array(COLS).fill(null));
  }
}

function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function makePair() {
  return {
    puyos: [
      { r: 0, c: 2, color: randomColor() },         // pivot (bottom)
      { r: -1, c: 2, color: randomColor() },         // partner (top)
    ],
    rotation: 0,
  };
}

// ============================================================
//  PAIR MOVEMENT
// ============================================================

function canPlace(r, c) {
  if (c < 0 || c >= COLS) return false;
  if (r < 0) return true; // above grid is okay
  if (r >= TOTAL_ROWS) return false;
  return grid[r][c] === null;
}

function canPairBeAt(pair, r0, c0, r1, c1) {
  return canPlace(r0, c0) && canPlace(r1, c1);
}

function movePair(dr, dc) {
  const p = currentPair;
  const nr0 = p.puyos[0].r + dr;
  const nc0 = p.puyos[0].c + dc;
  const nr1 = p.puyos[1].r + dr;
  const nc1 = p.puyos[1].c + dc;
  if (canPairBeAt(p, nr0, nc0, nr1, nc1)) {
    p.puyos[0].r = nr0;
    p.puyos[0].c = nc0;
    p.puyos[1].r = nr1;
    p.puyos[1].c = nc1;
    return true;
  }
  return false;
}

// Rotation offsets based on rotation state (0=up,1=right,2=down,3=left)
// puyos[0] is the pivot, puyos[1] rotates around it
const ROT_OFFSETS = [
  { dr: -1, dc: 0 },   // 0: partner above
  { dr: 0, dc: 1 },    // 1: partner right
  { dr: 1, dc: 0 },    // 2: partner below
  { dr: 0, dc: -1 },   // 3: partner left
];

function rotatePair(dir) {
  // dir = 1 (CW) or -1 (CCW)
  const p = currentPair;
  const newRot = ((p.rotation + dir) % 4 + 4) % 4;
  const offset = ROT_OFFSETS[newRot];
  const pivot = p.puyos[0];
  let nr = pivot.r + offset.dr;
  let nc = pivot.c + offset.dc;

  // If blocked, try wall kicks (shift pivot)
  const kicks = [[0,0],[0,1],[0,-1],[0,2],[0,-2]];
  for (const [kr, kc] of kicks) {
    const pr = pivot.r + kr;
    const pc = pivot.c + kc;
    const tr = pr + offset.dr;
    const tc = pc + offset.dc;
    if (canPlace(pr, pc) && canPlace(tr, tc)) {
      p.puyos[0].r = pr;
      p.puyos[0].c = pc;
      p.puyos[1].r = tr;
      p.puyos[1].c = tc;
      p.rotation = newRot;
      return true;
    }
  }
  return false;
}

// ============================================================
//  GRAVITY (for falling pair & post-pop re-drop)
// ============================================================

function isPairGrounded() {
  const p = currentPair;
  // Check if either puyo can move down
  for (const puyo of p.puyos) {
    const below = puyo.r + 1;
    if (below >= TOTAL_ROWS) return true;
    if (grid[below][puyo.c] !== null) return true;
  }
  return false;
}

function lockPair() {
  const p = currentPair;
  for (const puyo of p.puyos) {
    if (puyo.r >= 0 && puyo.r < TOTAL_ROWS) {
      grid[puyo.r][puyo.c] = puyo.color;
    } else {
      // Locked above the visible grid = game over
      gameOver();
      return;
    }
  }
  // Start chain detection
  gameState = 'animating';
  chainCount = 0;
  processChains();
}

// ============================================================
//  CHAIN DETECTION & POPPING
// ============================================================

function findConnectedGroups() {
  const visited = [];
  for (let r = 0; r < TOTAL_ROWS; r++) {
    visited.push(new Array(COLS).fill(false));
  }
  const groups = [];

  for (let r = 0; r < TOTAL_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== null && !visited[r][c]) {
        const color = grid[r][c];
        const group = [];
        const stack = [[r, c]];
        while (stack.length > 0) {
          const [cr, cc] = stack.pop();
          if (cr < 0 || cr >= TOTAL_ROWS || cc < 0 || cc >= COLS) continue;
          if (visited[cr][cc]) continue;
          if (grid[cr][cc] !== color) continue;
          visited[cr][cc] = true;
          group.push({ r: cr, c: cc });
          stack.push([cr + 1, cc]);
          stack.push([cr - 1, cc]);
          stack.push([cr, cc + 1]);
          stack.push([cr, cc - 1]);
        }
        if (group.length >= 4) {
          groups.push({ color, puyos: group });
        }
      }
    }
  }
  return groups;
}

function processChains() {
  const groups = findConnectedGroups();
  if (groups.length === 0) {
    // No more pops — check game over, then spawn next
    chainCount = 0;
    updateUI();
    spawnNextPair();
    return;
  }

  chainCount++;
  poppingPuyos = [];
  let totalPopped = 0;

  for (const g of groups) {
    for (const puyo of g.puyos) {
      poppingPuyos.push({ ...puyo, color: grid[puyo.r][puyo.c] });
      grid[puyo.r][puyo.c] = null;
      totalPopped++;
    }
  }

  // Score: base points * chain multiplier * puyo count
  const chainBonus = [1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 480, 512];
  const puyoBonus = [0, 1, 2, 3, 4, 5, 6, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 37, 40];
  const cBonus = chainBonus[Math.min(chainCount - 1, chainBonus.length - 1)];
  const pBonus = puyoBonus[Math.min(totalPopped - 1, puyoBonus.length - 1)];
  const gained = totalPopped * 10 * Math.max(cBonus, pBonus, 1);
  score += gained;

  updateUI();
  popAnimTimer = ANIM_POP_DELAY;
}

function applyGravity() {
  // For each column, drop all non-null puyos down
  for (let c = 0; c < COLS; c++) {
    let writeRow = TOTAL_ROWS - 1;
    for (let r = TOTAL_ROWS - 1; r >= 0; r--) {
      if (grid[r][c] !== null) {
        if (r !== writeRow) {
          grid[writeRow][c] = grid[r][c];
          grid[r][c] = null;
        }
        writeRow--;
      }
    }
  }
  // After gravity, check for chains again
  gravityAnimTimer = ANIM_GRAVITY_DELAY;
}

// ============================================================
//  SPAWN & GAME OVER
// ============================================================

function spawnNextPair() {
  currentPair = nextPair;
  nextPair = makePair();
  drawNext();

  // Check if spawn position is blocked
  const p = currentPair;
  const blocked = !canPlace(p.puyos[0].r, p.puyos[0].c) || !canPlace(p.puyos[1].r, p.puyos[1].c);
  if (blocked) {
    gameOver();
    return;
  }

  gameState = 'playing';
  dropTimer = 0;
  lockTimer = 0;
  dropInterval = DROP_INTERVAL;
}

function gameOver() {
  gameState = 'gameover';
  showOverlay('GAME OVER', `Score: ${score}`, 'PLAY AGAIN');
}

// ============================================================
//  UPDATE LOOP
// ============================================================

function update(deltaTime) {
  if (gameState === 'playing') {
    dropTimer += deltaTime;
    const interval = (keys.down ? SOFT_DROP_INTERVAL : dropInterval);

    if (dropTimer >= interval) {
      dropTimer = 0;
      if (!movePair(1, 0)) {
        // Can't move down — start lock timer
        lockTimer += interval;
        if (lockTimer >= LOCK_DELAY) {
          lockPair();
        }
      } else {
        lockTimer = 0;
      }
    }
  } else if (gameState === 'animating') {
    if (popAnimTimer > 0) {
      popAnimTimer -= deltaTime;
      if (popAnimTimer <= 0) {
        popAnimTimer = 0;
        applyGravity();
      }
    } else if (gravityAnimTimer > 0) {
      gravityAnimTimer -= deltaTime;
      if (gravityAnimTimer <= 0) {
        gravityAnimTimer = 0;
        poppingPuyos = [];
        processChains();
      }
    }
  }
}

// ============================================================
//  DRAWING
// ============================================================

function drawPuyo(ctx, x, y, color, scale = 1, popAlpha = 1) {
  const c = COLOR_MAP[color];
  if (!c) return;

  const size = CELL * scale;
  const offset = (CELL - size) / 2;
  const cx = x + offset;
  const cy = y + offset;
  const radius = size / 2 - 2;

  ctx.globalAlpha = popAlpha;

  // Shadow
  ctx.beginPath();
  ctx.arc(cx + radius, cy + radius + 2, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();

  // Body gradient
  const grad = ctx.createRadialGradient(
    cx + radius * 0.6, cy + radius * 0.5, radius * 0.1,
    cx + radius, cy + radius, radius
  );
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.6, c.fill);
  grad.addColorStop(1, c.dark);

  ctx.beginPath();
  ctx.arc(cx + radius, cy + radius, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Highlight
  ctx.beginPath();
  ctx.arc(cx + radius * 0.55, cy + radius * 0.4, radius * 0.25, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();

  // Eyes
  const eyeR = radius * 0.18;
  const eyeY = cy + radius * 0.55;
  const eyeXL = cx + radius * 0.62;
  const eyeXR = cx + radius * 1.38;

  ctx.fillStyle = c.eye;
  ctx.beginPath();
  ctx.arc(eyeXL, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeXR, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(eyeXL + 1, eyeY, eyeR * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeXR + 1, eyeY, eyeR * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function draw() {
  // Clear
  ctx.fillStyle = '#0a0a1f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL);
    ctx.lineTo(canvas.width, r * CELL);
    ctx.stroke();
  }
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, canvas.height);
    ctx.stroke();
  }

  // Draw settled puyos (only visible rows)
  for (let r = HIDDEN_ROWS; r < TOTAL_ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] !== null) {
        const y = (r - HIDDEN_ROWS) * CELL;
        const x = c * CELL;
        drawPuyo(ctx, x, y, grid[r][c]);
      }
    }
  }

  // Draw popping puyos (shrinking animation)
  if (poppingPuyos && poppingPuyos.length > 0) {
    const progress = popAnimTimer > 0 ? 1 - (popAnimTimer / ANIM_POP_DELAY) : 1;
    const scale = 1 + progress * 0.4;
    const alpha = 1 - progress;
    for (const puyo of poppingPuyos) {
      if (puyo.r >= HIDDEN_ROWS) {
        const y = (puyo.r - HIDDEN_ROWS) * CELL;
        const x = puyo.c * CELL;
        drawPuyo(ctx, x, y, puyo.color, scale, alpha);
      }
    }
  }

  // Draw current falling pair
  if (currentPair && (gameState === 'playing' || gameState === 'pausing')) {
    for (const puyo of currentPair.puyos) {
      if (puyo.r >= HIDDEN_ROWS - 1) {
        // Only draw if at least partially visible
        const y = (puyo.r - HIDDEN_ROWS) * CELL;
        const x = puyo.c * CELL;
        if (puyo.r >= HIDDEN_ROWS) {
          drawPuyo(ctx, x, y, puyo.color);
        } else if (puyo.r === HIDDEN_ROWS - 1) {
          // Partially visible — clip to grid area
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, canvas.width, canvas.height);
          ctx.clip();
          drawPuyo(ctx, x, y, puyo.color);
          ctx.restore();
        }
      }
    }

    // Draw ghost piece (landing position preview)
    if (gameState === 'playing') {
      drawGhost();
    }
  }
}

function drawGhost() {
  const p = currentPair;
  // Find lowest position
  let testPair = {
    puyos: [
      { r: p.puyos[0].r, c: p.puyos[0].c, color: p.puyos[0].color },
      { r: p.puyos[1].r, c: p.puyos[1].c, color: p.puyos[1].color },
    ],
    rotation: p.rotation,
  };

  // Drop as far as possible
  while (true) {
    const nr0 = testPair.puyos[0].r + 1;
    const nc0 = testPair.puyos[0].c;
    const nr1 = testPair.puyos[1].r + 1;
    const nc1 = testPair.puyos[1].c;
    if (canPlace(nr0, nc0) && canPlace(nr1, nc1)) {
      testPair.puyos[0].r = nr0;
      testPair.puyos[1].r = nr1;
    } else {
      break;
    }
  }

  for (const puyo of testPair.puyos) {
    if (puyo.r >= HIDDEN_ROWS) {
      const x = puyo.c * CELL;
      const y = (puyo.r - HIDDEN_ROWS) * CELL;
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawNext() {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!nextPair) return;

  const miniCell = 28;
  const cx = nextCanvas.width / 2;

  // Draw pivot (bottom)
  drawMiniPuyo(nextCtx, cx - miniCell / 2, nextCanvas.height / 2, nextPair.puyos[0].color, miniCell);
  // Draw partner (top)
  drawMiniPuyo(nextCtx, cx - miniCell / 2, nextCanvas.height / 2 - miniCell, nextPair.puyos[1].color, miniCell);
}

function drawMiniPuyo(ctx, x, y, color, size) {
  const c = COLOR_MAP[color];
  if (!c) return;
  const radius = size / 2 - 2;
  const cx = x + size / 2;
  const cy = y + size / 2;

  const grad = ctx.createRadialGradient(cx - 3, cy - 3, 2, cx, cy, radius);
  grad.addColorStop(0, c.light);
  grad.addColorStop(0.7, c.fill);
  grad.addColorStop(1, c.dark);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Tiny eyes
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cx - 3, cy + 1, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 3, cy + 1, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ============================================================
//  UI
// ============================================================

function updateUI() {
  document.getElementById('score-display').textContent = score.toLocaleString();
  document.getElementById('chain-display').textContent = chainCount;
}

function showOverlay(title, subtitle, buttonText) {
  document.getElementById('overlay-title').textContent = title;
  document.getElementById('overlay-subtitle').textContent = subtitle;
  document.getElementById('overlay-button').textContent = buttonText;
  document.getElementById('overlay').classList.remove('hidden');
}

function hideOverlay() {
  document.getElementById('overlay').classList.add('hidden');
}

// ============================================================
//  INPUT
// ============================================================

const keys = { left: false, right: false, down: false };
let dasTimer = 0;
const DAS_DELAY = 150;     // ms before auto-repeat
const DAS_INTERVAL = 40;    // ms between repeats

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (gameState === 'menu' || gameState === 'gameover')) {
    startGame();
    return;
  }

  if (gameState !== 'playing') return;

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      if (!keys.left) {
        movePair(0, -1);
        keys.left = true;
        dasTimer = 0;
      }
      break;
    case 'ArrowRight':
      e.preventDefault();
      if (!keys.right) {
        movePair(0, 1);
        keys.right = true;
        dasTimer = 0;
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      keys.down = true;
      break;
    case 'ArrowUp':
    case 'x':
    case 'X':
      e.preventDefault();
      rotatePair(1);
      break;
    case 'z':
    case 'Z':
      e.preventDefault();
      rotatePair(-1);
      break;
    case ' ':
      e.preventDefault();
      hardDrop();
      break;
    case 'p':
    case 'P':
      e.preventDefault();
      togglePause();
      break;
  }
});

document.addEventListener('keyup', (e) => {
  switch (e.key) {
    case 'ArrowLeft': keys.left = false; break;
    case 'ArrowRight': keys.right = false; break;
    case 'ArrowDown': keys.down = false; break;
  }
});

function hardDrop() {
  // Drop the pair as far as it goes instantly
  while (movePair(1, 0)) {}
  lockPair();
}

function togglePause() {
  if (gameState === 'playing') {
    gameState = 'pausing';
    showOverlay('PAUSED', 'Press P to resume', 'RESUME');
  } else if (gameState === 'pausing') {
    hideOverlay();
    gameState = 'playing';
  }
}

// ============================================================
//  GAME LIFECYCLE
// ============================================================

function startGame() {
  hideOverlay();
  initGrid();
  score = 0;
  chainCount = 0;
  poppingPuyos = [];
  popAnimTimer = 0;
  gravityAnimTimer = 0;
  nextPair = makePair();
  spawnNextPair();
  updateUI();
  gameState = 'playing';
}

// ============================================================
//  MAIN LOOP
// ============================================================

function gameLoop(time) {
  if (!lastTime) lastTime = time;
  const deltaTime = time - lastTime;
  lastTime = time;

  if (gameState === 'playing') {
    // Handle DAS (Delayed Auto Shift) for left/right
    if (keys.left || keys.right) {
      dasTimer += deltaTime;
      if (dasTimer >= DAS_DELAY) {
        const dir = keys.left ? -1 : 1;
        // Repeat at interval
        while (dasTimer >= DAS_DELAY + DAS_INTERVAL) {
          movePair(0, dir);
          dasTimer -= DAS_INTERVAL;
        }
      }
    }
  }

  if (gameState !== 'menu') {
    update(deltaTime);
    draw();
  }

  requestAnimationFrame(gameLoop);
}

// ---- Boot ----
gameState = 'menu';
initGrid();
draw();
showOverlay('PUYO PUYO', 'Press Enter to start', 'START');
requestAnimationFrame(gameLoop);
