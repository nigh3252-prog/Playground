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

  // Cross-bone thickness multiplier for every fitted limb.
  const LIMB_GIRTH = 1.14;

  // ---------------------------------------------------------------------------
  // Rig geometry. Everything below lives in the character's local space, where
  // the origin is the pelvis root and +y points down toward the floor.
  // ---------------------------------------------------------------------------

  // A planted ankle rests at ANKLE_PLANT; the painted boot hangs FOOT_DROP
  // further, so ROOT_HEIGHT is what puts the soles exactly on the ground line.
  const ANKLE_PLANT = 525;
  const FOOT_DROP = 62;
  const ROOT_HEIGHT = ANKLE_PLANT + FOOT_DROP;

  // Hips are the two black sockets painted into the torso. The stance is wider
  // than the hips so the legs read as a braced tripod instead of two sticks.
  const HIP_LEFT = [-118, 112];
  const HIP_RIGHT = [74, 116];
  const STANCE_LEFT = -160;
  const STANCE_RIGHT = 140;
  // Slightly under the painted bone lengths: the leftover slack is what the
  // solver turns into knee bend, and too much of it bows the legs open.
  const THIGH_LENGTH = 218;
  const SHIN_LENGTH = 200;

  const SHOULDER_LEFT = [-160, -186];
  const SHOULDER_RIGHT = [204, -177];
  // Fixed arm bones. Solving the elbow instead of stretching the art keeps the
  // pistons the same thickness in every pose, including the attack swings.
  const UPPER_LENGTH = 152;
  const FORE_LENGTH = 158;

  // Relaxed carry: the small shafted focus hangs low and open, the heavy
  // chained focus is held closer to the body the way real weight is carried.
  const CARRY_LEFT_WRIST = [-330, 66];
  const CARRY_RIGHT_WRIST = [322, 24];
  const CARRY_LEFT_ANGLE = -Math.PI;
  const CARRY_RIGHT_ANGLE = 0;

  // Gait. CYCLE_DISTANCE is how far the body travels per two steps, so the
  // stance foot can be driven backwards at exactly walking speed: no sliding.
  const GAIT = {
    cycleDistance: 272,
    duty: 0.62,
    lift: 52,
    bob: 16,
    sway: 14,
    roll: 0.035
  };

  const WALK_SPEED = 52;
  const HUNT_SPEED = 68;

  // Attack timelines, in seconds. `impact` is the frame the strike connects.
  const ATTACKS = {
    chime: { duration: 0.92, wind: 0.3, impact: 0.42, settle: 0.6, side: -1, standoff: 168, name: "CHIME" },
    slam: { duration: 1.74, wind: 0.5, impact: 0.74, settle: 1.14, side: 1, standoff: 112, name: "SLAM" }
  };

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const mix = (a, b, amount) => a + (b - a) * amount;
  const mixPoint = (a, b, amount) => [mix(a[0], b[0], amount), mix(a[1], b[1], amount)];
  const ease = value => {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  };
  const easeOut = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3);
  const easeIn = value => Math.pow(clamp(value, 0, 1), 2.4);
  const approach = (current, target, rate, dt) => mix(current, target, 1 - Math.exp(-rate * dt));

  function seededRandom(seed) {
    let state = seed >>> 0 || 0x4f524249;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function scaleAt(y) {
    return clamp(0.292 + (y - 466) * 0.00055, 0.292, 0.342);
  }

  function localToWorld(point, sim) {
    return [
      sim.pose.originX + point[0] * sim.pose.scale,
      sim.pose.originY + point[1] * sim.pose.scale
    ];
  }

  function rotatePoint(x, y, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [x * cosine - y * sine, x * sine + y * cosine];
  }

  function solveTwoBone(root, tip, upperLength, lowerLength, bend) {
    const dx = tip[0] - root[0];
    const dy = tip[1] - root[1];
    const rawDistance = Math.hypot(dx, dy);
    const distance = clamp(rawDistance, Math.abs(upperLength - lowerLength) + 0.01, upperLength + lowerLength - 0.01);
    const baseAngle = Math.atan2(dy, dx);
    const cosine = clamp(
      (distance * distance + upperLength * upperLength - lowerLength * lowerLength) /
      (2 * distance * upperLength),
      -1,
      1
    );
    const jointAngle = baseAngle + bend * Math.acos(cosine);
    return [
      root[0] + Math.cos(jointAngle) * upperLength,
      root[1] + Math.sin(jointAngle) * upperLength
    ];
  }

  // Pulls a target inside the arm's reach so the elbow never snaps straight.
  function reachable(root, target, maxLength) {
    const dx = target[0] - root[0];
    const dy = target[1] - root[1];
    const distance = Math.hypot(dx, dy);
    if (distance <= maxLength) return [target[0], target[1]];
    const factor = maxLength / distance;
    return [root[0] + dx * factor, root[1] + dy * factor];
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  function createSimulation(seed = 404) {
    const sim = {
      x: 478,
      y: 512,
      targetX: 478,
      targetY: 512,
      mode: "wander",
      label: "DRIFTING",
      modeElapsed: 0,
      timer: 5,
      clock: 0,
      speed: 0,
      heading: 1,
      lean: 0,
      stepPhase: 0,
      walkBlend: 0,
      landing: 0,
      resonance: 0,
      pulseClock: 0,
      hitStop: 0,
      shake: 0,
      shakeAngle: 0,
      charge: 0,
      ring: 0,
      effects: [],
      mote: null,
      queue: [],
      attack: null,
      trail: [],
      trailStamp: 0,
      swing: { left: 0, leftVel: 0, right: 0, rightVel: 0 },
      headLag: { x: 0, vx: 0, angle: 0, vAngle: 0 },
      random: seededRandom(seed),
      pose: null
    };
    chooseWanderTarget(sim);
    buildPose(sim);
    return sim;
  }

  function chooseWanderTarget(sim) {
    // Both weapons are wide. These bounds keep their full silhouettes on the
    // field even during the arms-out resonance pose.
    sim.targetX = mix(360, 604, sim.random());
    sim.targetY = mix(470, 552, sim.random());
  }

  function setMode(sim, mode, duration, label) {
    sim.mode = mode;
    sim.modeElapsed = 0;
    sim.timer = duration;
    if (label) sim.label = label;
  }

  // Motes hover above the floor: the shafted focus rings them out of the air,
  // the chained one drives them down into it.
  function summonMote(sim, x, y) {
    const clampedX = clamp(x === undefined ? mix(220, 740, sim.random()) : x, 190, 780);
    const hover = mix(128, 196, sim.random());
    const centerY = y === undefined ? mix(470, 552, sim.random()) - hover : y;
    const footY = clamp(centerY + hover, 466, 556);
    sim.mote = {
      x: clampedX,
      y: clamp(centerY, 300, footY - 60),
      footY,
      born: 0,
      hits: 0,
      alive: true,
      drift: sim.random() * TAU
    };
    startHunt(sim);
    return sim.mote;
  }

  function startHunt(sim) {
    if (!sim.mote) return;
    // A pair reads as intent: ring the target, then bring the chain down on it.
    sim.queue = sim.random() < 0.42 ? ["chime", "slam"] : [sim.random() < 0.55 ? "chime" : "slam"];
    setMode(sim, "hunt", 5, "MARKING");
  }

  function huntStandoff(sim) {
    const attack = ATTACKS[sim.queue[0]] || ATTACKS.chime;
    // The rig never mirrors, so it walks to the side that puts the target in
    // front of the correct hand: the shafted focus left, the chained one right.
    return [
      clamp(sim.mote.x - attack.side * attack.standoff, 150, 810),
      clamp(sim.mote.footY, 462, 556)
    ];
  }

  function beginAttack(sim, name) {
    const definition = ATTACKS[name];
    if (!definition) return;
    const scale = scaleAt(sim.y);
    const originY = sim.y - ROOT_HEIGHT * scale;
    const mote = sim.mote && sim.mote.alive ? sim.mote : null;
    sim.attack = {
      name,
      t: 0,
      definition,
      landed: false,
      // Local-space aim point, so the swing is built around the real target.
      target: mote ? [(mote.x - sim.x) / scale, (mote.y - originY) / scale] : null
    };
    setMode(sim, "attack", definition.duration, definition.name);
  }

  function spawn(sim, effect) {
    effect.age = 0;
    sim.effects.push(effect);
    if (sim.effects.length > 220) sim.effects.splice(0, sim.effects.length - 220);
  }

  function spawnDust(sim, x, y, count, power) {
    for (let index = 0; index < count; index += 1) {
      const direction = sim.random() < 0.5 ? -1 : 1;
      const speed = mix(28, 96, sim.random()) * power;
      spawn(sim, {
        kind: "dust",
        x: x + mix(-6, 6, sim.random()),
        y,
        vx: direction * speed,
        vy: -mix(6, 34, sim.random()) * power,
        gravity: 46,
        drag: 1.7,
        radius: mix(3, 9, sim.random()) * power,
        life: mix(0.42, 0.86, sim.random())
      });
    }
  }

  function spawnSparks(sim, x, y, count, power, tint) {
    for (let index = 0; index < count; index += 1) {
      const angle = sim.random() * TAU;
      const speed = mix(90, 330, sim.random()) * power;
      spawn(sim, {
        kind: "spark",
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.68 - 40 * power,
        gravity: 260,
        drag: 1.2,
        tint: tint || "202, 139, 255",
        life: mix(0.24, 0.58, sim.random())
      });
    }
  }

  function landChime(sim) {
    const mote = sim.mote;
    const point = localToWorld(chimeContactLocal(sim), sim);
    const x = mote && mote.alive ? mote.x : point[0];
    const y = mote && mote.alive ? mote.y : point[1];
    spawn(sim, { kind: "slash", x, y, life: 0.26, angle: 1.15, radius: 96 });
    spawn(sim, { kind: "burst", x, y, life: 0.46, radius: 150, width: 3.4 });
    spawn(sim, { kind: "burst", x, y, life: 0.34, radius: 76, width: 6, delay: 0.05 });
    spawnSparks(sim, x, y, 20, 0.9);
    sim.hitStop = 0.055;
    sim.ring = 1;
    sim.shake = Math.max(sim.shake, 5.5);
    sim.shakeAngle = sim.random() * TAU;
    hitMote(sim, 1);
  }

  function landSlam(sim) {
    const point = localToWorld(slamContactLocal(sim), sim);
    const groundY = sim.y + 6;
    const x = point[0];
    spawn(sim, { kind: "shock", x, y: groundY, life: 0.72, radius: 224 });
    spawn(sim, { kind: "shock", x, y: groundY, life: 0.5, radius: 128, delay: 0.06 });
    spawn(sim, { kind: "crack", x, y: groundY, life: 1.5, seed: sim.random() * TAU });
    spawn(sim, { kind: "burst", x, y: point[1], life: 0.44, radius: 96, width: 5 });
    spawnDust(sim, x, groundY, 22, 1.15);
    spawnSparks(sim, x, point[1], 26, 1.15);
    sim.hitStop = 0.1;
    sim.ring = 1;
    sim.shake = Math.max(sim.shake, 15);
    sim.shakeAngle = sim.random() * TAU;
    if (sim.mote && sim.mote.alive && Math.abs(sim.mote.x - x) < 220) {
      sim.mote.y = groundY - 24;
      hitMote(sim, 2);
    }
  }

  function hitMote(sim, power) {
    const mote = sim.mote;
    if (!mote || !mote.alive) return;
    mote.hits += power;
    if (mote.hits < 2 && sim.queue.length) {
      spawnSparks(sim, mote.x, mote.y, 10, 0.7, "255, 224, 160");
      return;
    }
    mote.alive = false;
    for (let index = 0; index < 12; index += 1) {
      const angle = sim.random() * TAU;
      const speed = mix(70, 240, sim.random());
      spawn(sim, {
        kind: "shard",
        x: mote.x,
        y: mote.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7 - 60,
        gravity: 210,
        drag: 1.1,
        spin: mix(-9, 9, sim.random()),
        size: mix(5, 13, sim.random()),
        life: mix(0.5, 0.95, sim.random())
      });
    }
    spawn(sim, { kind: "burst", x: mote.x, y: mote.y, life: 0.6, radius: 168, width: 2.4 });
  }

  function stepEffects(sim, dt) {
    for (const effect of sim.effects) {
      effect.age += dt;
      if (effect.vx !== undefined) {
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        if (effect.gravity) effect.vy += effect.gravity * dt;
        if (effect.drag) {
          const damping = Math.exp(-effect.drag * dt);
          effect.vx *= damping;
          effect.vy *= damping;
        }
      }
      if (effect.spin) effect.rotation = (effect.rotation || 0) + effect.spin * dt;
    }
    if (sim.effects.length) {
      sim.effects = sim.effects.filter(effect => effect.age < effect.life + (effect.delay || 0));
    }
  }

  // Walks toward a point and drives the gait phase off actual distance covered.
  function locomote(sim, targetX, targetY, speed, dt) {
    const dx = targetX - sim.x;
    const dy = targetY - sim.y;
    const distance = Math.hypot(dx, dy);
    const slow = clamp(distance / 40, 0.32, 1);
    const travel = Math.min(distance, speed * slow * dt);
    if (distance > 0.001 && travel > 0) {
      sim.x += dx / distance * travel;
      sim.y += dy / distance * travel;
      if (Math.abs(dx) > 6) sim.heading = dx > 0 ? 1 : -1;
    }
    sim.speed = dt > 0 ? travel / dt : 0;
    const localTravel = travel / scaleAt(sim.y);
    advanceGait(sim, localTravel);
    sim.walkBlend = approach(sim.walkBlend, clamp(sim.speed / (speed * 0.55), 0, 1), 9, dt);
    return distance < 12;
  }

  function settle(sim, dt) {
    sim.speed = approach(sim.speed, 0, 9, dt);
    sim.walkBlend = approach(sim.walkBlend, 0, 7, dt);
    // Ease the cycle to the nearest double-support pose instead of freezing
    // mid-stride, which is what made the old stop look like a puppet drop.
    const wrapped = sim.stepPhase - Math.floor(sim.stepPhase);
    const goal = wrapped < 0.25 || wrapped > 0.75 ? Math.round(sim.stepPhase) : Math.floor(sim.stepPhase) + 0.5;
    sim.stepPhase = approach(sim.stepPhase, goal, 6, dt);
  }

  function advanceGait(sim, localTravel) {
    const previous = sim.stepPhase;
    sim.stepPhase += localTravel / GAIT.cycleDistance;
    // A plant happens twice per cycle; the landing impulse is what gives the
    // step weight instead of the old float.
    const crossings = Math.floor(sim.stepPhase * 2) - Math.floor(previous * 2);
    for (let index = 0; index < crossings; index += 1) {
      sim.landing = Math.min(1, sim.landing + 0.9);
      if (sim.pose) {
        const foot = (Math.floor(previous * 2) + 1 + index) % 2 === 0 ? sim.pose.leftAnkle : sim.pose.rightAnkle;
        const world = localToWorld([foot[0], ANKLE_PLANT + FOOT_DROP], sim);
        spawnDust(sim, world[0], Math.min(world[1], sim.y + 6), 2, 0.42);
      }
    }
  }

  function stepSimulation(sim, dt) {
    dt = clamp(dt, 0, 0.05);
    if (sim.hitStop > 0) {
      sim.hitStop -= dt;
      dt *= 0.14;
    }
    sim.clock += dt;
    sim.timer -= dt;
    sim.modeElapsed += dt;
    stepEffects(sim, dt);

    if (sim.mote) {
      sim.mote.born += dt;
      if (!sim.mote.alive && sim.mote.born > 24) sim.mote = null;
    }

    if (sim.mode === "wander") {
      const arrived = locomote(sim, sim.targetX, sim.targetY, WALK_SPEED, dt);
      if (arrived || sim.timer <= 0) {
        if (sim.random() < 0.55) summonMote(sim);
        else setMode(sim, "tune", 1.5, "LISTENING");
      }
    } else if (sim.mode === "hunt") {
      const standoff = huntStandoff(sim);
      const arrived = locomote(sim, standoff[0], standoff[1], HUNT_SPEED, dt);
      sim.charge = approach(sim.charge, 0.45, 2.4, dt);
      if (arrived || sim.timer <= 0) {
        settle(sim, dt);
        beginAttack(sim, sim.queue.shift() || "chime");
      }
    } else if (sim.mode === "attack") {
      settle(sim, dt);
      const attack = sim.attack;
      attack.t += dt;
      if (!attack.landed && attack.t >= attack.definition.impact) {
        attack.landed = true;
        if (attack.name === "chime") landChime(sim);
        else landSlam(sim);
      }
      if (attack.t >= attack.definition.duration) {
        sim.attack = null;
        sim.charge = 0;
        if (sim.queue.length && sim.mote && sim.mote.alive) {
          setMode(sim, "hunt", 5, "MARKING");
        } else if (sim.random() < 0.4) {
          setMode(sim, "tune", 1.3, "LISTENING");
        } else {
          chooseWanderTarget(sim);
          setMode(sim, "wander", 6.4, "DRIFTING");
        }
      }
    } else if (sim.mode === "tune") {
      settle(sim, dt);
      if (sim.timer <= 0) {
        setMode(sim, "resonate", 2.35, "RESONATING");
        sim.pulseClock = 0;
      }
    } else {
      settle(sim, dt);
      sim.pulseClock += dt;
      // One clean wave off the fork at the peak of the hold.
      if (!sim.wavePulsed && sim.modeElapsed > 1.15) {
        sim.wavePulsed = true;
        const fork = localToWorld([0, -600], sim);
        spawn(sim, { kind: "burst", x: fork[0], y: fork[1], life: 0.9, radius: 260, width: 2 });
        spawn(sim, { kind: "shock", x: sim.x, y: sim.y + 6, life: 0.9, radius: 268 });
        sim.shake = Math.max(sim.shake, 5);
      }
      if (sim.timer <= 0) {
        sim.wavePulsed = false;
        chooseWanderTarget(sim);
        setMode(sim, "wander", 6.4, "DRIFTING");
      }
    }

    if (sim.mode !== "resonate") sim.wavePulsed = false;
    if (sim.mode !== "hunt" && sim.mode !== "attack") sim.charge = approach(sim.charge, 0, 3.2, dt);

    sim.landing = approach(sim.landing, 0, 9, dt);
    // Every connected strike leaves the fork head ringing for a moment.
    sim.ring = approach(sim.ring, 0, 3.1, dt);
    sim.shake = approach(sim.shake, 0, 8.5, dt);
    const resonanceTarget = sim.mode === "resonate" ? 1 : sim.mode === "tune" ? 0.3 : 0;
    sim.resonance = mix(sim.resonance, resonanceTarget, 1 - Math.exp(-dt * 4.8));
    const leanTarget = clamp(sim.speed / WALK_SPEED, 0, 1.3) * sim.heading * 0.055;
    sim.lean = approach(sim.lean, leanTarget, 6, dt);

    buildPose(sim, dt);
  }

  // ---------------------------------------------------------------------------
  // Pose
  // ---------------------------------------------------------------------------

  // One foot's position inside the gait cycle. During stance the foot slides
  // backwards at exactly the body's travel rate, so the boots never skate.
  function footTrack(phase, blend) {
    const p = phase - Math.floor(phase);
    const amplitude = GAIT.duty * GAIT.cycleDistance * 0.5;
    if (p < GAIT.duty) {
      const u = p / GAIT.duty;
      return { x: mix(amplitude, -amplitude, u) * blend, lift: 0, planted: 1 };
    }
    const u = (p - GAIT.duty) / (1 - GAIT.duty);
    const swing = ease(u);
    // Quick pick-up, slower reach: the lift peaks early in the swing.
    const arc = Math.sin(Math.pow(u, 0.78) * Math.PI);
    return {
      x: mix(-amplitude, amplitude, swing) * blend,
      lift: arc * GAIT.lift * blend,
      planted: 0
    };
  }

  // Snaps a springed value onto its target while keeping the velocity honest,
  // so handing control back to the spring does not pop.
  function drive(state, key, velocityKey, target, dt) {
    state[velocityKey] = (target - state[key]) / Math.max(dt, 1e-4);
    state[key] = target;
  }

  function spring(state, key, velocityKey, target, stiffness, damping, dt) {
    const acceleration = (target - state[key]) * stiffness - state[velocityKey] * damping;
    state[velocityKey] += acceleration * dt;
    state[key] += state[velocityKey] * dt;
  }

  // Where the swinging focus should end up, in local space. Attacks aim at the
  // marked mote when there is one so the arc actually goes through the target.
  function chimeContactLocal(sim) {
    const aim = sim.attack && sim.attack.target;
    return aim ? [clamp(aim[0], -690, -300), clamp(aim[1], -180, 330)] : [-540, 214];
  }

  function slamContactLocal(sim) {
    const aim = sim.attack && sim.attack.target;
    return aim ? [clamp(aim[0], 250, 640), clamp(aim[1], 90, 420)] : [352, 352];
  }

  // Given where the ring has to be and how the shaft is rotated, this is the
  // hand that puts it there.
  function wristForRing(name, ringPoint, angle) {
    const offset = rotatePoint(...FOCUS_ANIMATIONS[name].ringCenter, angle);
    return [ringPoint[0] - offset[0], ringPoint[1] - offset[1]];
  }

  // Attack poses are written as a focus angle plus the ring's contact point,
  // then layered over the walk pose. Every strike gets anticipation, a fast
  // active frame, and a heavy recovery so each focus carries its own weight.
  function applyChime(pose, sim, attack) {
    const definition = attack.definition;
    const t = attack.t;
    // Angles run negative through the swing so the ring travels up, over, and
    // down through the mark instead of taking the long way around the hand.
    const windAngle = -1.18;
    const contactAngle = -3.2;
    const followAngle = -4.05;
    const contact = wristForRing("left_focus", chimeContactLocal(sim), contactAngle);
    const raised = wristForRing("left_focus", [-296, -338], windAngle);
    const follow = mixPoint(contact, [-322, -6], 0.6);
    let wrist;
    let angle;
    let torso = 0;
    let root = 0;
    let lunge = 0;

    if (t < definition.wind) {
      // Snaps the ring up behind the cowl and holds it there for a beat.
      const u = easeOut(clamp(t / (definition.wind * 0.72), 0, 1));
      wrist = mixPoint(CARRY_LEFT_WRIST, raised, u);
      angle = mix(CARRY_LEFT_ANGLE, windAngle, u);
      torso = 0.07 * u;
      root = -8 * u;
      lunge = 16 * u;
      pose.charge = Math.max(pose.charge, u);
    } else if (t < definition.impact) {
      // The whip: accelerating into the mark, no easing on the way out.
      const u = easeIn(clamp((t - definition.wind) / (definition.impact - definition.wind), 0, 1));
      wrist = mixPoint(raised, contact, u);
      angle = mix(windAngle, contactAngle, u);
      torso = mix(0.07, -0.05, u);
      root = mix(-8, 10, u);
      lunge = mix(16, -30, u);
      pose.charge = Math.max(pose.charge, 1);
    } else if (t < definition.settle) {
      const u = easeOut(clamp((t - definition.impact) / (definition.settle - definition.impact), 0, 1));
      wrist = mixPoint(contact, follow, u);
      angle = mix(contactAngle, followAngle, u);
      torso = -0.05;
      root = mix(10, 16, u);
      lunge = -30;
    } else {
      const u = ease(clamp((t - definition.settle) / (definition.duration - definition.settle), 0, 1));
      wrist = mixPoint(follow, CARRY_LEFT_WRIST, u);
      angle = mix(followAngle, CARRY_LEFT_ANGLE, u);
      torso = mix(-0.05, 0, u);
      root = mix(16, 0, u);
      lunge = mix(-30, 0, u);
    }

    pose.leftWrist = wrist;
    pose.leftFocusAngle = angle;
    pose.torsoAngle += torso;
    pose.rootY += root;
    pose.lunge = lunge;
    pose.leftArmFront = 1;
    // The off hand counterweights the swing.
    pose.rightWrist = mixPoint(pose.rightWrist, [344, -46], 0.4 * Math.sin(clamp(t / definition.duration, 0, 1) * Math.PI));
  }

  function applySlam(pose, sim, attack) {
    const definition = attack.definition;
    const t = attack.t;
    const windAngle = -1.34;
    const contactAngle = 1.62;
    const contact = wristForRing("right_focus", slamContactLocal(sim), contactAngle);
    // The short chain keeps the ring close to the hand, so the arm itself has
    // to go overhead to get the head of the weapon up.
    const raised = [268, -462];
    let wrist;
    let angle;
    let torso = 0;
    let root = 0;
    let crouch = 0;
    let lunge = 0;

    if (t < definition.wind) {
      // Hauls the chain overhead and sits into the back leg. The hold at the
      // top is the whole reason the drop reads as heavy.
      const u = easeOut(clamp(t / (definition.wind * 0.78), 0, 1));
      wrist = mixPoint(CARRY_RIGHT_WRIST, raised, u);
      angle = mix(CARRY_RIGHT_ANGLE, windAngle, u);
      torso = -0.09 * u;
      root = -18 * u;
      crouch = 0.3 * u;
      lunge = -26 * u;
      pose.charge = Math.max(pose.charge, u);
      pose.rightArmFront = u > 0.3 ? 1 : 0;
    } else if (t < definition.impact) {
      const u = easeIn(clamp((t - definition.wind) / (definition.impact - definition.wind), 0, 1));
      wrist = mixPoint(raised, contact, u);
      angle = mix(windAngle, contactAngle, u);
      torso = mix(-0.09, 0.1, u);
      root = mix(-18, 54, u);
      crouch = mix(0.3, 1, u);
      lunge = mix(-26, 34, u);
      pose.charge = Math.max(pose.charge, 1);
      pose.rightArmFront = 1;
    } else if (t < definition.settle) {
      // Sticks the landing: the ring stays down while the body absorbs it.
      const u = clamp((t - definition.impact) / (definition.settle - definition.impact), 0, 1);
      const rebound = Math.sin(u * Math.PI) * 0.18;
      wrist = [contact[0], contact[1] - 26 * rebound];
      angle = contactAngle - 0.12 * rebound;
      torso = 0.1 - 0.02 * rebound;
      root = 54 - 22 * rebound;
      crouch = 1;
      lunge = 34;
      pose.rightArmFront = 1;
    } else {
      const u = ease(clamp((t - definition.settle) / (definition.duration - definition.settle), 0, 1));
      wrist = mixPoint(contact, CARRY_RIGHT_WRIST, u);
      angle = mix(contactAngle, CARRY_RIGHT_ANGLE, u);
      torso = mix(0.1, 0, u);
      root = mix(54, 0, u);
      crouch = mix(1, 0, u);
      lunge = mix(34, 0, u);
      pose.rightArmFront = u < 0.55 ? 1 : 0;
    }

    pose.rightWrist = wrist;
    pose.rightFocusAngle = angle;
    pose.torsoAngle += torso;
    pose.rootY += root;
    pose.crouch = crouch;
    pose.lunge = lunge;
    // The free hand swings out for balance across the whole action.
    pose.leftWrist = mixPoint(pose.leftWrist, [-386, -110], 0.45 * Math.sin(clamp(t / definition.duration, 0, 1) * Math.PI));
  }

  function buildPose(sim, dt = 0.016) {
    const previous = sim.pose;
    const scale = scaleAt(sim.y);
    const energy = ease(sim.resonance);
    const blend = sim.walkBlend;
    const phase = sim.stepPhase;
    const cycle = (phase - Math.floor(phase)) * TAU;

    const pose = previous || {};
    pose.scale = scale;
    pose.energy = energy;
    pose.charge = sim.charge;
    pose.crouch = 0;
    pose.lunge = 0;
    pose.leftArmFront = 0;
    pose.rightArmFront = 0;

    // Body rides highest at mid-stance and drops onto each plant.
    const bob = -(1 + Math.cos(cycle * 2)) * 0.5 * GAIT.bob * blend;
    const sway = Math.sin(cycle) * GAIT.sway * blend;
    const landingDip = ease(sim.landing) * 9;
    pose.rootX = sway;
    pose.rootY = bob + landingDip;
    pose.torsoAngle = Math.sin(cycle) * GAIT.roll * blend + sim.lean * 0.5 + Math.sin(sim.clock * 1.15) * 0.004;

    const leftTrack = footTrack(phase, blend);
    const rightTrack = footTrack(phase + 0.5, blend);
    pose.leftAnkle = [STANCE_LEFT + leftTrack.x - sway, ANKLE_PLANT - leftTrack.lift - pose.rootY];
    pose.rightAnkle = [STANCE_RIGHT + rightTrack.x - sway, ANKLE_PLANT - rightTrack.lift - pose.rootY];

    // Arms counter-swing against the legs and keep a low, loaded carry.
    const armSwing = Math.sin(cycle) * blend;
    pose.leftWrist = [
      CARRY_LEFT_WRIST[0] - armSwing * 22,
      CARRY_LEFT_WRIST[1] - armSwing * 26 - Math.sin(cycle * 2) * 6 * blend
    ];
    pose.rightWrist = [
      CARRY_RIGHT_WRIST[0] + armSwing * 18,
      CARRY_RIGHT_WRIST[1] + armSwing * 22 - Math.sin(cycle * 2) * 5 * blend
    ];
    pose.leftFocusAngle = CARRY_LEFT_ANGLE + Math.sin(sim.clock * 1.9) * 0.03;
    pose.rightFocusAngle = CARRY_RIGHT_ANGLE + Math.sin(sim.clock * 1.5 + 0.6) * 0.028;

    // The listen and resonance hold: both focuses raised, arms opened out.
    if (energy > 0.001) {
      pose.leftWrist = mixPoint(pose.leftWrist, [-372, -196], energy);
      pose.rightWrist = mixPoint(pose.rightWrist, [366, -196], energy);
      pose.leftFocusAngle -= energy * 0.16;
      pose.rightFocusAngle += energy * 0.11;
    }

    if (sim.mode === "hunt" && sim.charge > 0.01) {
      // Carries the marked weapon a little forward while closing in.
      const attack = ATTACKS[sim.queue[0]] || ATTACKS.chime;
      const lead = sim.charge * 0.6;
      if (attack.side < 0) pose.leftWrist = mixPoint(pose.leftWrist, [-368, -22], lead);
      else pose.rightWrist = mixPoint(pose.rightWrist, [352, -46], lead);
    }

    if (sim.attack) {
      if (sim.attack.name === "chime") applyChime(pose, sim, sim.attack);
      else applySlam(pose, sim, sim.attack);
    }

    if (pose.crouch > 0) {
      // Sinking the root alone would just shrink the legs; widening the stance
      // is what makes the drop read as bracing against the ground.
      pose.leftAnkle[0] -= 26 * pose.crouch;
      pose.rightAnkle[0] += 22 * pose.crouch;
    }

    if (pose.lunge) {
      // The body commits over planted boots instead of sliding the whole rig.
      pose.rootX += pose.lunge;
      pose.leftAnkle[0] -= pose.lunge;
      pose.rightAnkle[0] -= pose.lunge;
    }

    pose.originX = sim.x + pose.rootX * scale;
    pose.originY = sim.y - ROOT_HEIGHT * scale + pose.rootY * scale;

    // Springs: the heavy focuses lag the hands and the fork head trails the
    // body. This is where most of the character's weight actually comes from.
    const swingState = sim.swing;
    const striking = sim.attack ? sim.attack.name : null;
    // The swinging focus is driven by the strike itself: springing it would
    // leave the ring trailing behind its own contact frame. The idle hand
    // keeps its lag, which is what makes the weapons feel heavy at rest.
    if (striking === "chime") drive(swingState, "left", "leftVel", pose.leftFocusAngle, dt);
    else spring(swingState, "left", "leftVel", pose.leftFocusAngle, 210, 19, dt);
    if (striking === "slam") drive(swingState, "right", "rightVel", pose.rightFocusAngle, dt);
    else spring(swingState, "right", "rightVel", pose.rightFocusAngle, 120, 15, dt);
    pose.leftFocusAngle = swingState.left;
    pose.rightFocusAngle = swingState.right;

    const headTarget = -pose.torsoAngle * 140 - sim.lean * 90;
    spring(sim.headLag, "x", "vx", headTarget, 150, 16, dt);
    spring(sim.headLag, "angle", "vAngle", pose.torsoAngle * 0.55 + sim.lean * 0.1, 130, 15, dt);
    pose.headOffset = sim.headLag.x * 0.16;
    pose.headAngle = sim.headLag.angle;

    // Motion ghosts of the focus that is actually swinging. Nothing sells the
    // speed of a paper-doll strike like a couple of trailing copies.
    for (const ghost of sim.trail) ghost.age += dt;
    sim.trail = sim.trail.filter(ghost => ghost.age < 0.16);
    if (sim.attack) {
      const definition = sim.attack.definition;
      const swinging = sim.attack.t > definition.wind && sim.attack.t < definition.settle;
      if (swinging && sim.clock - sim.trailStamp > 0.022) {
        sim.trailStamp = sim.clock;
        const isChime = sim.attack.name === "chime";
        sim.trail.push({
          part: isChime ? "left_focus" : "right_focus",
          x: isChime ? pose.leftWrist[0] : pose.rightWrist[0],
          y: isChime ? pose.leftWrist[1] : pose.rightWrist[1],
          angle: isChime ? pose.leftFocusAngle : pose.rightFocusAngle,
          age: 0
        });
        if (sim.trail.length > 6) sim.trail.shift();
      }
    }

    sim.pose = pose;
    return pose;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

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

  // Limbs are fitted along the bone. The cross-bone axis is scaled separately
  // so shortening a bone does not also whittle the painted part down: at
  // LIMB_GIRTH the pistons and legs keep the weight the source art gives them.
  function drawSegment(ctx, atlas, name, from, to, opacity = 1, girth = LIMB_GIRTH) {
    const part = PARTS[name];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const sourceDx = part.dist[0] - part.prox[0];
    const sourceDy = part.dist[1] - part.prox[1];
    const targetLength = Math.hypot(dx, dy);
    const sourceLength = Math.hypot(sourceDx, sourceDy);
    const sourceAngle = Math.atan2(sourceDy, sourceDx);
    const scale = targetLength / sourceLength;
    const [sx, sy, sw, sh] = part.crop;
    ctx.save();
    ctx.translate(from[0], from[1]);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.scale(scale, scale * girth);
    ctx.rotate(-sourceAngle);
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

  function drawMote(ctx, sim, time) {
    const mote = sim.mote;
    if (!mote || !mote.alive) return;
    const appear = ease(clamp(mote.born / 0.45, 0, 1));
    const pulse = 1 + Math.sin(time * 5.4 + mote.drift) * 0.09;
    const hover = Math.sin(time * 1.8 + mote.drift) * 5;
    ctx.save();
    ctx.translate(mote.x, mote.y + hover);
    ctx.globalAlpha = appear;

    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 46 * pulse);
    halo.addColorStop(0, "rgba(214, 160, 255, .5)");
    halo.addColorStop(1, "rgba(150, 90, 220, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 46 * pulse, 0, TAU);
    ctx.fill();

    ctx.rotate(time * 1.25);
    ctx.strokeStyle = "rgba(226, 190, 255, .85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2;
      const radius = index % 2 === 0 ? 15 * pulse : 9 * pulse;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = "rgba(196, 138, 255, .55)";
    ctx.fill();

    ctx.rotate(-time * 2.1);
    ctx.setLineDash([4, 12]);
    ctx.strokeStyle = `rgba(214, 175, 255, ${0.4 + 0.25 * Math.sin(time * 6)})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 30 * pulse, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawGroundEffects(ctx, sim) {
    for (const effect of sim.effects) {
      const age = effect.age - (effect.delay || 0);
      if (age < 0) continue;
      const life = clamp(age / effect.life, 0, 1);
      if (effect.kind === "shock") {
        const radius = easeOut(life) * effect.radius;
        ctx.save();
        ctx.translate(effect.x, effect.y);
        ctx.scale(1, 0.26);
        ctx.strokeStyle = `rgba(214, 168, 255, ${(1 - life) * 0.6})`;
        ctx.lineWidth = 3 + (1 - life) * 7;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(radius, 1), 0, TAU);
        ctx.stroke();
        ctx.restore();
      } else if (effect.kind === "crack") {
        ctx.save();
        ctx.translate(effect.x, effect.y);
        ctx.scale(1, 0.28);
        ctx.strokeStyle = `rgba(198, 140, 255, ${(1 - life) * 0.5})`;
        ctx.lineWidth = 2.4;
        for (let index = 0; index < 7; index += 1) {
          const angle = effect.seed + index * (TAU / 7);
          const length = (46 + (index % 3) * 26) * easeOut(clamp(life * 3, 0, 1));
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 8, Math.sin(angle) * 8);
          ctx.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
          ctx.stroke();
        }
        ctx.restore();
      } else if (effect.kind === "dust") {
        ctx.save();
        ctx.globalAlpha = (1 - life) * 0.4;
        ctx.fillStyle = "rgba(186, 197, 205, .8)";
        ctx.beginPath();
        ctx.ellipse(effect.x, effect.y, effect.radius * (1 + life * 1.5), effect.radius * (0.5 + life), 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function drawAirEffects(ctx, sim) {
    for (const effect of sim.effects) {
      const age = effect.age - (effect.delay || 0);
      if (age < 0) continue;
      const life = clamp(age / effect.life, 0, 1);
      if (effect.kind === "burst") {
        const radius = easeOut(life) * effect.radius;
        ctx.strokeStyle = `rgba(226, 178, 255, ${(1 - life) * 0.7})`;
        ctx.lineWidth = (effect.width || 3) * (1 - life * 0.6);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(radius, 1), 0, TAU);
        ctx.stroke();
      } else if (effect.kind === "slash") {
        ctx.save();
        ctx.translate(effect.x, effect.y);
        ctx.rotate(effect.angle);
        ctx.strokeStyle = `rgba(240, 214, 255, ${(1 - life) * 0.85})`;
        ctx.lineWidth = 12 * (1 - life);
        ctx.beginPath();
        ctx.arc(0, 0, effect.radius * (0.7 + life * 0.5), -1.15, 1.15);
        ctx.stroke();
        ctx.restore();
      } else if (effect.kind === "spark") {
        ctx.strokeStyle = `rgba(${effect.tint}, ${(1 - life) * 0.9})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(effect.x, effect.y);
        ctx.lineTo(effect.x - effect.vx * 0.02, effect.y - effect.vy * 0.02);
        ctx.stroke();
      } else if (effect.kind === "shard") {
        ctx.save();
        ctx.translate(effect.x, effect.y);
        ctx.rotate(effect.rotation || 0);
        ctx.fillStyle = `rgba(214, 168, 255, ${(1 - life) * 0.9})`;
        ctx.beginPath();
        ctx.moveTo(0, -effect.size);
        ctx.lineTo(effect.size * 0.5, 0);
        ctx.lineTo(0, effect.size);
        ctx.lineTo(-effect.size * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  function renderCharacter(ctx, assets, sim, time) {
    const atlas = assets.atlas || assets;
    const pose = sim.pose || buildPose(sim);
    const scale = pose.scale;
    const energy = pose.energy;
    const originX = pose.originX;
    const originY = pose.originY;

    const leftWrist = reachable(SHOULDER_LEFT, pose.leftWrist, UPPER_LENGTH + FORE_LENGTH - 2);
    const rightWrist = reachable(SHOULDER_RIGHT, pose.rightWrist, UPPER_LENGTH + FORE_LENGTH - 2);
    const leftElbow = solveTwoBone(SHOULDER_LEFT, leftWrist, UPPER_LENGTH, FORE_LENGTH, 1);
    const rightElbow = solveTwoBone(SHOULDER_RIGHT, rightWrist, UPPER_LENGTH, FORE_LENGTH, -1);

    const leftRingOffset = rotatePoint(...FOCUS_ANIMATIONS.left_focus.ringCenter, pose.leftFocusAngle);
    const rightRingOffset = rotatePoint(...FOCUS_ANIMATIONS.right_focus.ringCenter, pose.rightFocusAngle);
    const leftRingWorld = [
      originX + (leftWrist[0] + leftRingOffset[0]) * scale,
      originY + (leftWrist[1] + leftRingOffset[1]) * scale
    ];
    const rightRingWorld = [
      originX + (rightWrist[0] + rightRingOffset[0]) * scale,
      originY + (rightWrist[1] + rightRingOffset[1]) * scale
    ];
    const forkWorld = [originX, originY - 600 * scale];

    drawRune(ctx, sim.x, sim.y + 7, time, energy);
    drawResonance(ctx, forkWorld, sim.pulseClock + sim.clock, Math.max(energy, sim.ring * 0.5), 0);
    drawResonance(ctx, leftRingWorld, sim.pulseClock, energy, 0.17);
    drawResonance(ctx, rightRingWorld, sim.pulseClock, energy, 0.33);

    // Contact shadow tightens as the body drops, which sells the landings.
    const shadowSquash = 1 - clamp(pose.rootY, 0, 46) / 150;
    ctx.save();
    ctx.translate(sim.x, sim.y + 8);
    ctx.scale(1, 0.28);
    const shadowRadius = 174 * scale / 0.31 * shadowSquash;
    const shadow = ctx.createRadialGradient(0, 0, 8, 0, 0, shadowRadius);
    shadow.addColorStop(0, `rgba(0, 0, 0, ${0.36 + (1 - shadowSquash) * 0.5})`);
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, shadowRadius, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    const drawRightArm = () => {
      ctx.save();
      const glow = Math.max(energy, sim.attack && sim.attack.name === "slam" ? pose.charge : 0);
      if (glow > 0.03) {
        ctx.shadowColor = `rgba(170, 76, 255, ${0.85 * glow})`;
        ctx.shadowBlur = 34 * glow;
      }
      drawAnimatedFocus(ctx, assets, "right_focus", rightWrist[0], rightWrist[1], pose.rightFocusAngle, time);
      ctx.restore();
      drawSegment(ctx, atlas, "right_fore", rightElbow, rightWrist);
      drawSegment(ctx, atlas, "right_upper", SHOULDER_RIGHT, rightElbow);
    };

    const drawLeftArm = () => {
      ctx.save();
      const glow = Math.max(energy, sim.attack && sim.attack.name === "chime" ? pose.charge : 0);
      if (glow > 0.03) {
        ctx.shadowColor = `rgba(180, 83, 255, ${0.8 * glow})`;
        ctx.shadowBlur = 28 * glow;
      }
      drawAnimatedFocus(ctx, assets, "left_focus", leftWrist[0], leftWrist[1], pose.leftFocusAngle, time);
      ctx.restore();
      drawSegment(ctx, atlas, "left_fore", leftElbow, leftWrist);
    };

    if (sim.trail.length) {
      ctx.save();
      for (const ghost of sim.trail) {
        const fade = 1 - ghost.age / 0.16;
        ctx.globalAlpha = fade * fade * 0.24;
        drawAnimatedFocus(ctx, assets, ghost.part, ghost.x, ghost.y, ghost.angle, time);
      }
      ctx.restore();
    }

    // Back arm first: the large chained focus normally sits behind the coat.
    if (!pose.rightArmFront) drawRightArm();

    // Legs. Each hip point matches a socket painted into the torso, and each
    // leg gets its own two-bone solve with the knee bowed outward.
    const leftKnee = solveTwoBone(HIP_LEFT, pose.leftAnkle, THIGH_LENGTH, SHIN_LENGTH, 1);
    const rightKnee = solveTwoBone(HIP_RIGHT, pose.rightAnkle, THIGH_LENGTH, SHIN_LENGTH, -1);
    const kneeAngle = (hip, knee, ankle) => (
      Math.atan2(knee[1] - hip[1], knee[0] - hip[0]) +
      Math.atan2(ankle[1] - knee[1], ankle[0] - knee[0])
    ) * 0.5 - Math.PI / 2;

    drawSegment(ctx, atlas, "right_thigh", HIP_RIGHT, rightKnee);
    drawSegment(ctx, atlas, "right_shin", rightKnee, pose.rightAnkle);
    drawSegment(ctx, atlas, "left_thigh", HIP_LEFT, leftKnee);
    drawSegment(ctx, atlas, "left_shin", leftKnee, pose.leftAnkle);
    drawPart(ctx, atlas, "right_knee", rightKnee[0], rightKnee[1], kneeAngle(HIP_RIGHT, rightKnee, pose.rightAnkle), undefined, 1, 0.78);
    drawPart(ctx, atlas, "left_knee", leftKnee[0], leftKnee[1], kneeAngle(HIP_LEFT, leftKnee, pose.leftAnkle), undefined, 1, 0.78);

    // The image-left shoulder is under the cowl; its forearm and unique small
    // shafted focus are deliberately drawn in front after the torso.
    drawSegment(ctx, atlas, "left_upper", SHOULDER_LEFT, leftElbow);
    drawPart(ctx, atlas, "torso", 0, 0, pose.torsoAngle);

    if (pose.rightArmFront) drawRightArm();
    drawLeftArm();

    const ringing = Math.max(energy, sim.ring * 0.85);
    const headShake = ringing * Math.sin(time * 64) * 4.2;
    const headX = pose.headOffset + headShake;
    if (ringing > 0.08) {
      drawPart(ctx, atlas, "head", headX - 7 * ringing, -284, pose.headAngle - 0.006, undefined, 0.12 * ringing);
      drawPart(ctx, atlas, "head", headX + 7 * ringing, -284, pose.headAngle + 0.006, undefined, 0.12 * ringing);
    }
    drawPart(ctx, atlas, "head", headX, -284, pose.headAngle);
    ctx.restore();
  }

  function renderScene(ctx, assets, sim, time, width = WIDTH, height = HEIGHT) {
    if (!sim.pose) buildPose(sim);
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    drawField(ctx, time, width, height);

    // Impact shake moves the subject and its debris, not the horizon.
    const shakeX = Math.cos(sim.shakeAngle + time * 51) * sim.shake;
    const shakeY = Math.sin(sim.shakeAngle + time * 43) * sim.shake * 0.6;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawGroundEffects(ctx, sim);
    drawMote(ctx, sim, time);
    renderCharacter(ctx, assets, sim, time);
    drawAirEffects(ctx, sim);
    ctx.restore();

    const vignette = ctx.createRadialGradient(width / 2, height * 0.48, width * 0.24, width / 2, height * 0.48, width * 0.72);
    vignette.addColorStop(0, "rgba(3, 7, 10, 0)");
    vignette.addColorStop(1, "rgba(3, 7, 10, .42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  const api = {
    WIDTH,
    HEIGHT,
    PARTS,
    FOCUS_ANIMATIONS,
    ATTACKS,
    createSimulation,
    stepSimulation,
    renderScene,
    summonMote
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.Character04Rig = api;
})();

if (typeof document !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const canvas = document.querySelector("#field");
    const status = document.querySelector("#status");
    const fallback = document.querySelector("#fallback");
    const rig = window.Character04Rig;
    if (!canvas || !rig) return;
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
        if (status) status.textContent = sim.label;
      }
      requestAnimationFrame(frame);
    }

    function imageLoaded() {
      pendingImages -= 1;
      if (pendingImages === 0 && !loadFailed) {
        ready = true;
        if (fallback) fallback.hidden = true;
      }
    }

    function imageFailed() {
      loadFailed = true;
      if (!fallback) return;
      fallback.hidden = false;
      fallback.textContent = "The character animation assets could not be loaded.";
    }

    // The page still has no playback controls. Pointing at the field only
    // marks a target for the character to walk to and strike on its own.
    canvas.addEventListener("pointerdown", event => {
      if (!ready) return;
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width * rig.WIDTH;
      const y = (event.clientY - bounds.top) / bounds.height * rig.HEIGHT;
      rig.summonMote(sim, x, y);
    });

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
