(() => {
  'use strict';

  const W = 420;
  const H = 600;
  const PLAYER_Y = 519;
  const SPEED = 215;
  const CLOAK_TIME = 0.65;
  const CLOAK_COOLDOWN = 3;
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    'arena', 'overlay', 'welcomePanel', 'pausedPanel', 'overPanel', 'startBtn',
    'retryBtn', 'resumeBtn', 'pauseBtn', 'soundBtn', 'helpBtn', 'closeHelpBtn',
    'helpPanel', 'scoreValue', 'bestValue', 'finalScore', 'finalBest',
    'finalDodges', 'finalTime', 'cloakFill', 'cloakLabel', 'statusDot',
    'statusText', 'touchPad', 'controlLabel',
  ].map((id) => [id, $(id)]));

  let state = 'ready';
  let score = 0;
  let best = 0;
  let elapsed = 0;
  let dodges = 0;
  let spawnTimer = 0.85;
  let ambientTime = 0;
  let lastFrame = 0;
  let cloak = 0;
  let cooldown = 0;
  let lastMoving = false;
  let activePointer = null;
  let pointerDirection = 0;
  let pointerSurface = null;
  let spaceHeld = false;
  let soundEnabled = false;
  let audio = null;
  let shake = 0;
  let obstacleId = 0;
  let fps = 60;
  const keys = new Set();
  const obstacles = [];
  const particles = [];
  const popups = [];
  const runtimeErrors = [];
  const player = { x: W / 2, facing: 1, step: 0 };
  const colors = ['#F7B5A1', '#D77E68', '#B7BF8C', '#EADBC3'];

  try {
    const saved = Number(localStorage.getItem('sneakfall.best'));
    if (Number.isFinite(saved) && saved > 0) best = Math.floor(saved);
  } catch (_) { /* The game also works without browser storage. */ }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);
  const formatScore = (value) => Math.floor(value).toString().padStart(4, '0');
  const setText = (element, value) => {
    if (element && element.textContent !== value) element.textContent = value;
  };

  function direction() {
    if (state !== 'playing' || spaceHeld) return 0;
    if (activePointer !== null) return pointerDirection;
    const left = keys.has('ArrowLeft') || keys.has('a');
    const right = keys.has('ArrowRight') || keys.has('d');
    return left === right ? 0 : left ? -1 : 1;
  }

  function tone(frequency, length = 0.07, type = 'sine', volume = 0.035) {
    if (!soundEnabled) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.65, start + length);
      gain.gain.setValueAtTime(volume, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + length);
    } catch (_) { /* Sound is optional on all devices. */ }
  }

  function burst(x, y, color, count = 12) {
    for (let i = 0; i < count; i += 1) {
      const angle = random(0, Math.PI * 2);
      const speed = random(25, 130);
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: random(0.3, 0.65), maxLife: 0.65, size: random(1.5, 3.5), color });
    }
  }

  function activateCloak() {
    if (state !== 'playing' || cooldown > 0 || cloak > 0 || !lastMoving) return;
    cloak = CLOAK_TIME;
    cooldown = CLOAK_COOLDOWN;
    burst(player.x, PLAYER_Y - 10, '#D8EF9A', 14);
    tone(480, 0.14, 'sine', 0.025);
  }

  function clearInput(allowCloak = false) {
    if (allowCloak && lastMoving) activateCloak();
    const oldSurface = pointerSurface;
    const oldPointer = activePointer;
    activePointer = null;
    pointerDirection = 0;
    pointerSurface = null;
    keys.clear();
    spaceHeld = false;
    lastMoving = false;
    if (oldSurface && oldPointer !== null) {
      try {
        if (oldSurface.hasPointerCapture(oldPointer)) oldSurface.releasePointerCapture(oldPointer);
      } catch (_) {}
    }
    updateHUD();
  }

  function setPanels(next) {
    ui.overlay.hidden = next === 'playing';
    ui.welcomePanel.hidden = next !== 'ready';
    ui.pausedPanel.hidden = next !== 'paused';
    ui.overPanel.hidden = next !== 'over';
    if (ui.pauseBtn) {
      ui.pauseBtn.disabled = next === 'ready' || next === 'over';
      ui.pauseBtn.dataset.paused = String(next === 'paused');
      ui.pauseBtn.setAttribute('aria-label', next === 'paused' ? 'Resume game' : 'Pause game');
    }
    if (ui.arena) ui.arena.dataset.state = next;
  }

  function start() {
    clearInput();
    score = 0;
    elapsed = 0;
    dodges = 0;
    cloak = 0;
    cooldown = 0;
    spawnTimer = 0.85;
    shake = 0;
    obstacles.length = 0;
    particles.length = 0;
    popups.length = 0;
    player.x = W / 2;
    player.facing = 1;
    player.step = 0;
    state = 'playing';
    ui.helpPanel.hidden = true;
    lastFrame = performance.now();
    setPanels(state);
    updateHUD();
    tone(660, 0.08);
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    clearInput();
    setPanels(state);
    updateHUD();
  }

  function resume() {
    if (state !== 'paused' || !ui.helpPanel.hidden) return;
    clearInput();
    state = 'playing';
    lastFrame = performance.now();
    setPanels(state);
    updateHUD();
  }

  function endRun() {
    if (state !== 'playing') return;
    state = 'over';
    clearInput();
    shake = 0.35;
    burst(player.x, PLAYER_Y - 10, '#EAA18C', 25);
    tone(130, 0.25, 'triangle', 0.06);
    const final = Math.floor(score);
    if (final > best) {
      best = final;
      try { localStorage.setItem('sneakfall.best', String(best)); } catch (_) {}
    }
    setText(ui.finalScore, formatScore(final));
    setText(ui.finalBest, formatScore(best));
    setText(ui.finalDodges, String(dodges));
    setText(ui.finalTime, `${elapsed.toFixed(1)}s`);
    setPanels(state);
    updateHUD();
  }

  function spawn() {
    const difficulty = Math.min(elapsed / 70, 1);
    const width = random(27, 54);
    const height = random(27, 53);
    let x = random(width / 2 + 22, W - width / 2 - 22);
    // Separate consecutive drops so their warning silhouettes stay legible.
    const last = obstacles[obstacles.length - 1];
    if (last && last.y < 85 && Math.abs(last.x - x) < 58) {
      x = clamp(last.x + (last.x < W / 2 ? 95 : -95), width / 2 + 22, W - width / 2 - 22);
    }
    obstacles.push({ id: ++obstacleId, x, y: -height, width, height,
      speed: random(146, 175) + difficulty * 87, warning: 0.4,
      rotation: random(-0.32, 0.32), spin: random(-0.55, 0.55),
      color: colors[Math.floor(random(0, colors.length))], passed: false,
      ghosted: false, stripe: Math.random() > 0.52 });
  }

  function updateEffects(dt) {
    shake = Math.max(0, shake - dt);
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 90 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i -= 1) {
      popups[i].life -= dt;
      popups[i].y -= 27 * dt;
      if (popups[i].life <= 0) popups.splice(i, 1);
    }
  }

  function update(dt) {
    elapsed += dt;
    score += dt * 10;
    cloak = Math.max(0, cloak - dt);
    cooldown = Math.max(0, cooldown - dt);
    const move = direction();
    if (move) {
      player.x = clamp(player.x + move * SPEED * dt, 24, W - 24);
      player.facing = move;
      player.step += dt * 15;
      if (Math.random() < dt * 9) {
        particles.push({ x: player.x - move * 10, y: 542, vx: -move * random(12, 36),
          vy: -random(8, 20), life: 0.3, maxLife: 0.3, size: 1.8, color: '#84936F' });
      }
    }
    lastMoving = !!move;
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = Math.max(0.42, 0.9 - elapsed * 0.0068) + random(0, 0.12);
    }
    for (let i = obstacles.length - 1; i >= 0; i -= 1) {
      const object = obstacles[i];
      if (object.warning > 0) {
        object.warning -= dt;
        continue;
      }
      object.y += object.speed * dt;
      object.rotation += object.spin * dt;
      const overlapX = Math.abs(object.x - player.x) < object.width * 0.38 + 9;
      const overlapY = object.y + object.height * 0.38 > PLAYER_Y - 15
        && object.y - object.height * 0.38 < PLAYER_Y + 16;
      if (overlapX && overlapY) {
        if (cloak > 0) object.ghosted = true;
        else { endRun(); break; }
      }
      if (!object.passed && object.y - object.height * 0.5 > PLAYER_Y + 18) {
        object.passed = true;
        const gap = Math.abs(object.x - player.x) - object.width * 0.38 - 9;
        if (object.ghosted || (gap >= 0 && gap < 25)) {
          dodges += 1;
          score += 25;
          popups.push({ x: clamp(player.x, 83, W - 83), y: PLAYER_Y - 54,
            text: object.ghosted ? 'SNEAKY! +25' : 'CLOSE CALL +25', life: 0.95 });
          burst(player.x, PLAYER_Y - 27, '#D8EF9A', 6);
          tone(840, 0.07, 'sine', 0.028);
        }
      }
      if (object.y > H + 65) obstacles.splice(i, 1);
    }
    updateEffects(dt);
    updateHUD();
  }

  function updateHUD() {
    setText(ui.scoreValue, formatScore(score));
    setText(ui.bestValue, formatScore(best));
    if (ui.cloakFill) ui.cloakFill.style.width = `${(1 - cooldown / CLOAK_COOLDOWN) * 100}%`;
    setText(ui.cloakLabel, cloak > 0 ? 'CLOAK ACTIVE' : cooldown > 0 ? `READY IN ${cooldown.toFixed(1)}s` : 'CLOAK READY');
    const move = direction();
    const status = state === 'paused' ? 'PAUSED' : state === 'over' ? 'CAUGHT'
      : cloak > 0 ? 'CLOAKED' : move ? 'SNEAKING' : 'READY';
    setText(ui.statusText, status);
    if (ui.statusDot) ui.statusDot.dataset.status = status.toLowerCase();
    if (ui.touchPad) {
      ui.touchPad.classList.toggle('is-held', !!move);
      ui.touchPad.dataset.direction = move < 0 ? 'left' : move > 0 ? 'right' : 'none';
    }
    const control = state === 'paused' ? 'TAKE A BREATHER' : state === 'over' ? 'ANOTHER TRY?'
      : cloak > 0 ? 'YOU’RE CLOAKED' : move && cooldown <= 0 ? 'RELEASE TO CLOAK'
        : move ? 'KEEP IT SNEAKY' : 'HOLD LEFT OR RIGHT';
    setText(ui.controlLabel, control);
  }

  // A repeatable city silhouette keeps the canvas crisp without external assets.
  let seed = 18;
  function seeded() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  const farBuildings = [];
  for (let x = -12; x < W + 20;) {
    const width = 22 + seeded() * 35;
    const height = 35 + seeded() * 120;
    farBuildings.push({ x, width, height, windows: seeded() > 0.27 });
    x += width + 7;
  }
  const motes = Array.from({ length: 24 }, () => ({
    x: seeded() * W, y: seeded() * H, speed: 5 + seeded() * 9, size: seeded() * 1.2 + 0.3,
  }));

  function roundRect(x, y, width, height, radius = 5) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
  }

  function drawCity() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#192A28');
    sky.addColorStop(0.58, '#293A31');
    sky.addColorStop(1, '#192922');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    const halo = ctx.createRadialGradient(224, 150, 0, 224, 150, 214);
    halo.addColorStop(0, 'rgba(196,209,145,.11)');
    halo.addColorStop(1, 'rgba(196,209,145,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, 410);
    ctx.fillStyle = '#C6D5AD';
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.arc(332, 90, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(184,204,166,.045)';
    ctx.lineWidth = 1;
    for (let y = 70; y < 500; y += 76) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    farBuildings.forEach((building) => {
      const y = 469 - building.height;
      ctx.fillStyle = '#23332D';
      ctx.fillRect(building.x, y, building.width, building.height);
      ctx.fillStyle = 'rgba(192,201,144,.15)';
      if (building.windows) {
        for (let wy = y + 11; wy < 457; wy += 20) {
          for (let wx = building.x + 7; wx < building.x + building.width - 4; wx += 13) {
            if ((Math.floor(wx + wy) % 5) !== 0) ctx.fillRect(wx, wy, 3, 5);
          }
        }
      }
    });
    // Foreground rooflines frame the playable alley.
    ctx.fillStyle = '#172721';
    ctx.beginPath();
    ctx.moveTo(0, 233); ctx.lineTo(29, 233); ctx.lineTo(29, 272);
    ctx.lineTo(48, 272); ctx.lineTo(48, 551); ctx.lineTo(0, 551); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, 292); ctx.lineTo(393, 292); ctx.lineTo(393, 322);
    ctx.lineTo(376, 322); ctx.lineTo(376, 551); ctx.lineTo(W, 551); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8A9661';
    ctx.globalAlpha = 0.35;
    ctx.fillRect(10, 292, 5, 11); ctx.fillRect(26, 350, 5, 11);
    ctx.fillRect(397, 355, 5, 11); ctx.fillRect(387, 420, 5, 11);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(183,201,157,.09)';
    ctx.beginPath(); ctx.moveTo(0, 245); ctx.bezierCurveTo(92, 283, 264, 291, W, 250); ctx.stroke();
    const fog = ctx.createLinearGradient(0, 375, 0, 548);
    fog.addColorStop(0, 'rgba(56,78,56,0)');
    fog.addColorStop(1, 'rgba(56,78,56,.25)');
    ctx.fillStyle = fog; ctx.fillRect(0, 375, W, 173);
    ctx.fillStyle = '#17251F'; ctx.fillRect(0, 550, W, 50);
    ctx.strokeStyle = '#516144'; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(0, 550.5); ctx.lineTo(W, 550.5); ctx.stroke();
    ctx.strokeStyle = '#344630'; ctx.globalAlpha = 0.38;
    for (let x = -85; x < W + 100; x += 87) {
      ctx.beginPath(); ctx.moveTo(W / 2 + (x - W / 2) * 0.73, 551); ctx.lineTo(x, 600); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, 575); ctx.lineTo(W, 575); ctx.stroke();
    ctx.globalAlpha = 1;
    motes.forEach((mote, i) => {
      ctx.fillStyle = `rgba(190,208,152,${0.08 + Math.sin(ambientTime + i) * 0.04})`;
      ctx.beginPath();
      ctx.arc((mote.x + Math.sin(ambientTime * 0.15 + i) * 9 + W) % W,
        (mote.y - ambientTime * mote.speed % H + H) % H, mote.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawObject(object, demo = false) {
    if (!demo && object.warning > 0) {
      const pulse = 0.45 + Math.sin(ambientTime * 18) * 0.18;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = object.color;
      ctx.beginPath();
      ctx.moveTo(object.x - 5, 16); ctx.lineTo(object.x + 5, 16); ctx.lineTo(object.x, 23);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = object.color;
      ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.moveTo(object.x, 29); ctx.lineTo(object.x, 69); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    if (!demo) {
      const progress = clamp(object.y / 550, 0, 1);
      ctx.fillStyle = `rgba(8,17,13,${0.08 + progress * 0.23})`;
      ctx.beginPath(); ctx.ellipse(object.x, 548, object.width * (0.15 + progress * 0.27), 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(object.x, object.y);
    ctx.rotate(object.rotation);
    ctx.fillStyle = 'rgba(7,19,12,.18)';
    roundRect(-object.width / 2 + 3, -object.height / 2 + 5, object.width, object.height, 5); ctx.fill();
    ctx.fillStyle = object.color;
    roundRect(-object.width / 2, -object.height / 2, object.width, object.height, 5); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,232,.20)';
    roundRect(-object.width / 2 + 3, -object.height / 2 + 3, object.width - 6, 4, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(63,57,38,.18)'; ctx.lineWidth = 1.4;
    if (object.stripe) {
      ctx.beginPath(); ctx.moveTo(-object.width * 0.15, -object.height / 2);
      ctx.lineTo(-object.width * 0.15, object.height / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(object.width * 0.15, -object.height / 2);
      ctx.lineTo(object.width * 0.15, object.height / 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-object.width * 0.23, object.height * 0.12);
      ctx.lineTo(object.width * 0.23, object.height * 0.12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-object.width * 0.23, object.height * 0.23);
      ctx.lineTo(object.width * 0.07, object.height * 0.23); ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const moving = !!direction();
    const bob = moving ? Math.sin(player.step * 2) * 1.5 : Math.sin(ambientTime * 2.4) * 1.1;
    const y = PLAYER_Y + bob;
    const ghost = cloak > 0;
    ctx.fillStyle = 'rgba(5,16,10,.35)';
    ctx.beginPath(); ctx.ellipse(player.x, 548, 19, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (ghost) {
      ctx.strokeStyle = `rgba(216,239,154,${0.22 + cloak * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(player.x, y - 6, 27 + Math.sin(ambientTime * 14) * 2, 35, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.save();
    ctx.translate(player.x, y);
    ctx.globalAlpha = ghost ? 0.38 : state === 'over' ? 0.6 : 1;
    // The scarf trails behind the direction of travel.
    const tail = -player.facing;
    ctx.fillStyle = '#D98D72';
    ctx.beginPath(); ctx.moveTo(tail * 8, -8);
    ctx.quadraticCurveTo(tail * 26, -8 + Math.sin(ambientTime * 9) * 3, tail * 35, -17);
    ctx.lineTo(tail * 29, -6); ctx.quadraticCurveTo(tail * 20, -1, tail * 8, -3); ctx.closePath(); ctx.fill();
    const footStep = moving ? Math.sin(player.step) * 4 : 0;
    ctx.fillStyle = '#8FA365';
    roundRect(-10, 10 + footStep, 8, 9, 3); ctx.fill();
    roundRect(3, 10 - footStep, 8, 9, 3); ctx.fill();
    ctx.fillStyle = '#BDCF88';
    roundRect(-11, -11, 23, 27, 8); ctx.fill();
    ctx.fillStyle = '#A5B976';
    roundRect(-16, -7, 7, 16, 3); ctx.fill();
    roundRect(10, -7, 7, 16, 3); ctx.fill();
    ctx.fillStyle = '#D8E99F';
    roundRect(-16, -33, 33, 29, 11); ctx.fill();
    ctx.fillStyle = '#B8CC83';
    ctx.beginPath(); ctx.moveTo(-9, -29); ctx.lineTo(-8, -39); ctx.lineTo(-1, -32); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#26392A';
    roundRect(-14, -24, 29, 10, 4); ctx.fill();
    ctx.fillStyle = '#F3F0CC';
    ctx.fillRect(-8 + player.facing, -21, 3, 3);
    ctx.fillRect(4 + player.facing, -21, 3, 3);
    ctx.fillStyle = '#E6A28A';
    roundRect(-12, -8, 25, 5, 2); ctx.fill();
    ctx.fillStyle = '#8D9F62'; ctx.fillRect(-8, 6, 16, 3);
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate(Math.sin(ambientTime * 90) * shake * 9, Math.cos(ambientTime * 71) * shake * 6);
    drawCity();
    if (state === 'ready') {
      const demoObjects = [
        { x: 74, offset: 70, width: 39, height: 43, color: colors[0], stripe: true },
        { x: 337, offset: 218, width: 37, height: 37, color: colors[2], stripe: false },
        { x: 148, offset: 440, width: 31, height: 43, color: colors[3], stripe: false },
        { x: 294, offset: 368, width: 47, height: 35, color: colors[1], stripe: true },
      ];
      demoObjects.forEach((object, i) => drawObject({ ...object,
        y: ((object.offset + ambientTime * (12 + i * 2)) % 510) - 30,
        rotation: Math.sin(ambientTime * 0.32 + i) * 0.5 }, true));
    } else {
      obstacles.forEach((object) => drawObject(object));
    }
    drawPlayer();
    particles.forEach((p) => {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    popups.forEach((popup) => {
      ctx.globalAlpha = Math.min(1, popup.life * 2.5);
      ctx.font = '700 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#DBEBA5';
      ctx.fillText(popup.text, popup.x, popup.y);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(bounds.width * dpr);
    canvas.height = Math.round(bounds.height * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  }

  function pointerSide(event, surface) {
    const bounds = surface.getBoundingClientRect();
    return event.clientX - bounds.left < bounds.width / 2 ? -1 : 1;
  }

  [canvas, ui.touchPad].filter(Boolean).forEach((surface) => {
    surface.style.touchAction = 'none';
    surface.addEventListener('pointerdown', (event) => {
      if (state !== 'playing' || activePointer !== null || event.button > 0) return;
      event.preventDefault();
      activePointer = event.pointerId;
      pointerSurface = surface;
      pointerDirection = pointerSide(event, surface);
      lastMoving = true;
      try { surface.setPointerCapture(event.pointerId); } catch (_) {}
      updateHUD();
    });
    surface.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activePointer) return;
      event.preventDefault();
      pointerDirection = pointerSide(event, surface);
      updateHUD();
    });
    surface.addEventListener('pointerup', (event) => {
      if (event.pointerId !== activePointer) return;
      event.preventDefault();
      clearInput(true);
    });
    surface.addEventListener('pointercancel', (event) => {
      if (event.pointerId === activePointer) clearInput();
    });
    surface.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId === activePointer) clearInput();
    });
    surface.addEventListener('contextmenu', (event) => event.preventDefault());
  });

  function closeHelp() {
    ui.helpPanel.hidden = true;
    ui.helpBtn.focus({ preventScroll: true });
  }

  window.addEventListener('keydown', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (!ui.helpPanel.hidden) {
      if (key === 'Escape' && !event.repeat) {
        event.preventDefault();
        closeHelp();
      } else if (key === 'Tab') {
        const focusable = Array.from(ui.helpPanel.querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && (event.shiftKey
          ? document.activeElement === first || !ui.helpPanel.contains(document.activeElement)
          : document.activeElement === last || !ui.helpPanel.contains(document.activeElement))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'a', 'd', ' '].includes(key) && state === 'playing') {
      event.preventDefault();
      if (key === ' ') {
        if (!spaceHeld && !event.repeat) activateCloak();
        spaceHeld = true;
      } else {
        keys.add(key);
        lastMoving = !!direction();
      }
      updateHUD();
    }
    if ((key === 'Escape' || key === 'p') && !event.repeat) {
      event.preventDefault();
      if (state === 'playing') pause();
      else if (state === 'paused') resume();
    }
  });
  window.addEventListener('keyup', (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const wasMoving = !!direction();
    keys.delete(key);
    if (key === ' ') spaceHeld = false;
    if (wasMoving && !direction() && activePointer === null) activateCloak();
    updateHUD();
  });
  window.addEventListener('blur', () => { pause(); clearInput(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); clearInput(); }
    lastFrame = performance.now();
  });
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(canvas);

  ui.startBtn.addEventListener('click', start);
  ui.retryBtn.addEventListener('click', start);
  ui.resumeBtn.addEventListener('click', resume);
  ui.pauseBtn.addEventListener('click', () => state === 'paused' ? resume() : pause());
  ui.helpBtn.addEventListener('click', () => {
    pause();
    clearInput();
    ui.helpPanel.hidden = false;
    if (ui.closeHelpBtn) ui.closeHelpBtn.focus({ preventScroll: true });
  });
  ui.closeHelpBtn.addEventListener('click', closeHelp);
  ui.soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    ui.soundBtn.setAttribute('aria-pressed', String(soundEnabled));
    ui.soundBtn.setAttribute('aria-label', soundEnabled ? 'Turn sound off' : 'Turn sound on');
    ui.soundBtn.dataset.enabled = String(soundEnabled);
    ui.soundBtn.classList.toggle('is-on', soundEnabled);
    setText(ui.soundBtn.querySelector('span'), soundEnabled ? 'SOUND ON' : 'SOUND OFF');
    const soundMark = ui.soundBtn.querySelector('svg path:last-child');
    if (soundMark) soundMark.setAttribute('d', soundEnabled
      ? 'M11 7c2 1 2 5 0 6m2-8c4 2 4 8 0 10'
      : 'm12 8 4 4m0-4-4 4');
    tone(580, 0.06);
  });

  window.addEventListener('error', (event) => {
    runtimeErrors.push(String(event.message || 'Unknown error'));
  });
  window.addEventListener('unhandledrejection', (event) => {
    runtimeErrors.push(String(event.reason?.message || event.reason || 'Unhandled rejection'));
  });
  Object.defineProperty(window, 'Sneakfall', {
    configurable: false,
    get: () => Object.freeze({ state, score: Math.floor(score), best, elapsed,
      dodges, cloak, cooldown, holding: !!direction(), direction: direction(),
      player: Object.freeze({ x: player.x, y: PLAYER_Y }),
      obstacles: Object.freeze(obstacles.map((object) => Object.freeze({
        id: object.id, x: object.x, y: object.y, width: object.width,
        height: object.height, warning: object.warning, speed: object.speed,
      }))),
      soundEnabled, fps: Math.round(fps), errors: Object.freeze(runtimeErrors.slice(-8)),
      viewport: Object.freeze({ width: canvas.width, height: canvas.height }),
    }),
  });

  function frame(now) {
    const rawDelta = lastFrame ? (now - lastFrame) / 1000 : 0;
    const dt = Math.min(0.033, Math.max(0, rawDelta));
    lastFrame = now;
    if (rawDelta > 0 && rawDelta < 0.2) fps = fps * 0.94 + (1 / rawDelta) * 0.06;
    ambientTime += dt;
    if (state === 'playing') update(dt);
    else if (state !== 'paused') updateEffects(dt);
    draw();
    requestAnimationFrame(frame);
  }

  setPanels(state);
  updateHUD();
  resize();
  requestAnimationFrame(frame);
})();
