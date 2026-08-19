/* Character 05: heavyweight paper-doll field walker with two independent chains. */
(() => {
  "use strict";

  const WIDTH = 960;
  const HEIGHT = 620;
  const TAU = Math.PI * 2;

  // Names are image-left/image-right in the neutral bind pose. Nothing is
  // mirrored: the painted wear, joints, fists, feet, and weights stay paired.
  const PARTS = {
    body: { file: "parts/body.png", pivot: [0.5, 0.5], scale: 1.05 },
    pelvis: { file: "parts/pelvis.png", pivot: [0.5, 0.45], scale: 0.55 },
    // These are independent source-side extractions. The viewer-left part has
    // its torso ring on the right; the viewer-right part has its ring on the
    // left. Their different silhouettes and scales are intentional.
    left_shoulder: { file: "parts/left_shoulder.png", prox: [0.84, 0.39], dist: [0.34, 0.91] },
    right_shoulder: { file: "parts/right_shoulder.png", prox: [0.13, 0.41], dist: [0.89, 0.87] },
    // Optional standalone atlas pieces remain downloadable, but the runtime
    // uses the complete shoulder-through-elbow assemblies above.
    left_upper_arm: { file: "parts/left_upper_arm.png", prox: [0.4, 0.19], dist: [0.51, 0.79] },
    right_upper_arm: { file: "parts/right_upper_arm.png", prox: [0.19, 0.25], dist: [0.79, 0.71] },
    left_forearm_fist: { file: "parts/left_forearm_fist.png", prox: [0.51, 0.12], dist: [0.45, 0.86] },
    right_forearm_fist: { file: "parts/right_forearm_fist.png", prox: [0.48, 0.12], dist: [0.53, 0.86] },
    left_thigh: { file: "parts/left_thigh.png", prox: [0.55, 0.13], dist: [0.54, 0.84] },
    right_thigh: { file: "parts/right_thigh.png", prox: [0.45, 0.13], dist: [0.49, 0.84] },
    left_shin_foot: { file: "parts/left_shin_foot.png", prox: [0.51, 0.13], dist: [0.48, 0.92] },
    right_shin_foot: { file: "parts/right_shin_foot.png", prox: [0.49, 0.13], dist: [0.53, 0.92] },
    left_knee: { file: "parts/left_knee.png", pivot: [0.5, 0.54], scale: 0.27 },
    right_knee: { file: "parts/right_knee.png", pivot: [0.5, 0.54], scale: 0.27 },
    left_weight: { file: "parts/left_weight.png", pivot: [0.5, 0.8], scale: 0.43 },
    right_weight: { file: "parts/right_weight.png", pivot: [0.5, 0.8], scale: 0.47 }
  };

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const ease = value => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  };

  function seededRandom(seed) {
    let state = seed >>> 0 || 0x43483035;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  const sceneryRandom = seededRandom(50505);
  const GRASS = Array.from({ length: 190 }, (_, index) => ({
    x: sceneryRandom() * WIDTH,
    y: 338 + Math.pow(sceneryRandom(), 0.72) * 290,
    height: 7 + sceneryRandom() * 24,
    lean: sceneryRandom() * 7 - 3.5,
    layer: index % 3
  }));

  function sceneScale(y) {
    return clamp(0.79 + (y - 500) * 0.001, 0.77, 0.84);
  }

  function chooseTarget(sim) {
    sim.targetX = mix(335, 625, sim.random());
    sim.targetY = mix(500, 548, sim.random());
    sim.timer = mix(6.5, 9.5, sim.random());
    sim.modeDuration = sim.timer;
  }

  function setMode(sim, mode, duration) {
    sim.mode = mode;
    sim.modeElapsed = 0;
    sim.modeDuration = duration;
    sim.timer = duration;
  }

  function createSimulation(seed = 505) {
    const random = seededRandom(seed);
    const sim = {
      x: 480,
      y: 526,
      targetX: 480,
      targetY: 526,
      velocityX: 0,
      velocityY: 0,
      mode: "haul",
      modeElapsed: 0,
      modeDuration: 8,
      timer: 8,
      action: 0,
      stepPhase: 0,
      travelled: 0,
      impactAge: 99,
      random,
      weights: {
        left: { x: 298, y: 526, vx: 0, vy: 0, angle: -0.04 },
        right: { x: 662, y: 526, vx: 0, vy: 0, angle: 0.04 }
      }
    };
    chooseTarget(sim);
    return sim;
  }

  function updateWeight(weight, targetX, targetY, dt, side) {
    const spring = 9.5;
    weight.vx += (targetX - weight.x) * spring * dt;
    weight.vy += (targetY - weight.y) * spring * dt;
    const damping = Math.exp(-dt * 4.5);
    weight.vx *= damping;
    weight.vy *= damping;
    weight.x += weight.vx * dt;
    weight.y += weight.vy * dt;
    if (weight.y > targetY + 4) {
      weight.y = targetY + 4;
      weight.vy *= -0.18;
    }
    const targetAngle = clamp(weight.vx * 0.0025 + side * 0.025, -0.16, 0.16);
    weight.angle = mix(weight.angle, targetAngle, 1 - Math.exp(-dt * 7));
  }

  function stepSimulation(sim, dt) {
    dt = clamp(dt, 0, 0.05);
    sim.timer -= dt;
    sim.modeElapsed += dt;
    sim.impactAge += dt;

    const previousX = sim.x;
    const previousY = sim.y;

    if (sim.mode === "haul") {
      const dx = sim.targetX - sim.x;
      const dy = sim.targetY - sim.y;
      const distance = Math.hypot(dx, dy);
      const speed = 25;
      const travel = Math.min(distance, speed * dt);
      if (distance > 0.001) {
        sim.x += dx / distance * travel;
        sim.y += dy / distance * travel;
      }
      sim.travelled += travel;
      sim.stepPhase += travel * 0.064;
      if (distance < 5 || sim.timer <= 0) setMode(sim, "brace", 1.35);
    } else if (sim.mode === "brace") {
      if (sim.timer <= 0) {
        setMode(sim, "slam", 0.9);
        sim.impactAge = 0;
        sim.weights.left.vx -= 75;
        sim.weights.right.vx += 75;
        sim.weights.left.vy -= 24;
        sim.weights.right.vy -= 24;
      }
    } else if (sim.mode === "slam") {
      if (sim.timer <= 0) setMode(sim, "recover", 1.35);
    } else if (sim.timer <= 0) {
      setMode(sim, "haul", 8);
      chooseTarget(sim);
    }

    if (sim.mode === "brace") {
      sim.action = ease(sim.modeElapsed / sim.modeDuration);
    } else if (sim.mode === "slam") {
      sim.action = 1;
    } else if (sim.mode === "recover") {
      sim.action = 1 - ease(sim.modeElapsed / sim.modeDuration);
    } else {
      sim.action = 0;
    }

    sim.velocityX = (sim.x - previousX) / Math.max(dt, 0.001);
    sim.velocityY = (sim.y - previousY) / Math.max(dt, 0.001);

    const scale = sceneScale(sim.y);
    const spread = mix(218, 324, sim.action) * scale;
    const drag = sim.velocityX * 1.5;
    const scrape = Math.abs(Math.sin(sim.stepPhase)) * 2 * (1 - sim.action);
    updateWeight(sim.weights.left, sim.x - spread - drag, sim.y + 2 - scrape, dt, -1);
    updateWeight(sim.weights.right, sim.x + spread - drag, sim.y + 2 - scrape, dt, 1);
  }

  function solveTwoBone(hip, ankle, upperLength, lowerLength, bend) {
    const dx = ankle[0] - hip[0];
    const dy = ankle[1] - hip[1];
    const rawDistance = Math.hypot(dx, dy);
    const distance = clamp(
      rawDistance,
      Math.abs(upperLength - lowerLength) + 0.01,
      upperLength + lowerLength - 0.01
    );
    const baseAngle = Math.atan2(dy, dx);
    const cosine = clamp(
      (distance * distance + upperLength * upperLength - lowerLength * lowerLength) /
      (2 * distance * upperLength),
      -1,
      1
    );
    const angle = baseAngle + bend * Math.acos(cosine);
    return [
      hip[0] + Math.cos(angle) * upperLength,
      hip[1] + Math.sin(angle) * upperLength
    ];
  }

  function createPose(sim, time) {
    const action = ease(sim.action);
    const walk = sim.mode === "haul" ? 1 : Math.max(0, 1 - action * 1.8);
    const stride = Math.sin(sim.stepPhase) * walk;
    const lift = Math.cos(sim.stepPhase);
    const impact = sim.impactAge < 1.2 ? Math.exp(-sim.impactAge * 4.2) : 0;
    const shake = impact * Math.sin(time * 58) * 5;
    const bob = -Math.abs(Math.sin(sim.stepPhase)) * 4.4 * walk;

    const leftHip = [mix(-66, -91, action), mix(-151, -137, action) + bob];
    const rightHip = [mix(66, 91, action), mix(-151, -137, action) + bob];
    const leftAnkle = [
      mix(-76 + stride * 26, -145, action),
      -Math.max(0, lift) * 16 * walk
    ];
    const rightAnkle = [
      mix(76 - stride * 26, 145, action),
      -Math.max(0, -lift) * 16 * walk
    ];
    const leftKnee = solveTwoBone(leftHip, leftAnkle, 124, 128, 1);
    const rightKnee = solveTwoBone(rightHip, rightAnkle, 124, 128, -1);

    const leftShoulder = [mix(-132, -146, action), mix(-272, -255, action) + bob + shake];
    const rightShoulder = [mix(132, 146, action), mix(-272, -255, action) + bob + shake];
    const leftElbow = [
      mix(-171 - stride * 7, -211, action),
      mix(-151 + stride * 9, -142, action) + bob
    ];
    const rightElbow = [
      mix(171 + stride * 7, 211, action),
      mix(-151 - stride * 9, -142, action) + bob
    ];
    const leftWrist = [
      mix(-158 - stride * 8, -211, action),
      mix(-35 + stride * 12, -40, action) + bob
    ];
    const rightWrist = [
      mix(158 + stride * 8, 211, action),
      mix(-35 - stride * 12, -40, action) + bob
    ];

    return {
      action,
      stride,
      impact,
      body: [shake, mix(-257, -239, action) + bob + shake],
      bodyAngle: stride * 0.012 - action * 0.018,
      pelvis: [0, mix(-156, -138, action) + bob],
      leftHip,
      rightHip,
      leftKnee,
      rightKnee,
      leftAnkle,
      rightAnkle,
      leftShoulder,
      rightShoulder,
      leftElbow,
      rightElbow,
      leftWrist,
      rightWrist
    };
  }

  function drawSprite(ctx, image, definition, x, y, angle = 0, scaleOverride) {
    if (!image) return;
    const pivot = definition.pivot || [0.5, 0.5];
    const scale = scaleOverride === undefined ? (definition.scale || 1) : scaleOverride;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.drawImage(image, -image.width * pivot[0], -image.height * pivot[1]);
    ctx.restore();
  }

  function drawBone(ctx, image, definition, from, to, opacity = 1) {
    if (!image) return;
    const prox = [image.width * definition.prox[0], image.height * definition.prox[1]];
    const dist = [image.width * definition.dist[0], image.height * definition.dist[1]];
    const sourceDx = dist[0] - prox[0];
    const sourceDy = dist[1] - prox[1];
    const targetDx = to[0] - from[0];
    const targetDy = to[1] - from[1];
    const scale = Math.hypot(targetDx, targetDy) / Math.hypot(sourceDx, sourceDy);
    const angle = Math.atan2(targetDy, targetDx) - Math.atan2(sourceDy, sourceDx);
    ctx.save();
    ctx.translate(from[0], from[1]);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.globalAlpha *= opacity;
    ctx.drawImage(image, -prox[0], -prox[1]);
    ctx.restore();
  }

  function localToWorld(point, originX, originY, scale) {
    return [originX + point[0] * scale, originY + point[1] * scale];
  }

  function drawChain(ctx, start, end, scale, time, side) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const distance = Math.hypot(dx, dy);
    const count = clamp(Math.round(distance / (16 * scale)), 8, 23);
    const sag = clamp(distance * 0.16, 18, 46) + Math.sin(time * 2 + side) * 2;
    const control = [(start[0] + end[0]) / 2, Math.max(start[1], end[1]) + sag];

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const inverse = 1 - t;
      const x = inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0];
      const y = inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1];
      const tangentX = 2 * inverse * (control[0] - start[0]) + 2 * t * (end[0] - control[0]);
      const tangentY = 2 * inverse * (control[1] - start[1]) + 2 * t * (end[1] - control[1]);
      const angle = Math.atan2(tangentY, tangentX) + (index % 2 ? Math.PI / 2 : 0);
      const radius = 7.5 * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.lineWidth = Math.max(3.2, 5.8 * scale);
      ctx.strokeStyle = "rgba(12, 13, 12, .96)";
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.58, 0, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.7, 3.3 * scale);
      ctx.strokeStyle = index % 2 ? "#777a73" : "#555a55";
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.58, 0, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.7, 1.15 * scale);
      ctx.strokeStyle = "rgba(225, 215, 188, .5)";
      ctx.beginPath();
      ctx.ellipse(-radius * 0.06, -radius * 0.08, radius * 0.88, radius * 0.46, 0, Math.PI * 1.05, TAU * 0.96);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawField(ctx, time, width = WIDTH, height = HEIGHT) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#83998b");
    sky.addColorStop(0.38, "#c4a778");
    sky.addColorStop(0.52, "#646f52");
    sky.addColorStop(1, "#26372a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const sun = ctx.createRadialGradient(730, 132, 4, 730, 132, 86);
    sun.addColorStop(0, "rgba(255, 224, 159, .7)");
    sun.addColorStop(0.2, "rgba(241, 168, 73, .28)");
    sun.addColorStop(1, "rgba(241, 168, 73, 0)");
    ctx.fillStyle = sun;
    ctx.fillRect(620, 22, 220, 220);

    ctx.fillStyle = "rgba(50, 65, 49, .62)";
    ctx.beginPath();
    ctx.moveTo(0, 302);
    for (let x = 0; x <= width; x += 48) {
      ctx.lineTo(x, 265 + Math.sin(x * 0.012) * 20 + Math.sin(x * 0.031) * 8);
    }
    ctx.lineTo(width, 385);
    ctx.lineTo(0, 385);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(35, 48, 37, .78)";
    ctx.beginPath();
    ctx.moveTo(0, 340);
    for (let x = 0; x <= width; x += 54) {
      ctx.lineTo(x, 316 + Math.sin(x * 0.018 + 1.4) * 19);
    }
    ctx.lineTo(width, 430);
    ctx.lineTo(0, 430);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(23, 32, 25, .3)";
    for (const x of [118, 824]) {
      ctx.fillRect(x - 13, 218, 26, 76);
      ctx.beginPath();
      ctx.arc(x, 218, 18, Math.PI, 0);
      ctx.fill();
    }

    const wind = Math.sin(time * 0.85) * 4;
    for (const blade of GRASS) {
      const depth = (blade.y - 338) / 282;
      const alpha = 0.18 + depth * 0.42;
      const light = blade.layer === 0 ? "161, 150, 87" : blade.layer === 1 ? "83, 105, 60" : "42, 64, 43";
      ctx.strokeStyle = `rgba(${light}, ${alpha})`;
      ctx.lineWidth = 0.7 + depth * 1.15;
      ctx.beginPath();
      ctx.moveTo(blade.x, blade.y);
      ctx.quadraticCurveTo(
        blade.x + blade.lean * 0.5,
        blade.y - blade.height * 0.55,
        blade.x + blade.lean + wind * depth,
        blade.y - blade.height
      );
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(232, 181, 84, .34)";
    for (let index = 0; index < 22; index += 1) {
      const x = (index * 137 + time * (1.5 + index % 3)) % (width + 40) - 20;
      const y = 92 + (index * 79) % 370 + Math.sin(time * 0.6 + index) * 6;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + index % 2, 0, TAU);
      ctx.fill();
    }
  }

  function drawImpact(ctx, sim, scale) {
    if (sim.impactAge > 1.7) return;
    const phase = clamp(sim.impactAge / 1.7, 0, 1);
    for (const weight of Object.values(sim.weights)) {
      ctx.save();
      ctx.translate(weight.x, weight.y + 2);
      ctx.scale(1, 0.25);
      ctx.strokeStyle = `rgba(235, 159, 72, ${(1 - phase) * 0.68})`;
      ctx.lineWidth = 3 * (1 - phase) + 0.8;
      ctx.beginPath();
      ctx.arc(0, 0, (28 + phase * 105) * scale, 0, TAU);
      ctx.stroke();
      ctx.restore();

      for (let index = 0; index < 7; index += 1) {
        const direction = (index / 6 - 0.5) * Math.PI * 0.85 - Math.PI / 2;
        const travel = (18 + index * 6) * phase * scale;
        ctx.fillStyle = `rgba(198, 157, 91, ${(1 - phase) * 0.46})`;
        ctx.beginPath();
        ctx.arc(
          weight.x + Math.cos(direction) * travel,
          weight.y + Math.sin(direction) * travel * 0.28 - (1 - phase) * index,
          (2.5 + index % 3) * (1 - phase * 0.55),
          0,
          TAU
        );
        ctx.fill();
      }
    }
  }

  function renderCharacter(ctx, assets, sim, time) {
    const pose = createPose(sim, time);
    const scale = sceneScale(sim.y);
    const originX = sim.x;
    const originY = sim.y;

    ctx.save();
    ctx.translate(originX, originY + 8);
    ctx.scale(1, 0.25);
    const shadow = ctx.createRadialGradient(0, 0, 12, 0, 0, 245 * scale);
    shadow.addColorStop(0, "rgba(8, 12, 8, .52)");
    shadow.addColorStop(0.58, "rgba(8, 12, 8, .26)");
    shadow.addColorStop(1, "rgba(8, 12, 8, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 245 * scale, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawImpact(ctx, sim, scale);

    // Weight sprites and chains stay image-side paired throughout the cycle.
    drawSprite(ctx, assets.left_weight, PARTS.left_weight, sim.weights.left.x, sim.weights.left.y, sim.weights.left.angle, PARTS.left_weight.scale * scale);
    drawSprite(ctx, assets.right_weight, PARTS.right_weight, sim.weights.right.x, sim.weights.right.y, sim.weights.right.angle, PARTS.right_weight.scale * scale);

    const leftWristWorld = localToWorld(pose.leftWrist, originX, originY, scale);
    const rightWristWorld = localToWorld(pose.rightWrist, originX, originY, scale);
    const leftWeightTop = [sim.weights.left.x, sim.weights.left.y - 72 * scale];
    const rightWeightTop = [sim.weights.right.x, sim.weights.right.y - 72 * scale];
    drawChain(ctx, leftWristWorld, leftWeightTop, scale, time, -1);
    drawChain(ctx, rightWristWorld, rightWeightTop, scale, time, 1);

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    // Two-bone legs make the neutral walk readable before the wide action pose.
    drawBone(ctx, assets.right_thigh, PARTS.right_thigh, pose.rightHip, pose.rightKnee);
    drawBone(ctx, assets.right_shin_foot, PARTS.right_shin_foot, pose.rightKnee, pose.rightAnkle);
    drawBone(ctx, assets.left_thigh, PARTS.left_thigh, pose.leftHip, pose.leftKnee);
    drawBone(ctx, assets.left_shin_foot, PARTS.left_shin_foot, pose.leftKnee, pose.leftAnkle);

    const leftKneeAngle = (
      Math.atan2(pose.leftKnee[1] - pose.leftHip[1], pose.leftKnee[0] - pose.leftHip[0]) +
      Math.atan2(pose.leftAnkle[1] - pose.leftKnee[1], pose.leftAnkle[0] - pose.leftKnee[0])
    ) * 0.5 - Math.PI / 2;
    const rightKneeAngle = (
      Math.atan2(pose.rightKnee[1] - pose.rightHip[1], pose.rightKnee[0] - pose.rightHip[0]) +
      Math.atan2(pose.rightAnkle[1] - pose.rightKnee[1], pose.rightAnkle[0] - pose.rightKnee[0])
    ) * 0.5 - Math.PI / 2;
    drawSprite(ctx, assets.right_knee, PARTS.right_knee, pose.rightKnee[0], pose.rightKnee[1], rightKneeAngle);
    drawSprite(ctx, assets.left_knee, PARTS.left_knee, pose.leftKnee[0], pose.leftKnee[1], leftKneeAngle);

    drawSprite(ctx, assets.pelvis, PARTS.pelvis, pose.pelvis[0], pose.pelvis[1], pose.bodyAngle * 0.4);

    // Each shoulder is one uninterrupted source-faithful assembly from its
    // inward torso ring through its elbow. Drawing it behind the body lets the
    // ring tuck beneath the spherical shell; the forearm then covers the only
    // remaining cut at the complete elbow socket.
    drawBone(ctx, assets.right_shoulder, PARTS.right_shoulder, pose.rightShoulder, pose.rightElbow);
    drawBone(ctx, assets.left_shoulder, PARTS.left_shoulder, pose.leftShoulder, pose.leftElbow);
    drawSprite(ctx, assets.body, PARTS.body, pose.body[0], pose.body[1], pose.bodyAngle);

    drawBone(ctx, assets.right_forearm_fist, PARTS.right_forearm_fist, pose.rightElbow, pose.rightWrist);
    drawBone(ctx, assets.left_forearm_fist, PARTS.left_forearm_fist, pose.leftElbow, pose.leftWrist);
    ctx.restore();
  }

  function renderScene(ctx, assets, sim, time, width = WIDTH, height = HEIGHT) {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    drawField(ctx, time, width, height);
    renderCharacter(ctx, assets, sim, time);
    const vignette = ctx.createRadialGradient(width / 2, height * 0.48, width * 0.24, width / 2, height * 0.48, width * 0.78);
    vignette.addColorStop(0, "rgba(10, 14, 9, 0)");
    vignette.addColorStop(1, "rgba(10, 14, 9, .42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const api = { WIDTH, HEIGHT, PARTS, createSimulation, stepSimulation, createPose, renderScene };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Character05Rig = api;
})();

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const canvas = document.querySelector("#field");
    const status = document.querySelector("#status");
    const fallback = document.querySelector("#fallback");
    const rig = window.Character05Rig;
    const assets = {};
    const sim = rig.createSimulation(Math.floor(Date.now() / 1000));
    let lastTime = performance.now();
    let elapsed = 0;
    let ready = false;
    let pendingImages = Object.keys(rig.PARTS).length;
    let loadFailed = false;

    function sizeCanvas() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rig.WIDTH * ratio;
      canvas.height = rig.HEIGHT * ratio;
      canvas.dataset.ratio = ratio;
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
      fallback.textContent = "The Character 5 paper-doll assets could not be loaded.";
    }

    for (const [name, definition] of Object.entries(rig.PARTS)) {
      const image = new Image();
      image.onload = imageLoaded;
      image.onerror = imageFailed;
      image.src = definition.file;
      assets[name] = image;
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
        const names = {
          haul: "HAULING",
          brace: "BRACING",
          slam: "ANCHOR SLAM",
          recover: "RECOVERING"
        };
        status.textContent = names[sim.mode];
      }
      requestAnimationFrame(frame);
    }

    window.addEventListener("resize", sizeCanvas);
    sizeCanvas();
    requestAnimationFrame(frame);
  });
}
