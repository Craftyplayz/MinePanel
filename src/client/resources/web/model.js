"use strict";

// The 3D render tile: the player drawn with WebGL from their own skin, wearing their armor (no enchantment glint) and
// holding what they hold, built the way the game builds its player model (ModelPart cubes, the same texture layout,
// armor deformations and hand transforms). Drag to turn it, scroll to zoom, double-click to reset. With spinning on,
// it turns about the chosen axis; after a drag it waits a moment, then eases back to spinning and back upright.
// Pure maths (matrices, quaternions, the spin and the geometry) comes first so the tests can check it without WebGL.

// --------------------------------------------------------------------------------------------- Matrices

// 4×4 matrices are column-major arrays of 16, as WebGL takes them.
const mat4 = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  multiply(a, b) {
    const out = new Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
        out[column * 4 + row] = sum;
      }
    }
    return out;
  },
  /** The product of every matrix given, left to right (the rightmost applies to a point first). */
  chain: (...matrices) => matrices.reduce((result, matrix) => mat4.multiply(result, matrix)),
  translation: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  scaling: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  rotationX(angle) {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
  },
  rotationY(angle) {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  },
  rotationZ(angle) {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  },
  fromQuaternion([x, y, z, w]) {
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
  },
  transformPoint: (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14]],
  transformDirection: (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z],
  /** The upper 3×3 (rotation and scale), for transforming normals. */
  normalMatrix: m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
};

/** A model part's pose as ModelPart.translateAndRotate applies it: move to the pivot, then rotate Z, Y, X. */
const partPose = ([x, y, z], [rx, ry, rz] = [0, 0, 0]) =>
  mat4.chain(mat4.translation(x, y, z), mat4.rotationZ(rz), mat4.rotationY(ry), mat4.rotationX(rx));

// ------------------------------------------------------------------------------------------ Quaternions

// Quaternions are [x, y, z, w].
const IDENTITY_QUATERNION = [0, 0, 0, 1];
const quat = {
  axisAngle([x, y, z], angle) {
    const s = Math.sin(angle / 2);
    return [x * s, y * s, z * s, Math.cos(angle / 2)];
  },
  multiply: ([ax, ay, az, aw], [bx, by, bz, bw]) => [aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz],
  conjugate: ([x, y, z, w]) => [-x, -y, -z, w],
  normalize(q) {
    const length = Math.hypot(...q);
    return length < 1e-9 ? [...IDENTITY_QUATERNION] : q.map(value => value / length);
  },
  slerp(a, b, t) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    // Take the short way round: q and -q are the same rotation.
    const target = dot < 0 ? b.map(value => -value) : b;
    dot = Math.abs(dot);
    if (dot > 0.9995) return quat.normalize(a.map((value, index) => value + (target[index] - value) * t));
    const angle = Math.acos(dot);
    const [wa, wb] = [Math.sin((1 - t) * angle), Math.sin(t * angle)].map(weight => weight / Math.sin(angle));
    return a.map((value, index) => value * wa + target[index] * wb);
  },
  /** How far from no rotation, in radians. */
  angle: q => 2 * Math.acos(Math.min(1, Math.abs(q[3])))
};

// ---------------------------------------------------------------------------------------------------- Spin

const MODEL_AXES = { y: [0, 1, 0], x: [1, 0, 0], z: [0, 0, 1] };
// Seen from slightly above, as a turntable would be.
const MODEL_TILT = quat.axisAngle([1, 0, 0], 12 * Math.PI / 180);
// The first view is three-quarters on, rather than flat-on.
const MODEL_START_ANGLE = -0.45;
// After a drag: how long it stays where it was left, how long it takes to reach full speed, and how quickly it
// rights itself (the time for most of the remaining tilt to go).
const SPIN_RETURN_DELAY = 0.8;
const SPIN_RAMP_SECONDS = 2;
const SPIN_SETTLE_SECONDS = 0.7;
const MODEL_DRAG_RADIANS_PER_PIXEL = 0.01;
const MODEL_ZOOM_LIMITS = [0.5, 3];

/**
 * The model's orientation is kept as a swing (any tilt away from upright) times a twist (the turn about the spin
 * axis). Spinning advances the twist; settling eases the swing back to none, so the model rights itself without
 * changing which way it faces about the axis.
 */
function createSpin() {
  return { swing: [...IDENTITY_QUATERNION], angle: MODEL_START_ANGLE, wait: 0, ramp: 1, resetting: false };
}

const spinOrientation = (spin, axis) => quat.multiply(spin.swing, quat.axisAngle(MODEL_AXES[axis], spin.angle));

/** Splits an orientation into swing × twist about {@code axis}; the twist is returned as an angle. */
function decompose(orientation, axis) {
  const direction = MODEL_AXES[axis];
  const along = orientation[0] * direction[0] + orientation[1] * direction[1] + orientation[2] * direction[2];
  const twist = quat.normalize([direction[0] * along, direction[1] * along, direction[2] * along, orientation[3]]);
  const angle = 2 * Math.atan2(twist[0] * direction[0] + twist[1] * direction[1] + twist[2] * direction[2], twist[3]);
  return { swing: quat.normalize(quat.multiply(orientation, quat.conjugate(twist))), angle };
}

/** Re-expresses the spin about another axis (after a drag or a settings change) without moving the model. */
function rebaseSpin(spin, orientation, axis) {
  const { swing, angle } = decompose(orientation, axis);
  spin.swing = swing;
  spin.angle = angle;
}

/** Turns the model by a drag of (dx, dy) screen pixels, about the screen's axes. */
function dragSpin(spin, axis, dx, dy) {
  const turn = quat.multiply(quat.axisAngle([0, 1, 0], dx * MODEL_DRAG_RADIANS_PER_PIXEL),
    quat.axisAngle([1, 0, 0], dy * MODEL_DRAG_RADIANS_PER_PIXEL));
  // The drag is on screen, which is tilted; the orientation is the model's own.
  const local = quat.multiply(quat.multiply(quat.conjugate(MODEL_TILT), turn), MODEL_TILT);
  rebaseSpin(spin, quat.normalize(quat.multiply(local, spinOrientation(spin, axis))), axis);
  spin.wait = SPIN_RETURN_DELAY;
  spin.ramp = 0;
  spin.resetting = false;
}

const smoothStep = t => t * t * (3 - 2 * t);

/**
 * Moves the spin on by {@code seconds}. Returns whether anything is still moving (so the caller keeps animating).
 * Without spinning the model stays where it was left, unless a reset is easing it back.
 */
function stepSpin(spin, seconds, { spin: spinning, axis, speed }) {
  if (spin.resetting) {
    const ease = 1 - Math.exp(-seconds / (SPIN_SETTLE_SECONDS / 2));
    spin.swing = quat.slerp(spin.swing, IDENTITY_QUATERNION, ease);
    if (!spinning) spin.angle += (MODEL_START_ANGLE - spin.angle) * ease;
    if (quat.angle(spin.swing) < 1e-3 && (spinning || Math.abs(spin.angle - MODEL_START_ANGLE) < 1e-3)) {
      spin.swing = [...IDENTITY_QUATERNION];
      spin.resetting = false;
    }
    if (!spinning) return spin.resetting;
  }
  if (!spinning) return false;
  if (spin.wait > 0) {
    spin.wait = Math.max(0, spin.wait - seconds);
    return true;
  }
  spin.ramp = Math.min(1, spin.ramp + seconds / SPIN_RAMP_SECONDS);
  const pace = smoothStep(spin.ramp);
  spin.swing = quat.slerp(spin.swing, IDENTITY_QUATERNION, 1 - Math.exp(-seconds * pace / SPIN_SETTLE_SECONDS));
  if (quat.angle(spin.swing) < 1e-4) spin.swing = [...IDENTITY_QUATERNION];
  spin.angle = (spin.angle + speed * Math.PI / 180 * seconds * pace) % (2 * Math.PI);
  return true;
}

// ------------------------------------------------------------------------------------------------ Geometry

/**
 * Appends one box the way ModelPart.Cube builds it: in model pixels (y down, the front facing -z), its texture net
 * starting at (u, v) in a texture of {@code texture} logical pixels, grown by {@code grow} on every side without
 * stretching the texture, and optionally mirrored left to right. Each face is two triangles of
 * position (3), normal (3) and texture coordinates (2).
 */
function addCube(out, [u, v], [x, y, z], [w, h, d], grow, mirror, [textureWidth, textureHeight], transform = null) {
  let [x0, x1] = [x - grow, x + w + grow];
  const [y0, y1, z0, z1] = [y - grow, y + h + grow, z - grow, z + d + grow];
  if (mirror) [x0, x1] = [x1, x0];
  const corner = {
    a: [x0, y0, z0], b: [x1, y0, z0], c: [x1, y1, z0], e: [x0, y1, z0],
    f: [x0, y0, z1], g: [x1, y0, z1], k: [x1, y1, z1], l: [x0, y1, z1]
  };
  const us = [u, u + d, u + d + w, u + d + w + w, u + d + w + d, u + d + w + d + w];
  const vs = [v, v + d, v + d + h];
  // Face corners in the game's order, its texture rectangle (u1, v1, u2, v2) and its outward normal.
  const faces = [
    [["g", "f", "a", "b"], [us[1], vs[0], us[2], vs[1]], [0, -1, 0]],
    [["c", "e", "l", "k"], [us[2], vs[1], us[3], vs[0]], [0, 1, 0]],
    [["a", "f", "l", "e"], [us[0], vs[1], us[1], vs[2]], [-1, 0, 0]],
    [["b", "a", "e", "c"], [us[1], vs[1], us[2], vs[2]], [0, 0, -1]],
    [["g", "b", "c", "k"], [us[2], vs[1], us[4], vs[2]], [1, 0, 0]],
    [["f", "g", "k", "l"], [us[4], vs[1], us[5], vs[2]], [0, 0, 1]]
  ];
  for (const [names, [u1, v1, u2, v2], normal] of faces) {
    const uvs = [[u2, v1], [u1, v1], [u1, v2], [u2, v2]].map(([s, t]) => [s / textureWidth, t / textureHeight]);
    // Mirroring swaps the x faces' sides; their normals follow.
    const facing = mirror ? [-normal[0], normal[1], normal[2]] : normal;
    addQuad(out, names.map(name => corner[name]), uvs, facing, transform);
  }
}

function addQuad(out, corners, uvs, normal, transform) {
  const points = transform ? corners.map(point => mat4.transformPoint(transform, point)) : corners;
  let facing = transform ? mat4.transformDirection(transform, normal) : normal;
  const length = Math.hypot(...facing) || 1;
  facing = facing.map(value => value / length);
  for (const index of [0, 1, 2, 0, 2, 3]) out.push(...points[index], ...facing, ...uvs[index]);
}

// Logical texture sizes: UVs are fractions of these whatever the image's real resolution (HD resource packs).
const SKIN_TEXTURE = [64, 64];
const ARMOR_TEXTURE = [64, 32];
// Pivots of the player model's parts (PlayerModel / HumanoidModel), in model pixels.
const PART_PIVOTS = { head: [0, 0, 0], body: [0, 0, 0], rightArm: [-5, 2, 0], leftArm: [5, 2, 0],
  rightLeg: [-1.9, 12, 0], leftLeg: [1.9, 12, 0] };

const box = (u, v, from, size, grow = 0, mirror = false) => ({ uv: [u, v], from, size, grow, mirror });

/** The skin's cubes per part: the inner layer, then the outer layer (hat, jacket, sleeves, trousers). */
function skinCubes(slim) {
  const arm = slim ? 3 : 4;
  return {
    head: [box(0, 0, [-4, -8, -4], [8, 8, 8]), box(32, 0, [-4, -8, -4], [8, 8, 8], 0.5)],
    body: [box(16, 16, [-4, 0, -2], [8, 12, 4]), box(16, 32, [-4, 0, -2], [8, 12, 4], 0.25)],
    rightArm: [box(40, 16, [slim ? -2 : -3, -2, -2], [arm, 12, 4]), box(40, 32, [slim ? -2 : -3, -2, -2], [arm, 12, 4], 0.25)],
    leftArm: [box(32, 48, [-1, -2, -2], [arm, 12, 4]), box(48, 48, [-1, -2, -2], [arm, 12, 4], 0.25)],
    rightLeg: [box(0, 16, [-2, 0, -2], [4, 12, 4]), box(0, 32, [-2, 0, -2], [4, 12, 4], 0.25)],
    leftLeg: [box(16, 48, [-2, 0, -2], [4, 12, 4]), box(0, 48, [-2, 0, -2], [4, 12, 4], 0.25)]
  };
}

/**
 * Armor cubes per slot and part, as HumanoidModel's armor meshes: outer armor grows by 1 (helmet, chestplate, boots),
 * leggings by 0.5, and legs 0.1 less so boots and leggings don't fight. Left limbs mirror the right limbs' texture.
 */
const ARMOR_CUBES = {
  head: { head: [box(0, 0, [-4, -8, -4], [8, 8, 8], 1), box(32, 0, [-4, -8, -4], [8, 8, 8], 1.5)] },
  chest: { body: [box(16, 16, [-4, 0, -2], [8, 12, 4], 1)], rightArm: [box(40, 16, [-3, -2, -2], [4, 12, 4], 1)],
    leftArm: [box(40, 16, [-1, -2, -2], [4, 12, 4], 1, true)] },
  legs: { body: [box(16, 16, [-4, 0, -2], [8, 12, 4], 0.5)], rightLeg: [box(0, 16, [-2, 0, -2], [4, 12, 4], 0.4)],
    leftLeg: [box(0, 16, [-2, 0, -2], [4, 12, 4], 0.4, true)] },
  feet: { rightLeg: [box(0, 16, [-2, 0, -2], [4, 12, 4], 0.9)], leftLeg: [box(0, 16, [-2, 0, -2], [4, 12, 4], 0.9, true)] }
};

// Elytra wings (ElytraModel, standing pose), 2 pixels behind the body as the wings layer draws them.
const WING_ANGLE = 0.2617994;
const WINGS = [
  { cube: box(22, 0, [-10, 0, 0], [10, 20, 2], 1), pose: partPose([5, 0, 2], [WING_ANGLE, 0, -WING_ANGLE]) },
  { cube: box(22, 0, [0, 0, 0], [10, 20, 2], 1, true), pose: partPose([-5, 0, 2], [WING_ANGLE, 0, WING_ANGLE]) }
];

function cubesMesh(cubes, texture, transform = null) {
  const data = [];
  for (const cube of cubes) addCube(data, cube.uv, cube.from, cube.size, cube.grow, cube.mirror, texture, transform);
  return data;
}

/**
 * The scale of a picture's real pixels: icons are drawn at 64 × 64, so a 16-pixel item sprite comes out as 4 × 4
 * blocks of one colour. Returns how many image pixels make one sprite pixel (1 for a detailed picture).
 */
function pixelFactor(pixels, size) {
  for (let factor = size / 16; factor > 1; factor /= 2) {
    if (!Number.isInteger(factor) || size % factor) continue;
    let uniform = true;
    for (let y = 0; uniform && y < size; y++) {
      for (let x = 0; uniform && x < size; x++) {
        const source = ((y - y % factor) * size + (x - x % factor)) * 4;
        const here = (y * size + x) * 4;
        for (let channel = 0; channel < 4; channel++) {
          if (pixels[here + channel] !== pixels[source + channel]) { uniform = false; break; }
        }
      }
    }
    if (uniform) return factor;
  }
  return 1;
}

/**
 * An item sprite as the game's item model generator builds it: the picture on a 16 × 16 × 1 slab (front and
 * back), plus a one-pixel side wall wherever an opaque pixel borders a clear one. Coordinates are item model pixels
 * (0–16, y up). {@code pixels} is RGBA of a {@code size} × {@code size} image.
 */
function extrudeSprite(pixels, size, transform) {
  const factor = pixelFactor(pixels, size);
  const cells = size / factor;
  const step = 16 / cells;
  const solid = (i, j) => i >= 0 && j >= 0 && i < cells && j < cells
    && pixels[((j * factor) * size + i * factor) * 4 + 3] >= 16;
  const data = [];
  const [front, back] = [8.5, 7.5];
  addQuad(data, [[16, 16, front], [0, 16, front], [0, 0, front], [16, 0, front]], [[1, 0], [0, 0], [0, 1], [1, 1]],
    [0, 0, 1], transform);
  addQuad(data, [[0, 16, back], [16, 16, back], [16, 0, back], [0, 0, back]], [[0, 0], [1, 0], [1, 1], [0, 1]],
    [0, 0, -1], transform);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      if (!solid(i, j)) continue;
      const [x0, x1, top, bottom] = [i * step, (i + 1) * step, 16 - j * step, 16 - (j + 1) * step];
      // Side walls take the colour of the pixel they edge: sample its centre.
      const centre = [(i + 0.5) / cells, (j + 0.5) / cells];
      const uv = [centre, centre, centre, centre];
      if (!solid(i - 1, j)) addQuad(data, [[x0, top, back], [x0, top, front], [x0, bottom, front], [x0, bottom, back]], uv, [-1, 0, 0], transform);
      if (!solid(i + 1, j)) addQuad(data, [[x1, top, front], [x1, top, back], [x1, bottom, back], [x1, bottom, front]], uv, [1, 0, 0], transform);
      if (!solid(i, j - 1)) addQuad(data, [[x0, top, back], [x1, top, back], [x1, top, front], [x0, top, front]], uv, [0, 1, 0], transform);
      if (!solid(i, j + 1)) addQuad(data, [[x0, bottom, front], [x1, bottom, front], [x1, bottom, back], [x0, bottom, back]], uv, [0, -1, 0], transform);
    }
  }
  return data;
}

// Block items' icons are drawings of the block, not sprites, so they are held as a small upright card facing out.
const BLOCK_CARD_POSE = { rotation: [0, 90, 0], translation: [0, 2, 1], scale: [0.55, 0.55, 0.55] };

/**
 * Where an item sits relative to its arm, as ItemInHandLayer places it: from the arm's pivot, turned to point
 * forward, moved to the hand, then the item model's own third-person transform (rotation X, Y, Z in degrees,
 * translation in pixels, scale), centred on its 16-pixel box. Slim arms hold items half a pixel further in.
 */
function heldItemTransform(held, left) {
  const pose = held.flat ? held : { ...BLOCK_CARD_POSE,
    rotation: [BLOCK_CARD_POSE.rotation[0], (left ? -1 : 1) * BLOCK_CARD_POSE.rotation[1], BLOCK_CARD_POSE.rotation[2]] };
  const degrees = Math.PI / 180;
  const [rx, ry, rz] = pose.rotation.map(value => value * degrees);
  return mat4.chain(mat4.rotationX(-Math.PI / 2), mat4.rotationY(Math.PI), mat4.translation(left ? -1 : 1, 2, -10),
    mat4.translation(...pose.translation), mat4.rotationX(rx), mat4.rotationY(ry), mat4.rotationZ(rz),
    mat4.scaling(...pose.scale), mat4.translation(-8, -8, -8));
}

/**
 * The arms' rotations: holding something raises that arm a little (ArmPose.ITEM), and both arms bob slowly as the
 * game's idle animation does. {@code ticks} is game time (20 per second).
 */
function armPoses(appearance, ticks) {
  const bobZ = Math.cos(ticks * 0.09) * 0.05 + 0.05;
  const bobX = Math.sin(ticks * 0.067) * 0.05;
  const raised = held => held ? -Math.PI / 10 : 0;
  return { rightArm: [raised(appearance.rightHand) + bobX, 0, bobZ],
    leftArm: [raised(appearance.leftHand) - bobX, 0, -bobZ] };
}

// ----------------------------------------------------------------------------------------------- The tile

const modelParts = { tile: $("#tile-model"), status: $("#model-status"), settings: $("#model-settings"),
  form: $("#model-form"), spin: $("#model-spin"), axis: $("#model-axis"), speed: $("#model-speed"),
  stage: $("#model-stage"), canvas: $("#model-canvas"), message: $("#model-message") };
const MODEL_FIELD_OF_VIEW = 30 * Math.PI / 180;
// Big enough to hold the model (with wings and a held sword) in any orientation, in model pixels.
const MODEL_RADIUS = 23;
const modelClock = () => typeof performance === "object" ? performance.now() : Date.now();
const SHADER_LIGHTS = [[0.28, 0.72, 0.64], [-0.36, 0.58, -0.73]];

const modelView = { gl: null, program: null, failed: false, spin: createSpin(), zoom: 1, drag: null, frame: null,
  lastTime: null, appearance: null, key: null, meshes: [], textures: new Map(), started: modelClock() };

modelParts.axis.replaceChildren(...MODEL_AXIS_CHOICES.map(axis => optionElement(axis, MODEL_AXIS_LABELS[axis])));
modelParts.speed.replaceChildren(...MODEL_SPEED_CHOICES.map(speed => optionElement(String(speed), `${speed}° a second`)));
stopDrag(modelParts.settings);
modelParts.settings.addEventListener("click", () => setHidden(modelParts.form, !modelParts.form.hidden));
modelParts.spin.addEventListener("change", () => changeSettings("model", { spin: modelParts.spin.checked }));
modelParts.axis.addEventListener("change", () => changeSettings("model", { axis: modelParts.axis.value }));
modelParts.speed.addEventListener("change", () => changeSettings("model", { speed: Number(modelParts.speed.value) }));

const modelSettings = () => displaySettings().model;
// Without motion (the system asks for less), the model holds still unless dragged.
const modelSpins = () => modelSettings().spin && !reducedMotion?.matches;

function renderModelSettings() {
  const settings = modelSettings();
  modelParts.spin.checked = settings.spin;
  modelParts.axis.value = settings.axis;
  modelParts.speed.value = String(settings.speed);
  // A new axis: keep the model where it is and let it settle onto the new spin.
  if (modelView.axis && modelView.axis !== settings.axis) {
    rebaseSpin(modelView.spin, spinOrientation(modelView.spin, modelView.axis), settings.axis);
  }
  modelView.axis = settings.axis;
}

/** The WebGL context and shader, made the first time the tile has something to draw. */
function modelContext() {
  if (modelView.gl || modelView.failed) return modelView.gl;
  const gl = modelParts.canvas.getContext?.("webgl", { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) {
    modelView.failed = true;
    return null;
  }
  const shader = (type, source) => {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  };
  const light = ([x, y, z]) => {
    const length = Math.hypot(x, y, z);
    return `vec3(${x / length}, ${y / length}, ${z / length})`;
  };
  try {
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `
      attribute vec3 a_position; attribute vec3 a_normal; attribute vec2 a_uv;
      uniform mat4 u_model; uniform mat4 u_projection; uniform mat3 u_normal;
      varying vec2 v_uv; varying vec3 v_normal;
      void main() { v_uv = a_uv; v_normal = u_normal * a_normal; gl_Position = u_projection * u_model * vec4(a_position, 1.0); }`));
    // Lit like entities in the game: 40% ambient plus two fixed lights, clamped; cut-out transparency.
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_texture; uniform vec4 u_tint;
      varying vec2 v_uv; varying vec3 v_normal;
      void main() {
        vec4 color = texture2D(u_texture, v_uv) * u_tint;
        if (color.a < 0.1) discard;
        vec3 n = normalize(v_normal);
        float light = min(1.0, 0.4 + 0.6 * (max(0.0, dot(n, ${light(SHADER_LIGHTS[0])})) + max(0.0, dot(n, ${light(SHADER_LIGHTS[1])}))));
        gl_FragColor = vec4(color.rgb * light, 1.0);
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    modelView.program = { program, position: gl.getAttribLocation(program, "a_position"),
      normal: gl.getAttribLocation(program, "a_normal"), uv: gl.getAttribLocation(program, "a_uv"),
      model: gl.getUniformLocation(program, "u_model"), projection: gl.getUniformLocation(program, "u_projection"),
      normalMatrix: gl.getUniformLocation(program, "u_normal"), tint: gl.getUniformLocation(program, "u_tint"),
      texture: gl.getUniformLocation(program, "u_texture") };
  } catch (failure) {
    modelView.failed = true;
    console.warn?.("MinePanel could not set up the 3D render.", failure);
    return null;
  }
  modelView.gl = gl;
  return gl;
}

/** A texture by URL, loaded once; {@code onImage} also gets the image (held items are built from their icons). */
function modelTexture(url, onImage) {
  let entry = modelView.textures.get(url);
  if (!entry) {
    entry = { texture: null, image: null, failed: false, waiting: [], used: true };
    modelView.textures.set(url, entry);
    const image = new Image();
    image.addEventListener("load", () => {
      const gl = modelView.gl;
      if (!gl || modelView.textures.get(url) !== entry) return;
      entry.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      // Pixel art: no smoothing, and no mipmaps (images need not be powers of two).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      entry.image = image;
      for (const callback of entry.waiting.splice(0)) callback(image);
      requestModelFrame();
    });
    image.addEventListener("error", () => {
      entry.failed = true;
      requestModelFrame();
    });
    image.src = url;
  }
  entry.used = true;
  if (onImage) {
    if (entry.image) onImage(entry.image);
    else entry.waiting.push(onImage);
  }
  return entry;
}

/** A plain white texture for a skin that can't be loaded, so the model still shows its shape. */
function fallbackTexture() {
  const gl = modelView.gl;
  if (!modelView.fallback) {
    modelView.fallback = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, modelView.fallback);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([168, 172, 180, 255]));
  }
  return { texture: modelView.fallback, image: null, failed: false };
}

function meshBuffer(data) {
  const gl = modelView.gl;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buffer, count: data.length / 8 };
}

function hexTint(color) {
  if (!color) return [1, 1, 1, 1];
  return [1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255).concat(1);
}

/** Rebuilds what is drawn for a new appearance: skin parts, armor layers in slot order, then held items. */
function buildModel(appearance) {
  const gl = modelView.gl;
  for (const mesh of modelView.meshes) gl.deleteBuffer(mesh.buffer);
  modelView.meshes = [];
  for (const entry of modelView.textures.values()) entry.used = false;
  const add = (part, data, url, tint = [1, 1, 1, 1], skin = false) => {
    if (data.length) modelView.meshes.push({ part, url, tint, skin, ...meshBuffer(data) });
  };
  const skinUrl = appearance.skin ? `/texture/${appearance.skin}.png` : null;
  if (skinUrl) modelTexture(skinUrl);
  for (const [part, cubes] of Object.entries(skinCubes(appearance.slim))) {
    add(part, cubesMesh(cubes, SKIN_TEXTURE), skinUrl, undefined, true);
  }
  for (const layer of appearance.armor) {
    const url = `/texture/${layer.texture}.png`;
    modelTexture(url);
    const tint = hexTint(layer.color);
    if (layer.model === "wings") {
      for (const wing of WINGS) add("body", cubesMesh([wing.cube], ARMOR_TEXTURE, wing.pose), url, tint);
      continue;
    }
    for (const [part, cubes] of Object.entries(ARMOR_CUBES[layer.slot] ?? {})) {
      add(part, cubesMesh(cubes, ARMOR_TEXTURE), url, tint);
    }
  }
  for (const [hand, left] of [["rightHand", false], ["leftHand", true]]) {
    const held = appearance[hand];
    if (!held) continue;
    const url = `/icon/${held.icon}.png`;
    const built = appearance;
    modelTexture(url, image => {
      // The appearance may have changed while the icon loaded.
      if (modelView.appearance !== built || !modelView.gl) return;
      const pixels = iconPixels(image);
      if (!pixels) return;
      add(hand, extrudeSprite(pixels.data, pixels.size, heldItemTransform(held, left)), url);
      requestModelFrame();
    });
  }
  // Textures nothing uses any more (an old skin, armor taken off) are let go.
  for (const [url, entry] of modelView.textures) {
    if (entry.used) continue;
    if (entry.texture) gl.deleteTexture(entry.texture);
    modelView.textures.delete(url);
  }
}

/** An icon's RGBA pixels at its own size (square), read through a 2D canvas. */
function iconPixels(image) {
  const size = image.naturalWidth;
  if (!size || size !== image.naturalHeight || size > 256) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0);
  return { data: context.getImageData(0, 0, size, size).data, size };
}

const appearanceKey = appearance => JSON.stringify(appearance);

function renderModel(player) {
  const appearance = player?.available ? player.appearance : null;
  const showing = Boolean(appearance);
  setHidden(modelParts.message, showing && !modelView.failed);
  if (!showing) {
    writeText(modelParts.status, "Unavailable");
    writeText(modelParts.message, "Join a world to see your player.");
    modelView.appearance = null;
    modelView.key = null;
    clearModel();
    return;
  }
  const gl = modelContext();
  if (!gl) {
    writeText(modelParts.status, "Unavailable");
    writeText(modelParts.message, "This browser can't draw 3D (WebGL is off or unsupported).");
    setHidden(modelParts.message, false);
    return;
  }
  const key = appearanceKey(appearance);
  if (key !== modelView.key) {
    modelView.key = key;
    modelView.appearance = appearance;
    buildModel(appearance);
  }
  updateModelStatus();
  requestModelFrame();
}

function updateModelStatus() {
  const appearance = modelView.appearance;
  if (!appearance) return;
  const skin = appearance.skin ? modelView.textures.get(`/texture/${appearance.skin}.png`) : null;
  writeText(modelParts.status, !appearance.skin || skin?.failed ? "No skin"
    : !skin?.texture ? "Loading" : modelView.drag ? "Turning" : modelSpins() ? "Spinning" : "Still");
}

function clearModel() {
  const gl = modelView.gl;
  if (!gl) return;
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
}

const modelVisible = () => !modelParts.tile.hidden && !document.hidden && modelParts.canvas.clientWidth > 0
  && modelParts.canvas.clientHeight > 0;

function requestModelFrame() {
  if (modelView.frame !== null || !modelView.gl || !modelView.appearance) return;
  if (typeof window.requestAnimationFrame !== "function") {
    drawModel(modelClock());
    return;
  }
  modelView.frame = window.requestAnimationFrame(animateModel);
}

function animateModel(time) {
  modelView.frame = null;
  if (!modelView.appearance || !modelVisible()) {
    modelView.lastTime = null;
    return;
  }
  const seconds = modelView.lastTime === null ? 0 : Math.min(0.1, Math.max(0, (time - modelView.lastTime) / 1000));
  modelView.lastTime = time;
  const settings = modelSettings();
  if (!modelView.drag) stepSpin(modelView.spin, seconds, { ...settings, spin: modelSpins() });
  drawModel(time);
  updateModelStatus();
  // The arms' idle bob keeps the model alive even when it isn't spinning, unless motion is reduced.
  if (!reducedMotion?.matches || modelView.drag || modelView.spin.resetting) {
    modelView.frame = window.requestAnimationFrame(animateModel);
  } else {
    modelView.lastTime = null;
  }
}

function drawModel(time) {
  const gl = modelView.gl;
  const program = modelView.program;
  const appearance = modelView.appearance;
  if (!gl || !appearance) return;
  const canvas = modelParts.canvas;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const [width, height] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) [canvas.width, canvas.height] = [width, height];
  gl.viewport(0, 0, width, height);
  clearModel();
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(program.program);
  gl.uniform1i(program.texture, 0);
  gl.activeTexture(gl.TEXTURE0);

  // Fit the model's sphere to the narrower side, then zoom.
  const aspect = width / height;
  const halfFov = Math.min(MODEL_FIELD_OF_VIEW / 2, Math.atan(Math.tan(MODEL_FIELD_OF_VIEW / 2) * aspect));
  const distance = MODEL_RADIUS / Math.sin(halfFov) / modelView.zoom;
  gl.uniformMatrix4fv(program.projection, false, new Float32Array(mat4.perspective(MODEL_FIELD_OF_VIEW, aspect,
    Math.max(1, distance - MODEL_RADIUS * 2), distance + MODEL_RADIUS * 2)));
  const orientation = quat.multiply(MODEL_TILT, spinOrientation(modelView.spin, modelSettings().axis));
  // Model space is y down and faces -z; the view is y up with the camera on +z. Centre the 32-pixel-tall player.
  const root = mat4.chain(mat4.translation(0, 0, -distance), mat4.fromQuaternion(orientation),
    mat4.scaling(1, -1, -1), mat4.translation(0, -8, 0));
  const ticks = reducedMotion?.matches ? 0 : (time - modelView.started) / 50;
  const arms = armPoses(appearance, ticks);
  const slimShift = appearance.slim ? 0.5 : 0;
  const parts = { head: partPose(PART_PIVOTS.head), body: partPose(PART_PIVOTS.body),
    rightArm: partPose(PART_PIVOTS.rightArm, arms.rightArm), leftArm: partPose(PART_PIVOTS.leftArm, arms.leftArm),
    rightLeg: partPose(PART_PIVOTS.rightLeg), leftLeg: partPose(PART_PIVOTS.leftLeg),
    rightHand: partPose([PART_PIVOTS.rightArm[0] + slimShift, 2, 0], arms.rightArm),
    leftHand: partPose([PART_PIVOTS.leftArm[0] - slimShift, 2, 0], arms.leftArm) };

  for (const mesh of modelView.meshes) {
    let texture = mesh.url ? modelView.textures.get(mesh.url) : null;
    if (mesh.skin && (!mesh.url || texture?.failed)) texture = fallbackTexture();
    if (!texture?.texture) continue;
    const model = mat4.multiply(root, parts[mesh.part]);
    gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    gl.uniformMatrix4fv(program.model, false, new Float32Array(model));
    gl.uniformMatrix3fv(program.normalMatrix, false, new Float32Array(mat4.normalMatrix(model)));
    gl.uniform4fv(program.tint, new Float32Array(mesh.tint));
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    for (const [location, size, offset] of [[program.position, 3, 0], [program.normal, 3, 3], [program.uv, 2, 6]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset * 4);
    }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}

// --------------------------------------------------------------------------------------------- Interaction

modelParts.canvas.addEventListener("pointerdown", event => {
  if (!modelView.appearance || event.button > 0) return;
  event.stopPropagation();
  modelParts.canvas.setPointerCapture?.(event.pointerId);
  modelView.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  modelParts.stage.classList.add("dragging");
  requestModelFrame();
});
modelParts.canvas.addEventListener("pointermove", event => {
  const drag = modelView.drag;
  if (!drag || drag.id !== event.pointerId) return;
  dragSpin(modelView.spin, modelSettings().axis, event.clientX - drag.x, event.clientY - drag.y);
  [drag.x, drag.y] = [event.clientX, event.clientY];
  requestModelFrame();
});
function endModelDrag(event) {
  if (!modelView.drag || modelView.drag.id !== event.pointerId) return;
  modelView.drag = null;
  modelParts.stage.classList.remove("dragging");
  // The return to spinning counts from letting go.
  modelView.spin.wait = SPIN_RETURN_DELAY;
  requestModelFrame();
}
modelParts.canvas.addEventListener("pointerup", endModelDrag);
modelParts.canvas.addEventListener("pointercancel", endModelDrag);
modelParts.canvas.addEventListener("wheel", event => {
  if (!modelView.appearance) return;
  event.preventDefault();
  modelView.zoom = clamp(modelView.zoom * Math.exp(-event.deltaY * 0.0015), ...MODEL_ZOOM_LIMITS);
  requestModelFrame();
}, { passive: false });
modelParts.canvas.addEventListener("dblclick", () => {
  modelView.zoom = 1;
  modelView.spin.resetting = true;
  modelView.spin.wait = 0;
  requestModelFrame();
});

if (typeof ResizeObserver === "function") new ResizeObserver(() => requestModelFrame()).observe(modelParts.canvas);
document.addEventListener?.("visibilitychange", () => requestModelFrame());

featureHooks.render.push(renderModel);
featureHooks.layout.push(() => {
  renderModelSettings();
  renderModel(currentPlayerState);
});
setHidden(modelParts.form, true);
renderModelSettings();
renderModel(currentPlayerState);
