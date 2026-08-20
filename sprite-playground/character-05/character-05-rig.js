/* Character 05: heavyweight paper-doll field walker with two independent chains. */
(() => {
  "use strict";

  const WIDTH = 960;
  const HEIGHT = 620;
  const TAU = Math.PI * 2;

  // Names are image-left/image-right in the concept pose. Nothing is mirrored:
  // the painted wear, joints, fists, feet, and weights stay paired. The v4
  // subtraction pass gives every visible joint one owner; there are no helper
  // sprites that repaint a second shoulder, pelvis, knee, or ankle over it.
  const PARTS = {
    body: { file: "parts/body.png", pivot: [0.5, 0.5], scale: 0.48 },
    // These are the corrected, side-specific concept-grounded shoulders kept
    // intact from torso socket to elbow. They replace the false
    // shoulder -> armRoot -> elbow chain used by the previous pass.
    left_shoulder: { file: "parts/left_shoulder.png", prox: [0.837, 0.39], dist: [0.348, 0.929], widthScale: 1.0 },
    right_shoulder: { file: "parts/right_shoulder.png", prox: [0.143, 0.411], dist: [0.916, 0.872], widthScale: 1.0 },
    left_forearm_fist: { file: "parts/left_forearm_fist.png", prox: [0.51, 0.12], dist: [0.45, 0.86], widthScale: 1.1 },
    right_forearm_fist: { file: "parts/right_forearm_fist.png", prox: [0.48, 0.12], dist: [0.53, 0.86], widthScale: 1.12 },
    left_thigh: { file: "parts/left_thigh.png", prox: [0.7, 0.13], dist: [0.72, 0.84], widthScale: 1.18 },
    right_thigh: { file: "parts/right_thigh.png", prox: [0.16, 0.19], dist: [0.86, 0.85], widthScale: 1.16 },
    // The lower legs come from the clean original shin/foot sprites with the
    // feet removed. The separate feet begin at the real ankle hinge instead
    // of carrying a second calf and ankle collar.
    left_lower_leg: { file: "parts/left_lower_leg.png", prox: [0.502, 0.098], dist: [0.8, 0.976], widthScale: 1.03 },
    right_lower_leg: { file: "parts/right_lower_leg.png", prox: [0.509, 0.087], dist: [0.222, 0.985], widthScale: 1.04 },
    left_foot: { file: "parts/left_foot.png", pivot: [0.753, 0.364], scale: 0.36 },
    right_foot: { file: "parts/right_foot.png", pivot: [0.776, 0.358], scale: 0.37 },
    left_weight: { file: "parts/left_weight.png", pivot: [0.5, 0.82], scale: 0.58 },
    right_weight: { file: "parts/right_weight.png", pivot: [0.5, 0.82], scale: 0.62 }
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
    sim.targetX = mix(360, 600, sim.random());
    sim.targetY = mix(500, 548, sim.random());
    sim.timer = mix(6.5, 9.5, sim.random());
    sim.modeDuration = sim.timer;
  }

  function setMode(sim, mode, duration) {
    sim.mode = mode;
    sim.modeElapsed = 0;
    sim.modeDuration = duration;
    sim.timer = duration;
    if (mode === "slam") sim.didImpact = false;
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
      didImpact: false,
      random,
      weights: {
        left: { x: 250, y: 526, vx: 0, vy: 0, angle: -0.02 },
        right: { x: 710, y: 526, vx: 0, vy: 0, angle: 0.02 }
      }
    };
    chooseTarget(sim);
    return sim;
  }

  function updateWeight(weight, targetX, targetY, dt, side) {
    // The blocks scrape along the field instead of bobbing like pendulums.
    // Horizontal inertia remains independent per side; vertical motion is
    // constrained to the common ground plane.
    const spring = 7.6;
    weight.vx += (targetX - weight.x) * spring * dt;
    const damping = Math.exp(-dt * 5.4);
    weight.vx *= damping;
    weight.x += weight.vx * dt;
    weight.y = mix(weight.y, targetY, 1 - Math.exp(-dt * 18));
    weight.vy = 0;
    const targetAngle = clamp(weight.vx * 0.0018 + side * 0.018, -0.11, 0.11);
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
      if (distance < 5 || sim.timer <= 0) setMode(sim, "brace", 1.1);
    } else if (sim.mode === "brace") {
      if (sim.timer <= 0) {
        setMode(sim, "slam", 0.68);
      }
    } else if (sim.mode === "slam") {
      if (!sim.didImpact && sim.modeElapsed >= 0.18) {
        sim.didImpact = true;
        sim.impactAge = 0;
        sim.weights.left.vx -= 92;
        sim.weights.right.vx += 92;
      }
      if (sim.timer <= 0) setMode(sim, "recover", 1.25);
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
    const spread = mix(282, 340, sim.action) * scale;
    const drag = sim.velocityX * 1.5;
    const leftLag = Math.max(0, Math.sin(sim.stepPhase)) * 15 * (1 - sim.action);
    const rightLag = Math.max(0, -Math.sin(sim.stepPhase)) * 15 * (1 - sim.action);
    updateWeight(sim.weights.left, sim.x - spread - drag + leftLag, sim.y, dt, -1);
    updateWeight(sim.weights.right, sim.x + spread - drag - rightLag, sim.y, dt, 1);
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
    const walk = sim.mode === "haul" ? 1 : Math.max(0, 1 - action * 2.2);
    const slam = sim.mode === "slam"
      ? ease(clamp(sim.modeElapsed / 0.2, 0, 1))
      : sim.mode === "recover"
        ? 1 - ease(sim.modeElapsed / sim.modeDuration)
        : 0;

    // A foot spends most of its cycle planted. Its local x movement cancels
    // the body's travel before a short, low swing phase returns it forward.
    function footCycle(phase) {
      const normalized = ((phase / TAU) % 1 + 1) % 1;
      if (normalized < 0.62) {
        const planted = ease(normalized / 0.62);
        return { x: mix(31, -31, planted), y: 0 };
      }
      const swing = ease((normalized - 0.62) / 0.38);
      return {
        x: mix(-31, 31, swing),
        y: -Math.sin(swing * Math.PI) * 13
      };
    }

    const leftStep = footCycle(sim.stepPhase);
    const rightStep = footCycle(sim.stepPhase + Math.PI);
    const stride = clamp((leftStep.x - rightStep.x) / 62, -1, 1) * walk;
    const impact = sim.impactAge < 1.2 ? Math.exp(-sim.impactAge * 4.2) : 0;
    const shake = impact * Math.sin(time * 58) * 4.2;
    const bob = -Math.abs(Math.sin(sim.stepPhase)) * 3.2 * walk;
    const sway = Math.cos(sim.stepPhase) * 4.5 * walk;

    const leftHip = [mix(-80, -94, action) + sway * 0.5, mix(-157, -143, action) + slam * 17 + bob];
    const rightHip = [mix(84, 98, action) + sway * 0.5, mix(-157, -143, action) + slam * 17 + bob];
    const leftAnkle = [
      mix(-112 + leftStep.x * walk, -146, action),
      leftStep.y * walk
    ];
    const rightAnkle = [
      mix(116 + rightStep.x * walk, 150, action),
      rightStep.y * walk
    ];
    const leftKnee = solveTwoBone(leftHip, leftAnkle, 104, 110, 1);
    const rightKnee = solveTwoBone(rightHip, rightAnkle, 108, 114, -1);

    const body = [sway + shake, mix(-250, -265, action) + slam * 38 + bob + shake];
    const bodyAngle = -0.035 + stride * 0.018 - action * 0.018 + slam * 0.04;

    // The torso painting already owns both shoulder sockets. Derive the limb
    // pivots from those exact painted centers so the upper-arm hubs land under
    // them instead of appearing as a second, offset pair of rings.
    function bodyAttachment(localX, localY) {
      const cosine = Math.cos(bodyAngle);
      const sine = Math.sin(bodyAngle);
      return [
        body[0] + localX * cosine - localY * sine,
        body[1] + localX * sine + localY * cosine
      ];
    }

    const leftShoulder = bodyAttachment(-152, -17);
    const rightShoulder = bodyAttachment(147, -19);
    const leftElbow = [
      mix(-203 - stride * 7, -230, action) + sway,
      mix(-154 + stride * 8, -178, action) + slam * 49 + bob
    ];
    const rightElbow = [
      mix(207 + stride * 7, 234, action) + sway,
      mix(-151 - stride * 8, -175, action) + slam * 49 + bob
    ];
    const leftWrist = [
      mix(-196 - stride * 8, -232, action) + sway,
      mix(-29 + stride * 10, -70, action) + slam * 59 + bob
    ];
    const rightWrist = [
      mix(201 + stride * 8, 238, action) + sway,
      mix(-27 - stride * 10, -68, action) + slam * 59 + bob
    ];

    return {
      action,
      slam,
      stride,
      impact,
      body,
      bodyAngle,
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
      rightWrist,
      leftBootAngle: -0.025 + stride * 0.018,
      rightBootAngle: 0.018 + stride * 0.018
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
    const sourceAngle = Math.atan2(sourceDy, sourceDx);
    const targetAngle = Math.atan2(targetDy, targetDx);
    const widthScale = definition.widthScale || 1;
    ctx.save();
    ctx.translate(from[0], from[1]);
    ctx.rotate(targetAngle);
    ctx.scale(scale, scale * widthScale);
    ctx.rotate(-sourceAngle);
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
    const count = clamp(Math.round(distance / (28 * scale)), 5, 12);
    const sag = clamp(distance * 0.19, 20, 52) + Math.sin(time * 1.5 + side) * 1.4;
    const control = [(start[0] + end[0]) / 2, Math.max(start[1], end[1]) + sag];

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const inverse = 1 - t;
      const x = inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0];
      const y = inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1];
      const tangentX = 2 * inverse * (control[0] - start[0]) + 2 * t * (end[0] - control[0]);
      const tangentY = 2 * inverse * (control[1] - start[1]) + 2 * t * (end[1] - control[1]);
      const angle = Math.atan2(tangentY, tangentX) + (index % 2 ? Math.PI / 2 : 0);
      const radius = 10.5 * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.lineWidth = Math.max(3.5, 6.4 * scale);
      ctx.strokeStyle = "rgba(12, 13, 12, .96)";
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.58, 0, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.9, 3.7 * scale);
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

  function drawContactShadow(ctx, x, y, radiusX, radiusY, alpha = 0.36) {
    ctx.save();
    ctx.translate(x, y + 4);
    ctx.scale(1, radiusY / radiusX);
    const shadow = ctx.createRadialGradient(0, 0, 2, 0, 0, radiusX);
    shadow.addColorStop(0, `rgba(7, 11, 8, ${alpha})`);
    shadow.addColorStop(0.68, `rgba(7, 11, 8, ${alpha * 0.48})`);
    shadow.addColorStop(1, "rgba(7, 11, 8, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, radiusX, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function renderCharacter(ctx, assets, sim, time) {
    const pose = createPose(sim, time);
    const scale = sceneScale(sim.y);
    const originX = sim.x;
    const originY = sim.y;

    ctx.save();
    ctx.translate(originX, originY + 7);
    ctx.scale(1, 0.25);
    const shadow = ctx.createRadialGradient(0, 0, 12, 0, 0, 210 * scale);
    shadow.addColorStop(0, "rgba(8, 12, 8, .4)");
    shadow.addColorStop(0.58, "rgba(8, 12, 8, .2)");
    shadow.addColorStop(1, "rgba(8, 12, 8, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 210 * scale, 0, TAU);
    ctx.fill();
    ctx.restore();

    drawImpact(ctx, sim, scale);

    const leftAnkleWorld = localToWorld(pose.leftAnkle, originX, originY, scale);
    const rightAnkleWorld = localToWorld(pose.rightAnkle, originX, originY, scale);
    drawContactShadow(ctx, leftAnkleWorld[0], originY, 56 * scale, 13 * scale, 0.36);
    drawContactShadow(ctx, rightAnkleWorld[0], originY, 59 * scale, 14 * scale, 0.38);
    drawContactShadow(ctx, sim.weights.left.x, sim.weights.left.y, 78 * scale, 16 * scale, 0.42);
    drawContactShadow(ctx, sim.weights.right.x, sim.weights.right.y, 78 * scale, 16 * scale, 0.42);

    // The two blocks remain side-paired and ground-locked throughout the cycle.
    drawSprite(ctx, assets.left_weight, PARTS.left_weight, sim.weights.left.x, sim.weights.left.y, sim.weights.left.angle, PARTS.left_weight.scale * scale);
    drawSprite(ctx, assets.right_weight, PARTS.right_weight, sim.weights.right.x, sim.weights.right.y, sim.weights.right.angle, PARTS.right_weight.scale * scale);

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    // Lower legs go down first. Each thigh then owns the visible knee face and
    // covers the lower-leg socket; no third knee sprite is painted on top.
    drawBone(ctx, assets.left_lower_leg, PARTS.left_lower_leg, pose.leftKnee, pose.leftAnkle);
    drawBone(ctx, assets.right_lower_leg, PARTS.right_lower_leg, pose.rightKnee, pose.rightAnkle);
    drawBone(ctx, assets.left_thigh, PARTS.left_thigh, pose.leftHip, pose.leftKnee);
    drawBone(ctx, assets.right_thigh, PARTS.right_thigh, pose.rightHip, pose.rightKnee);

    // Forearms tuck under the elbow faces painted into the corrected full
    // shoulder-to-elbow sprites. The body goes last so its socket rings cover
    // the proximal art cleanly.
    drawBone(ctx, assets.left_forearm_fist, PARTS.left_forearm_fist, pose.leftElbow, pose.leftWrist);
    drawBone(ctx, assets.right_forearm_fist, PARTS.right_forearm_fist, pose.rightElbow, pose.rightWrist);
    drawBone(ctx, assets.left_shoulder, PARTS.left_shoulder, pose.leftShoulder, pose.leftElbow);
    drawBone(ctx, assets.right_shoulder, PARTS.right_shoulder, pose.rightShoulder, pose.rightElbow);
    drawSprite(ctx, assets.body, PARTS.body, pose.body[0], pose.body[1], pose.bodyAngle);

    // Feet own the only visible ankle caps and remain nearly level with the
    // field while the lower legs rotate above them.
    drawSprite(ctx, assets.left_foot, PARTS.left_foot, pose.leftAnkle[0], pose.leftAnkle[1], pose.leftBootAngle);
    drawSprite(ctx, assets.right_foot, PARTS.right_foot, pose.rightAnkle[0], pose.rightAnkle[1], pose.rightBootAngle);
    ctx.restore();

    // Chains attach at the outer forearms, not at the fists, and are rendered
    // above the arm/weight layers so the overlapping links remain readable.
    const leftChainLocal = [
      mix(pose.leftElbow[0], pose.leftWrist[0], 0.32) - 16,
      mix(pose.leftElbow[1], pose.leftWrist[1], 0.32)
    ];
    const rightChainLocal = [
      mix(pose.rightElbow[0], pose.rightWrist[0], 0.32) + 16,
      mix(pose.rightElbow[1], pose.rightWrist[1], 0.32)
    ];
    const leftChainStart = localToWorld(leftChainLocal, originX, originY, scale);
    const rightChainStart = localToWorld(rightChainLocal, originX, originY, scale);
    const leftWeightTop = [
      sim.weights.left.x,
      sim.weights.left.y - assets.left_weight.height * PARTS.left_weight.pivot[1] * PARTS.left_weight.scale * scale
    ];
    const rightWeightTop = [
      sim.weights.right.x,
      sim.weights.right.y - assets.right_weight.height * PARTS.right_weight.pivot[1] * PARTS.right_weight.scale * scale
    ];
    drawChain(ctx, leftChainStart, leftWeightTop, scale, time, -1);
    drawChain(ctx, rightChainStart, rightWeightTop, scale, time, 1);
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
