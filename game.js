'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#f06292', // J - fuchsia
  '#ffb74d', // L - orange
  '#8d5a3b', // bomb - brown
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8],[8,8]],                               // bomb (power-up, never from randomPiece)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// Bomb power-up
const BOMB = 8;
const BOMB_EVERY_LINES = 5;     // roll for a bomb every N cleared lines
const BOMB_CHANCE = 0.3;        // chance of that roll
const BOMB_DANGER_CHANCE = 0.7; // chance of the once-per-level roll when in danger
const DANGER_ROWS = 6;          // any locked block in the top N rows = danger
const BOMB_CELL_SCORE = 10;     // points per destroyed block (× level)
const BLINK_MS = 250;           // bomb blink half-period
const EXPLOSION_MS = 300;       // explosion flash duration

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const gameTitle = document.getElementById('game-title');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

// Canvas colors come from CSS variables; cached on theme change
let gridColor, highlightColor;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function refreshThemeColors() {
  gridColor = cssVar('--grid');
  highlightColor = cssVar('--highlight');
}

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let bombQueued, dangerRollUsed, explosion;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function bombPiece() {
  const shape = PIECES[BOMB].map(row => [...row]);
  return { type: BOMB, shape, x: Math.floor(COLS / 2) - 1, y: 0 };
}

function inDanger() {
  return board.slice(0, DANGER_ROWS).some(row => row.some(Boolean));
}

// Decides the upcoming piece; never two bombs in a row
function nextPiece() {
  if (current && current.type === BOMB) return randomPiece();
  if (bombQueued) {
    bombQueued = false;
    return bombPiece();
  }
  if (!dangerRollUsed && inDanger()) {
    dangerRollUsed = true; // one boosted roll per level, hit or miss
    if (Math.random() < BOMB_DANGER_CHANCE) return bombPiece();
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    const prevLines = lines, prevLevel = level;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (level > prevLevel) dangerRollUsed = false;
    if (Math.floor(lines / BOMB_EVERY_LINES) > Math.floor(prevLines / BOMB_EVERY_LINES)
        && Math.random() < BOMB_CHANCE) {
      bombQueued = true;
    }
    updateHUD();
  }
}

// Destroys the 3x3 area right below the bomb: its 2 columns plus the
// neighbouring column (left or right) that holds more blocks
function explode() {
  const { x, y } = current;
  const rows = [];
  for (let r = y + 2; r <= y + 4 && r < ROWS; r++) rows.push(r);
  const left = x - 1, right = x + 2; // at most one of them is off-board
  const countCol = c => rows.filter(r => board[r][c]).length;
  let extra;
  if (left < 0) extra = right;
  else if (right >= COLS) extra = left;
  else extra = countCol(left) > countCol(right) ? left : right;
  const cols = [x, x + 1, extra];
  const cells = [];
  let destroyed = 0;
  for (const r of rows)
    for (const c of cols) {
      if (board[r][c]) destroyed++;
      board[r][c] = 0;
      cells.push([c, r]);
    }
  score += destroyed * BOMB_CELL_SCORE * level;
  explosion = { cells, t: performance.now() };
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.type === BOMB) explode();
  else merge();
  clearLines();
  spawn();
}

function spawn() {
  // Check before promoting `next`, so a piece that doesn't fit is never drawn
  if (collide(next.shape, next.x, next.y)) {
    current = null; // no active piece on game over
    endGame();
    return;
  }
  current = next;
  next = nextPiece();
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = highlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

// 2x2 brown bomb with a lit fuse; (x, y) is its top-left cell. Blinks.
function drawBomb(context, x, y, size, alpha) {
  const on = Math.floor(performance.now() / BLINK_MS) % 2 === 0;
  const a = (alpha ?? 1) * (on ? 1 : 0.45);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      drawBlock(context, x + c, y + r, BOMB, size, a);

  // fuse curling up to the top-right corner, with a spark at its tip
  const cx = (x + 1) * size, cy = y * size;
  context.globalAlpha = a;
  context.strokeStyle = '#2b1a10';
  context.lineWidth = Math.max(2, size / 10);
  context.beginPath();
  context.moveTo(cx + size * 0.3, cy + size * 0.6);
  context.quadraticCurveTo(cx + size * 0.45, cy + size * 0.25, cx + size * 0.75, cy + size * 0.3);
  context.stroke();
  context.fillStyle = on ? '#ffeb3b' : '#ff7043';
  context.beginPath();
  context.arc(cx + size * 0.75, cy + size * 0.3, size * (on ? 0.16 : 0.11), 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // explosion flash, fading out
  if (explosion) {
    const k = 1 - (performance.now() - explosion.t) / EXPLOSION_MS;
    if (k <= 0) {
      explosion = null;
    } else {
      ctx.globalAlpha = 0.8 * k;
      ctx.fillStyle = '#ff9800';
      for (const [c, r] of explosion.cells)
        ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
      ctx.globalAlpha = 1;
    }
  }

  if (!current) return; // game over: board only

  const gy = ghostY();
  if (current.type === BOMB) {
    drawBomb(ctx, current.x, gy, BLOCK, 0.2);
    drawBomb(ctx, current.x, current.y, BLOCK);
    return;
  }

  // ghost
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  if (next.type === BOMB) {
    drawBomb(nextCtx, offX, offY, NB);
    return;
  }
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  draw(); // show the last locked piece even when the game ends from a key press
  gameTitle.classList.add('hidden');
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (next.type === BOMB) drawNext(); // keep the preview blinking
  // endGame() may have run inside lockPiece() during this frame; its
  // cancelAnimationFrame() targets the frame already executing, so stop here.
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  bombQueued = false;
  dangerRollUsed = false;
  explosion = null;
  current = null;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  gameTitle.classList.remove('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function applyTheme(light) {
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeToggle.setAttribute('aria-checked', String(light));
  themeToggle.textContent = light ? '☾ Oscuro' : '☀ Claro';
  themeToggle.setAttribute('aria-label', light ? 'Modo oscuro' : 'Modo claro');
  refreshThemeColors();
  // Repaint immediately (needed when paused or on game over)
  if (board) draw();
  if (next) drawNext();
}

themeToggle.addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
  applyTheme(light);
  themeToggle.blur(); // keep Space (hard drop) from re-triggering the button
});

applyTheme(document.documentElement.dataset.theme === 'light');

init();
