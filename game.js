const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const ui = {
  score: document.getElementById("score"),
  time: document.getElementById("time"),
  lives: document.getElementById("lives"),
  level: document.getElementById("level"),
  message: document.getElementById("message")
};

const WORLD = {
  width: canvas.width,
  height: canvas.height,
  tile: 16,
  hideout: { x: 14, y: 14, w: 92, h: 66 }
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
  return {
    ...pos,
    type: "fuggler",
    pulse: rand(0, Math.PI * 2)
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

    if (state.walls.some((wall) => aabb(candidateX, wall))) {
      guard.vx *= -1;
    } else {
      guard.x = nextX;
    }

    if (state.walls.some((wall) => aabb(candidateY, wall))) {
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
  ctx.fillStyle = "#0c1528";
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);

  for (let y = 0; y < WORLD.height; y += WORLD.tile) {
    for (let x = 0; x < WORLD.width; x += WORLD.tile) {
      const even = ((x + y) / WORLD.tile) % 2 === 0;
      ctx.fillStyle = even ? "#111d36" : "#0f1930";
      ctx.fillRect(x, y, WORLD.tile, WORLD.tile);
    }
  }

  ctx.fillStyle = "#2a5f3b";
  ctx.fillRect(WORLD.hideout.x, WORLD.hideout.y, WORLD.hideout.w, WORLD.hideout.h);
  ctx.strokeStyle = "#8cf0a8";
  ctx.lineWidth = 2;
  ctx.strokeRect(WORLD.hideout.x, WORLD.hideout.y, WORLD.hideout.w, WORLD.hideout.h);

  ctx.fillStyle = "#d7ffd1";
  ctx.font = "8px 'Press Start 2P'";
  ctx.fillText("HIDEOUT", WORLD.hideout.x + 10, WORLD.hideout.y + 18);
}

function drawWalls() {
  for (const wall of state.walls) {
    ctx.fillStyle = "#3b4d72";
    ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
    ctx.strokeStyle = "#9bb4e2";
    ctx.lineWidth = 2;
    ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
  }
}

function drawFuggler(f) {
  const blink = Math.sin(performance.now() * 0.007 + f.pulse) > 0;

  ctx.fillStyle = "#f4d26c";
  ctx.fillRect(f.x, f.y, f.w, f.h);

  ctx.fillStyle = "#222";
  ctx.fillRect(f.x + 3, f.y + 3, 2, 2);
  ctx.fillRect(f.x + 9, f.y + 3, 2, 2);

  ctx.fillStyle = blink ? "#ff6b6b" : "#c94848";
  ctx.fillRect(f.x + 5, f.y + 8, 4, 2);
}

function drawGuard(g) {
  ctx.fillStyle = "#ff6363";
  ctx.fillRect(g.x, g.y, g.w, g.h);

  ctx.fillStyle = "#2a0000";
  ctx.fillRect(g.x + 3, g.y + 3, 2, 2);
  ctx.fillRect(g.x + 9, g.y + 3, 2, 2);
  ctx.fillRect(g.x + 5, g.y + 9, 4, 2);
}

function drawPlayer() {
  const p = state.player;
  const flash = p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0;

  if (flash) {
    return;
  }

  ctx.fillStyle = state.carrying ? "#ffe071" : "#6ce3ff";
  ctx.fillRect(p.x, p.y, p.w, p.h);

  ctx.fillStyle = "#003844";
  ctx.fillRect(p.x + 3, p.y + 3, 2, 2);
  ctx.fillRect(p.x + 9, p.y + 3, 2, 2);
  ctx.fillRect(p.x + 5, p.y + 9, 4, 2);

  if (state.carrying) {
    ctx.fillStyle = "#f4d26c";
    ctx.fillRect(p.x + p.w - 3, p.y - 3, 6, 6);
  }
}

function drawOverlay() {
  if (!state.running) {
    ctx.fillStyle = "rgba(4, 8, 16, 0.75)";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.fillStyle = "#ffef99";
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

state.player = createPlayer();
render();
requestAnimationFrame(loop);
