/* Character 04: autonomous paper-doll rig. No mirroring: its asymmetry is identity. */
(() => {
  "use strict";

  const WIDTH = 960;
  const HEIGHT = 620;
  const TAU = Math.PI * 2;

  const PARTS = {
    head: { crop: [20, 20, 300, 670], pivot: [150, 629.8] },
    torso: { crop: [350, 20, 549, 599], pivot: [274.5, 347.42] },
    left_thigh: { crop: [950, 20, 116, 310], prox: [58, 24.8], dist: [58, 272.8] },
    left_shin: { crop: [950, 360, 122, 320], prox: [64.66, 28.8], dist: [64.66, 256] },
    right_thigh: { crop: [1190, 20, 135, 310], prox: [67.5, 24.8], dist: [67.5, 272.8] },
    right_shin: { crop: [1190, 360, 111, 320], prox: [52.17, 28.8], dist: [52.17, 256] },
    left_knee: { crop: [1440, 120, 94, 120], pivot: [47, 60] },
    right_knee: { crop: [1440, 430, 95, 120], pivot: [47.5, 60] },
    right_focus: { crop: [1580, 20, 413, 700], pivot: [45.43, 490] },
    left_focus: { crop: [20, 790, 650, 492], pivot: [45.5, 413.28] },
    left_upper: { crop: [700, 790, 351, 250], prox: [35.1, 210], dist: [315.9, 40] },
    left_fore: { crop: [700, 1070, 550, 201], prox: [44, 100.5], dist: [500.5, 100.5] },
    right_upper: { crop: [1280, 790, 480, 154], prox: [38.4, 77], dist: [441.6, 77] },
    right_fore: { crop: [1280, 1030, 477, 260], prox: [38.16, 130], dist: [429.3, 130] }
  };

  // The source sheet's top row is the image-right chained focus; its bottom
  // row is the image-left shafted focus. Both strips are wrist-aligned so a
  // frame change only moves the painted fire, never the hand connection.
  const FOCUS_ANIMATIONS = {
    right_focus: {
      frameWidth: 536,
      frameHeight: 840,
      frameCount: 4,
      pivot: [63, 500],
      ringCenter: [216, -52],
      phaseOffset: 0
    },
    left_focus: {
      frameWidth: 780,
      frameHeight: 640,
      frameCount: 4,
      pivot: [70, 438],
      ringCenter: [375, -155],
      phaseOffset: 2
    }
  };
  const FOCUS_FPS = 8;

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const ease = value => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  };

  function seededRandom(seed) {
    let state = seed >>> 0 || 0x4f524249;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function chooseTarget(sim) {
    // Both weapons are wide. These bounds keep their full silhouettes on the
    // field even during the arms-out resonance pose.
    sim.targetX = mix(380, 600, sim.random());
    sim.targetY = mix(466, 548, sim.random());
    sim.timer = mix(5.4, 8.5, sim.random());
  }

  function setMode(sim, mode, duration) {
    sim.mode = mode;
    sim.modeElapsed = 0;
    sim.timer = duration;
  }

  function createSimulation(seed = 404) {
    const sim = {
      x: 478,
      y: 518,
      targetX: 478,
      targetY: 518,
      mode: "wander",
      modeElapsed: 0,
      timer: 6,
      stepPhase: 0,
      resonance: 0,
      travelled: 0,
      pulseClock: 0,
      random: seededRandom(seed)
    };
    chooseTarget(sim);
    return sim;
  }

  function stepSimulation(sim, dt) {
    dt = clamp(dt, 0, 0.05);
    sim.timer -= dt;
    sim.modeElapsed += dt;

    if (sim.mode === "wander") {
      const dx = sim.targetX - sim.x;
      const dy = sim.targetY - sim.y;
      const distance = Math.hypot(dx, dy);
      const speed = 34;
      const travel = Math.min(distance, speed * dt);
      if (distance > 0.001) {
        sim.x += dx / distance * travel;
        sim.y += dy / distance * travel;
      }
      sim.travelled += travel;
      sim.stepPhase += travel * 0.048;
      if (distance < 5 || sim.timer <= 0) {
        setMode(sim, "tune", 1.55);
      }
    } else if (sim.mode === "tune") {
      sim.stepPhase += dt * 0.55;
      if (sim.timer <= 0) {
        setMode(sim, "resonate", 2.25);
        sim.pulseClock = 0;
      }
    } else {
      sim.pulseClock += dt;
      if (sim.timer <= 0) {
        setMode(sim, "wander", 6);
        chooseTarget(sim);
      }
    }

    const resonanceTarget = sim.mode === "resonate" ? 1 : sim.mode === "tune" ? 0.28 : 0;
    sim.resonance = mix(sim.resonance, resonanceTarget, 1 - Math.exp(-dt * 4.8));
  }

  function drawPart(ctx, atlas, name, x, y, angle = 0, pivot, opacity = 1, partScale = 1) {
    const part = PARTS[name];
    const [sx, sy, sw, sh] = part.crop;
    const anchor = pivot || part.pivot || part.prox;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(partScale, partScale);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(atlas, sx, sy, sw, sh, -anchor[0], -anchor[1], sw, sh);
    ctx.restore();
  }

  function drawSegment(ctx, atlas, name, from, to, opacity = 1) {
    const part = PARTS[name];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const sourceDx = part.dist[0] - part.prox[0];
    const sourceDy = part.dist[1] - part.prox[1];
    const targetLength = Math.hypot(dx, dy);
    const sourceLength = Math.hypot(sourceDx, sourceDy);
    const angle = Math.atan2(dy, dx) - Math.atan2(sourceDy, sourceDx);
    const scale = targetLength / sourceLength;
    const [sx, sy, sw, sh] = part.crop;
    ctx.save();
    ctx.translate(from[0], from[1]);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(atlas, sx, sy, sw, sh, -part.prox[0], -part.prox[1], sw, sh);
    ctx.restore();
  }

  function drawAnimatedFocus(ctx, assets, name, x, y, angle, time, opacity = 1) {
    const definition = FOCUS_ANIMATIONS[name];
    const sheet = assets.focusSheets && assets.focusSheets[name];
    if (!sheet) {
      drawPart(ctx, assets.atlas || assets, name, x, y, angle, undefined, opacity);
      return;
    }

    const frame = (Math.floor(time * FOCUS_FPS) + definition.phaseOffset) % definition.frameCount;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(
      sheet,
      frame * definition.frameWidth,
      0,
      definition.frameWidth,
      definition.frameHeight,
      -definition.pivot[0],
      -definition.pivot[1],
      definition.frameWidth,
      definition.frameHeight
    );
    ctx.restore();
  }

  function solveTwoBone(hip, ankle, upperLength, lowerLength, bend) {
    const dx = ankle[0] - hip[0];
    const dy = ankle[1] - hip[1];
    const rawDistance = Math.hypot(dx, dy);
    const distance = clamp(rawDistance, Math.abs(upperLength - lowerLength) + 0.01, upperLength + lowerLength - 0.01);
    const baseAngle = Math.atan2(dy, dx);
    const cosine = clamp(
      (distance * distance + upperLength * upperLength - lowerLength * lowerLength) /
      (2 * distance * upperLength),
      -1,
      1
    );
    const upperAngle = baseAngle + bend * Math.acos(cosine);
    return [
      hip[0] + Math.cos(upperAngle) * upperLength,
      hip[1] + Math.sin(upperAngle) * upperLength
    ];
  }

  function rotatePoint(x, y, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [x * cosine - y * sine, x * sine + y * cosine];
  }

  function localToWorld(point, originX, originY, scale) {
    return [originX + point[0] * scale, originY + point[1] * scale];
  }

  function drawField(ctx, time, width, height) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#10151d");
    sky.addColorStop(0.48, "#172531");
    sky.addColorStop(1, "#11211f");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const aurora = ctx.createRadialGradient(width * 0.72, height * 0.2, 0, width * 0.72, height * 0.2, width * 0.58);
    aurora.addColorStop(0, "rgba(128, 75, 190, .22)");
    aurora.addColorStop(0.45, "rgba(59, 115, 130, .10)");
    aurora.addColorStop(1, "rgba(16, 21, 29, 0)");
    ctx.fillStyle = aurora;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(153, 190, 185, .10)";
    ctx.lineWidth = 1;
    const horizon = 238;
    for (let row = 0; row < 10; row += 1) {
      const y = horizon + Math.pow(row / 9, 1.65) * (height - horizon);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let col = -8; col <= 8; col += 1) {
      const topX = width / 2 + col * 31;
      const bottomX = width / 2 + col * 97;
      ctx.beginPath();
      ctx.moveTo(topX, horizon);
      ctx.lineTo(bottomX, height);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = "rgba(4, 8, 11, .26)";
    ctx.beginPath();
    ctx.moveTo(0, 265);
    for (let x = 0; x <= width; x += 80) {
      ctx.lineTo(x, 246 + Math.sin(x * 0.019) * 15 + Math.sin(x * 0.047) * 6);
    }
    ctx.lineTo(width, 322);
    ctx.lineTo(0, 322);
    ctx.closePath();
    ctx.fill();

    for (let index = 0; index < 18; index += 1) {
      const drift = (time * (3 + index % 4) + index * 109) % (width + 80) - 40;
      const y = 105 + (index * 73) % 360 + Math.sin(time * 0.7 + index) * 9;
      const alpha = 0.08 + (index % 5) * 0.018;
      ctx.fillStyle = `rgba(202, 154, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(drift, y, 1 + index % 2, 0, TAU);
      ctx.fill();
    }
  }

  function drawResonance(ctx, center, age, strength, offset = 0) {
    if (strength <= 0.02) return;
    for (let index = 0; index < 4; index += 1) {
      const phase = (age * 0.62 + offset + index * 0.24) % 1;
      const radius = 16 + phase * 116;
      ctx.strokeStyle = `rgba(202, 139, 255, ${(1 - phase) * 0.34 * strength})`;
      ctx.lineWidth = 1.2 + (1 - phase) * 2.2;
      ctx.beginPath();
      ctx.arc(center[0], center[1], radius, 0, TAU);
      ctx.stroke();
    }
  }

  function drawRune(ctx, x, y, time, strength) {
    if (strength <= 0.03) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, 0.27);
    ctx.rotate(time * 0.18);
    ctx.strokeStyle = `rgba(180, 110, 255, ${0.28 * strength})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 104 + Math.sin(time * 2) * 4, 0, TAU);
    ctx.stroke();
    ctx.rotate(-time * 0.4);
    ctx.setLineDash([8, 18]);
    ctx.beginPath();
    ctx.arc(0, 0, 78, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function renderCharacter(ctx, assets, sim, time) {
    const atlas = assets.atlas || assets;
    const walkAmount = sim.mode === "wander" ? 1 : Math.max(0, 1 - sim.modeElapsed * 3);
    const stride = Math.sin(sim.stepPhase) * walkAmount;
    const energy = ease(sim.resonance);
    const scale = clamp(0.286 + (sim.y - 466) * 0.00052, 0.286, 0.332);
    const bob = -Math.abs(Math.sin(sim.stepPhase)) * 3.5 * walkAmount + Math.sin(time * 1.8) * 0.7;
    const originX = sim.x;
    const originY = sim.y - 625 * scale + bob;

    const leftShoulder = [-198, -165];
    const rightShoulder = [198, -165];
    const leftElbow = [mix(-295 - stride * 6, -315, energy), mix(-58 + stride * 8, -213, energy)];
    const leftWrist = [mix(-386 - stride * 9, -438, energy), mix(48 + stride * 10, -176, energy)];
    const rightElbow = [mix(286 + stride * 5, 315, energy), mix(-74 - stride * 7, -213, energy)];
    const rightWrist = [mix(382 + stride * 8, 438, energy), mix(2 - stride * 9, -176, energy)];
    const leftFocusAngle = Math.PI + Math.sin(time * 1.9) * 0.035 - energy * 0.16;
    const rightFocusAngle = Math.sin(time * 1.5 + 0.6) * 0.03 + energy * 0.11;

    const leftRingOffset = rotatePoint(...FOCUS_ANIMATIONS.left_focus.ringCenter, leftFocusAngle);
    const rightRingOffset = rotatePoint(...FOCUS_ANIMATIONS.right_focus.ringCenter, rightFocusAngle);
    const leftRingWorld = localToWorld([leftWrist[0] + leftRingOffset[0], leftWrist[1] + leftRingOffset[1]], originX, originY, scale);
    const rightRingWorld = localToWorld([rightWrist[0] + rightRingOffset[0], rightWrist[1] + rightRingOffset[1]], originX, originY, scale);
    const forkWorld = localToWorld([0, -616], originX, originY, scale);

    drawRune(ctx, originX, sim.y + 7, time, energy);
    drawResonance(ctx, forkWorld, sim.pulseClock, energy, 0);
    drawResonance(ctx, leftRingWorld, sim.pulseClock, energy, 0.17);
    drawResonance(ctx, rightRingWorld, sim.pulseClock, energy, 0.33);

    ctx.save();
    ctx.translate(originX, sim.y + 8);
    ctx.scale(1, 0.28);
    const shadow = ctx.createRadialGradient(0, 0, 8, 0, 0, 174 * scale / 0.31);
    shadow.addColorStop(0, "rgba(0, 0, 0, .36)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 174 * scale / 0.31, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    // Back arm first: the large chained focus sits behind the coat silhouette.
    ctx.save();
    if (energy > 0.03) {
      ctx.shadowColor = `rgba(170, 76, 255, ${0.85 * energy})`;
      ctx.shadowBlur = 34 * energy;
    }
    drawAnimatedFocus(ctx, assets, "right_focus", rightWrist[0], rightWrist[1], rightFocusAngle, time);
    ctx.restore();
    drawSegment(ctx, atlas, "right_fore", rightElbow, rightWrist);
    drawSegment(ctx, atlas, "right_upper", rightShoulder, rightElbow);

    // The hip points match the two black sockets painted into the torso. Each
    // leg now has a real two-bone solve, with an independent knee cover hiding
    // the paper-doll overlap during the stride.
    const leftHip = [-101, 118];
    const rightHip = [92, 118];
    const stepLift = Math.cos(sim.stepPhase) * walkAmount;
    const leftAnkle = [-112 + stride * 25, 563 - Math.max(0, stepLift) * 30];
    const rightAnkle = [104 - stride * 25, 563 - Math.max(0, -stepLift) * 30];
    const leftKnee = solveTwoBone(leftHip, leftAnkle, 225, 230, 1);
    const rightKnee = solveTwoBone(rightHip, rightAnkle, 225, 230, -1);
    const leftKneeAngle = (
      Math.atan2(leftKnee[1] - leftHip[1], leftKnee[0] - leftHip[0]) +
      Math.atan2(leftAnkle[1] - leftKnee[1], leftAnkle[0] - leftKnee[0])
    ) * 0.5 - Math.PI / 2;
    const rightKneeAngle = (
      Math.atan2(rightKnee[1] - rightHip[1], rightKnee[0] - rightHip[0]) +
      Math.atan2(rightAnkle[1] - rightKnee[1], rightAnkle[0] - rightKnee[0])
    ) * 0.5 - Math.PI / 2;

    drawSegment(ctx, atlas, "right_thigh", rightHip, rightKnee);
    drawSegment(ctx, atlas, "right_shin", rightKnee, rightAnkle);
    drawSegment(ctx, atlas, "left_thigh", leftHip, leftKnee);
    drawSegment(ctx, atlas, "left_shin", leftKnee, leftAnkle);
    drawPart(ctx, atlas, "right_knee", rightKnee[0], rightKnee[1], rightKneeAngle, undefined, 1, 0.7);
    drawPart(ctx, atlas, "left_knee", leftKnee[0], leftKnee[1], leftKneeAngle, undefined, 1, 0.7);

    // The image-left shoulder is under the cowl; its forearm and unique small
    // shafted focus are deliberately drawn in front after the torso.
    drawSegment(ctx, atlas, "left_upper", leftShoulder, leftElbow);
    drawPart(ctx, atlas, "torso", 0, 0, Math.sin(time * 1.15) * 0.004 + stride * 0.004);

    ctx.save();
    if (energy > 0.03) {
      ctx.shadowColor = `rgba(180, 83, 255, ${0.8 * energy})`;
      ctx.shadowBlur = 28 * energy;
    }
    drawAnimatedFocus(ctx, assets, "left_focus", leftWrist[0], leftWrist[1], leftFocusAngle, time);
    ctx.restore();
    drawSegment(ctx, atlas, "left_fore", leftElbow, leftWrist);

    const headShake = energy * Math.sin(time * 64) * 4.2;
    const headAngle = Math.sin(time * 0.72) * 0.006 + stride * 0.004;
    if (energy > 0.08) {
      drawPart(ctx, atlas, "head", headShake - 7 * energy, -284, headAngle - 0.006, undefined, 0.12 * energy);
      drawPart(ctx, atlas, "head", headShake + 7 * energy, -284, headAngle + 0.006, undefined, 0.12 * energy);
    }
    drawPart(ctx, atlas, "head", headShake, -284, headAngle);
    ctx.restore();
  }

  function renderScene(ctx, assets, sim, time, width = WIDTH, height = HEIGHT) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    drawField(ctx, time, width, height);
    renderCharacter(ctx, assets, sim, time);
    const vignette = ctx.createRadialGradient(width / 2, height * 0.48, width * 0.24, width / 2, height * 0.48, width * 0.72);
    vignette.addColorStop(0, "rgba(3, 7, 10, 0)");
    vignette.addColorStop(1, "rgba(3, 7, 10, .42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const api = { WIDTH, HEIGHT, PARTS, FOCUS_ANIMATIONS, createSimulation, stepSimulation, renderScene };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Character04Rig = api;
})();

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const canvas = document.querySelector("#field");
    const status = document.querySelector("#status");
    const fallback = document.querySelector("#fallback");
    const rig = window.Character04Rig;
    const assets = {
      atlas: new Image(),
      focusSheets: {
        right_focus: new Image(),
        left_focus: new Image()
      }
    };
    const sim = rig.createSimulation(Math.floor(Date.now() / 1000));
    let lastTime = performance.now();
    let elapsed = 0;
    let ready = false;
    let pendingImages = 3;
    let loadFailed = false;

    function sizeCanvas() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rig.WIDTH * ratio;
      canvas.height = rig.HEIGHT * ratio;
      canvas.dataset.ratio = ratio;
    }

    function frame(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      elapsed += dt;
      if (ready) {
        rig.stepSimulation(sim, dt);
        const context = canvas.getContext("2d");
        const ratio = Number(canvas.dataset.ratio || 1);
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        rig.renderScene(context, assets, sim, elapsed, rig.WIDTH, rig.HEIGHT);
        const names = { wander: "DRIFTING", tune: "LISTENING", resonate: "RESONATING" };
        status.textContent = names[sim.mode];
      }
      requestAnimationFrame(frame);
    }

    function imageLoaded() {
      pendingImages -= 1;
      if (pendingImages === 0 && !loadFailed) {
        ready = true;
        fallback.hidden = true;
      }
    }

    function imageFailed() {
      loadFailed = true;
      fallback.hidden = false;
      fallback.textContent = "The character animation assets could not be loaded.";
    }

    const imageSources = [
      [assets.atlas, "character-04-parts-atlas.png"],
      [assets.focusSheets.right_focus, "parts/right_focus-frames.png"],
      [assets.focusSheets.left_focus, "parts/left_focus-frames.png"]
    ];
    for (const [image, source] of imageSources) {
      image.onload = imageLoaded;
      image.onerror = imageFailed;
      image.src = source;
    }
    sizeCanvas();
    requestAnimationFrame(frame);
  });
}
