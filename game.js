const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 600;

const ui = {
  score: document.getElementById("score"),
  time: document.getElementById("time"),
  lives: document.getElementById("lives"),
  level: document.getElementById("level"),
  message: document.getElementById("message"),
  touchButtons: Array.from(document.querySelectorAll(".touch-btn"))
};

const WORLD = {
  width: LOGICAL_WIDTH,
  height: LOGICAL_HEIGHT,
  tile: 16,
  hideout: { x: 14, y: 14, w: 92, h: 66 }
};

const THEME = {
  arenaBase: "#1a070b",
  arenaTileA: "#2a0d13",
  arenaTileB: "#230a10",
  hideoutFill: "#214b43",
  hideoutStroke: "#8af2c1",
  hideoutText: "#e9ffee",
  wallFill: "#6b252d",
  wallStroke: "#f2a1a1",
  overlay: "rgba(18, 4, 7, 0.78)",
  overlayText: "#ffd36b"
};

const state = {
  running: false,
  gameOver: false,
  level: 1,
  score: 0,
  lives: 3,
  timeLeft: 60,
  player: null,
  fugglers: [],
  guards: [],
  walls: [],
  keys: new Set(),
  moveTarget: null,
  carrying: false,
  spawnCooldown: 0,
  timerAccumulator: 0,
  lastTs: 0
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function configureCanvasResolution() {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  canvas.width = Math.floor(WORLD.width * dpr);
  canvas.height = Math.floor(WORLD.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

function createPlayer() {
  return {
    x: 34,
    y: 34,
    w: 14,
    h: 14,
    speed: 112,
    sprint: 1.45,
    invuln: 0
  };
}

function randomOpenSpot(size = 14) {
  for (let i = 0; i < 400; i += 1) {
    const pad = WORLD.tile * 2;
    const candidate = {
      x: rand(pad, WORLD.width - pad - size),
      y: rand(pad, WORLD.height - pad - size),
      w: size,
      h: size
    };

    const inHideout = aabb(candidate, WORLD.hideout);
    const hitWall = state.walls.some((wall) => aabb(candidate, wall));
    if (!inHideout && !hitWall) {
      return candidate;
    }
  }

  return { x: WORLD.width - 60, y: WORLD.height - 60, w: size, h: size };
}

function createFuggler() {
  const pos = randomOpenSpot(14);
  const palettes = [
    { base: "#f6d679", patch: "#f2b95d", eye: "#2b1a05", mouth: "#8d2323" },
    { base: "#f7c8c8", patch: "#e8a4be", eye: "#2c1b27", mouth: "#7d1f4f" },
    { base: "#c7ef9e", patch: "#8fd178", eye: "#193017", mouth: "#315f2a" }
  ];
  const palette = palettes[Math.floor(rand(0, palettes.length))];
  return {
    ...pos,
    type: "fuggler",
    pulse: rand(0, Math.PI * 2),
    palette
  };
}

function createGuard() {
  const pos = randomOpenSpot(14);
  const speedBase = 54 + state.level * 8;
  const angle = rand(0, Math.PI * 2);

  return {
    ...pos,
    speed: speedBase,
    vx: Math.cos(angle) * speedBase,
    vy: Math.sin(angle) * speedBase,
    retarget: rand(0.8, 1.8)
  };
}

function buildWalls() {
  const t = WORLD.tile;
  return [
    { x: 0, y: 0, w: WORLD.width, h: t },
    { x: 0, y: WORLD.height - t, w: WORLD.width, h: t },
    { x: 0, y: 0, w: t, h: WORLD.height },
    { x: WORLD.width - t, y: 0, w: t, h: WORLD.height },
    { x: t * 8, y: t * 8, w: t * 7, h: t },
    { x: t * 23, y: t * 5, w: t * 8, h: t },
    { x: t * 16, y: t * 12, w: t * 8, h: t },
    { x: t * 11, y: t * 18, w: t * 10, h: t },
    { x: t * 27, y: t * 16, w: t, h: t * 6 },
    { x: t * 6, y: t * 13, w: t, h: t * 7 }
  ];
}

function startGame() {
  state.running = true;
  state.gameOver = false;
  state.level = 1;
  state.score = 0;
  state.lives = 3;
  state.timeLeft = 60;
  state.player = createPlayer();
  state.walls = buildWalls();
  state.fugglers = [];
  state.guards = [];
  state.moveTarget = null;
  state.carrying = false;
  state.spawnCooldown = 0;
  state.timerAccumulator = 0;
  state.lastTs = performance.now();
  populateLevel();
  setMessage("Steal a Fuggler, then return to hideout.");
  syncUI();
}

function populateLevel() {
  const fugglerCount = clamp(4 + state.level, 4, 10);
  const guardCount = clamp(2 + Math.floor(state.level / 2), 2, 8);
  state.fugglers = Array.from({ length: fugglerCount }, () => createFuggler());
  state.guards = Array.from({ length: guardCount }, () => createGuard());
}

function nextLevel() {
  state.level += 1;
  state.timeLeft = clamp(state.timeLeft + 12, 20, 90);
  state.carrying = false;
  state.player.x = 34;
  state.player.y = 34;
  populateLevel();
  setMessage(`Level ${state.level}: More guards are hunting your Fugglers.`);
  syncUI();
}

function gameOver(reason) {
  state.running = false;
  state.gameOver = true;
  setMessage(`${reason} Final score: ${state.score}. Press SPACE to restart.`);
}

function setMessage(msg) {
  ui.message.textContent = msg;
}

function syncUI() {
  ui.score.textContent = String(state.score);
  ui.time.textContent = String(Math.max(0, Math.ceil(state.timeLeft)));
  ui.lives.textContent = String(state.lives);
  ui.level.textContent = String(state.level);
}

function movePlayer(dt) {
  const p = state.player;
  let dx = 0;
  let dy = 0;

  if (state.keys.has("arrowleft") || state.keys.has("a")) dx -= 1;
  if (state.keys.has("arrowright") || state.keys.has("d")) dx += 1;
  if (state.keys.has("arrowup") || state.keys.has("w")) dy -= 1;
  if (state.keys.has("arrowdown") || state.keys.has("s")) dy += 1;

  if (state.moveTarget) {
    const centerX = p.x + p.w / 2;
    const centerY = p.y + p.h / 2;
    const tx = state.moveTarget.x - centerX;
    const ty = state.moveTarget.y - centerY;
    const distance = Math.hypot(tx, ty);

    if (distance > 4) {
      dx += tx / distance;
      dy += ty / distance;
    } else {
      state.moveTarget = null;
    }
  }

  if (dx === 0 && dy === 0) {
    return;
  }

  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;

  const sprinting = state.keys.has("shift");
  const carryPenalty = state.carrying ? 0.72 : 1;
  const speed = p.speed * (sprinting ? p.sprint : 1) * carryPenalty;

  const nextX = p.x + dx * speed * dt;
  const nextY = p.y + dy * speed * dt;

  const candidateX = { x: nextX, y: p.y, w: p.w, h: p.h };
  const candidateY = { x: p.x, y: nextY, w: p.w, h: p.h };

  if (!state.walls.some((wall) => aabb(candidateX, wall))) {
    p.x = nextX;
  }
  if (!state.walls.some((wall) => aabb(candidateY, wall))) {
    p.y = nextY;
  }

  p.x = clamp(p.x, 0, WORLD.width - p.w);
  p.y = clamp(p.y, 0, WORLD.height - p.h);
}

function updateGuards(dt) {
  const p = state.player;

  for (const guard of state.guards) {
    guard.retarget -= dt;
    const distX = p.x - guard.x;
    const distY = p.y - guard.y;
    const dist = Math.hypot(distX, distY);

    if (dist < 140 || guard.retarget <= 0) {
      const nx = distX / (dist || 1);
      const ny = distY / (dist || 1);
      guard.vx = nx * guard.speed;
      guard.vy = ny * guard.speed;
      guard.retarget = rand(0.6, 1.2);
    }

    const nextX = guard.x + guard.vx * dt;
    const nextY = guard.y + guard.vy * dt;

    const candidateX = { x: nextX, y: guard.y, w: guard.w, h: guard.h };
    const candidateY = { x: guard.x, y: nextY, w: guard.w, h: guard.h };
    const blockedX = state.walls.some((wall) => aabb(candidateX, wall)) || aabb(candidateX, WORLD.hideout);
    const blockedY = state.walls.some((wall) => aabb(candidateY, wall)) || aabb(candidateY, WORLD.hideout);

    if (blockedX) {
      guard.vx *= -1;
    } else {
      guard.x = nextX;
    }

    if (blockedY) {
      guard.vy *= -1;
    } else {
      guard.y = nextY;
    }

    if (aabb(guard, p) && p.invuln <= 0) {
      onPlayerCaught();
      break;
    }
  }
}

function onPlayerCaught() {
  state.lives -= 1;
  state.player.invuln = 2;
  state.player.x = 34;
  state.player.y = 34;
  state.carrying = false;
  setMessage("Guard caught you! Fugglers dropped.");

  if (state.lives <= 0) {
    gameOver("No lives left.");
  }

  syncUI();
}

function pickupFuggler() {
  if (state.carrying) {
    return;
  }

  const p = state.player;
  for (let i = state.fugglers.length - 1; i >= 0; i -= 1) {
    const fuggler = state.fugglers[i];
    if (aabb(p, fuggler)) {
      state.fugglers.splice(i, 1);
      state.carrying = true;
      setMessage("Fuggler secured. Get back to hideout!");
      break;
    }
  }
}

function depositAtHideout() {
  if (!state.carrying) {
    return;
  }

  if (aabb(state.player, WORLD.hideout)) {
    const bonus = 100 + state.level * 15;
    state.score += bonus;
    state.carrying = false;
    setMessage(`Delivered a Fuggler (+${bonus}).`);

    if (state.fugglers.length === 0) {
      nextLevel();
    }

    syncUI();
  }
}

function updateTimer(dt) {
  state.timerAccumulator += dt;

  if (state.timerAccumulator >= 1) {
    state.timerAccumulator -= 1;
    state.timeLeft -= 1;
    syncUI();

    if (state.timeLeft <= 0) {
      gameOver("Time up.");
    }
  }
}

function drawBackground() {
  ctx.fillStyle = THEME.arenaBase;
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  for (let y = 0; y < WORLD.height; y += WORLD.tile) {
    for (let x = 0; x < WORLD.width; x += WORLD.tile) {
      const even = ((x + y) / WORLD.tile) % 2 === 0;
      ctx.fillStyle = even ? THEME.arenaTileA : THEME.arenaTileB;
      ctx.fillRect(x, y, WORLD.tile, WORLD.tile);
    }
  }

  ctx.fillStyle = THEME.hideoutFill;
  ctx.fillRect(WORLD.hideout.x, WORLD.hideout.y, WORLD.hideout.w, WORLD.hideout.h);
  ctx.strokeStyle = THEME.hideoutStroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(WORLD.hideout.x, WORLD.hideout.y, WORLD.hideout.w, WORLD.hideout.h);

  ctx.fillStyle = THEME.hideoutText;
  ctx.font = "8px 'Press Start 2P'";
  ctx.fillText("HIDEOUT", WORLD.hideout.x + 10, WORLD.hideout.y + 18);
}

function drawWalls() {
  for (const wall of state.walls) {
    ctx.fillStyle = THEME.wallFill;
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = THEME.wallStroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }
}

function drawFuggler(f) {
  const blink = Math.sin(performance.now() * 0.007 + f.pulse) > 0;
  const { base, patch, eye, mouth } = f.palette;

  ctx.fillStyle = base;
  ctx.fillRect(f.x, f.y, f.w, f.h);

  ctx.fillStyle = patch;
  for (let y = 1; y < f.h - 1; y += 3) {
    for (let x = 1; x < f.w - 1; x += 3) {
      if ((x + y) % 2 === 0) {
        ctx.fillRect(f.x + x, f.y + y, 2, 2);
      }
    }
  }

  ctx.fillStyle = eye;
  ctx.fillRect(f.x + 3, f.y + 3, 2, 2);
  ctx.fillRect(f.x + 9, f.y + 3, 2, 2);

  ctx.fillStyle = blink ? "#fefefe" : "#efefef";
  ctx.fillRect(f.x + 2, f.y + 10, 10, 2);

  ctx.fillStyle = mouth;
  ctx.fillRect(f.x + 5, f.y + 8, 4, 2);

  ctx.fillStyle = "#5e4112";
  ctx.fillRect(f.x + 1, f.y + 1, 1, 4);
  ctx.fillRect(f.x + 12, f.y + 7, 1, 4);
}

function drawGuard(g) {
  const x = Math.round(g.x);
  const y = Math.round(g.y);

  ctx.fillStyle = "#6f7480";
  ctx.fillRect(x + 3, y + 9, 9, 4);
  ctx.fillRect(x + 11, y + 8, 2, 1);
  ctx.fillRect(x + 12, y + 7, 2, 1);

  ctx.fillStyle = "#f44336";
  ctx.fillRect(x + 2, y + 2, 2, 9);
  ctx.fillStyle = "#ff9800";
  ctx.fillRect(x + 4, y + 2, 2, 9);
  ctx.fillStyle = "#ffeb3b";
  ctx.fillRect(x + 6, y + 2, 2, 9);
  ctx.fillStyle = "#4caf50";
  ctx.fillRect(x + 8, y + 2, 2, 9);
  ctx.fillStyle = "#03a9f4";
  ctx.fillRect(x + 10, y + 2, 2, 9);
  ctx.fillStyle = "#9c27b0";
  ctx.fillRect(x + 12, y + 4, 1, 5);

  ctx.fillStyle = "#2e3033";
  ctx.fillRect(x + 3, y + 4, 1, 1);
  ctx.fillRect(x + 5, y + 6, 1, 1);
  ctx.fillRect(x + 7, y + 4, 1, 1);
  ctx.fillRect(x + 9, y + 6, 1, 1);

  ctx.fillStyle = "#2f3138";
  ctx.fillRect(x, y + 9, 3, 2);
  ctx.fillRect(x, y + 10, 1, 2);
  ctx.fillRect(x + 1, y + 8, 1, 1);
  ctx.fillRect(x + 1, y + 12, 1, 1);
  ctx.fillStyle = "#ff2e2e";
  ctx.fillRect(x + 1, y + 9, 1, 1);
  ctx.fillRect(x + 1, y + 11, 1, 1);
}

function drawPlayer() {
  const p = state.player;
  const flash = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;

  if (flash) {
    return;
  }

  const x = Math.round(p.x);
  const y = Math.round(p.y);

  ctx.fillStyle = "#4f3420";
  ctx.fillRect(x + 2, y, 10, 3);

  ctx.fillStyle = "#d6a57e";
  ctx.fillRect(x + 2, y + 3, 10, 4);
  ctx.fillRect(x, y + 7, 2, 4);
  ctx.fillRect(x + 12, y + 7, 2, 4);

  ctx.fillStyle = "#2a1b14";
  ctx.fillRect(x + 4, y + 4, 2, 1);
  ctx.fillRect(x + 8, y + 4, 2, 1);
  ctx.fillRect(x + 6, y + 6, 2, 1);

  ctx.fillStyle = "#4da2d9";
  ctx.fillRect(x + 2, y + 7, 10, 4);

  ctx.fillStyle = "#2f5ca8";
  ctx.fillRect(x + 2, y + 11, 4, 3);
  ctx.fillRect(x + 8, y + 11, 4, 3);

  if (state.carrying) {
    ctx.fillStyle = "#f4d26c";
    ctx.fillRect(x + 10, y - 2, 4, 4);
    ctx.fillStyle = "#6b5020";
    ctx.fillRect(x + 11, y - 1, 2, 2);
  }
}

function drawOverlay() {
  if (!state.running) {
    ctx.fillStyle = THEME.overlay;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = THEME.overlayText;
    ctx.font = "14px 'Press Start 2P'";
    const title = state.gameOver ? "GAME OVER" : "STEAL A FUGGLER";
    ctx.fillText(title, 175, 170);
    ctx.font = "9px 'Press Start 2P'";
    ctx.fillText("Press SPACE to play", 185, 210);
  }
}

function update(dt) {
  if (!state.running) {
    return;
  }

  state.player.invuln = Math.max(0, state.player.invuln - dt);
  movePlayer(dt);
  pickupFuggler();
  depositAtHideout();
  updateGuards(dt);
  updateTimer(dt);
}

function render() {
  drawBackground();
  drawWalls();

  for (const fuggler of state.fugglers) {
    drawFuggler(fuggler);
  }

  for (const guard of state.guards) {
    drawGuard(guard);
  }

  if (state.player) {
    drawPlayer();
  }

  drawOverlay();
}

function loop(ts) {
  if (!state.lastTs) {
    state.lastTs = ts;
  }

  const dt = Math.min(0.033, (ts - state.lastTs) / 1000);
  state.lastTs = ts;

  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (ev) => {
  const key = ev.key.toLowerCase();

  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
    ev.preventDefault();
  }

  if (key === " ") {
    if (!state.running) {
      startGame();
    }
    return;
  }

  state.keys.add(key);
});

window.addEventListener("keyup", (ev) => {
  state.keys.delete(ev.key.toLowerCase());
});

function setMoveTargetFromPointer(ev) {
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * WORLD.width;
  const y = ((ev.clientY - rect.top) / rect.height) * WORLD.height;
  state.moveTarget = {
    x: clamp(x, 0, WORLD.width),
    y: clamp(y, 0, WORLD.height)
  };
}

canvas.addEventListener("pointerdown", (ev) => {
  ev.preventDefault();
  if (!state.running) {
    startGame();
  }
  setMoveTargetFromPointer(ev);
});

canvas.addEventListener("pointermove", (ev) => {
  if (ev.buttons > 0) {
    ev.preventDefault();
    setMoveTargetFromPointer(ev);
  }
});

for (const btn of ui.touchButtons) {
  const key = btn.dataset.key;
  const action = btn.dataset.action;

  btn.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    btn.classList.add("active");

    if (action === "start") {
      if (!state.running) {
        startGame();
      }
      return;
    }

    if (key) {
      state.keys.add(key);
    }
  });

  const release = () => {
    btn.classList.remove("active");
    if (key) {
      state.keys.delete(key);
    }
  };

  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("pointerleave", release);
}

state.player = createPlayer();
configureCanvasResolution();
window.addEventListener("resize", configureCanvasResolution);
render();
requestAnimationFrame(loop);
