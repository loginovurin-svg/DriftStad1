/**
 * boot.ts — «Дрифт-Лаб»: демо физического движка автосимулятора (задний привод, ручник,
 * шины по Пачеке). Сцена: кольцевая трасса, камера преследования, следы от шин и дым
 * при скольжении, очки за дрифт, звук двигателя/шин — всё синтезируется, без ассетов.
 *
 * Контракт с React-оболочкой (src/pages/Home.tsx):
 *   startGame(canvas) — монтирует рендерер и цикл; stopGame() — полный демонтаж.
 */
import * as THREE from "three";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { CarPhysics, CAR } from "./physics";
import type { CarControls } from "./physics";
import { INPUT_CONFIG } from "./config";
import { Track } from "./track";
import { CarAudio } from "./sfx";
import { GameStateMachine } from "./state";
import { storage } from "./storage";
import { initDebugUI } from "./debug-ui";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
  }
}

const BEST_KEY = "driftBest";

const $ = (id: string) => document.getElementById(id) as HTMLElement | null;
function setText(id: string, v: string | number): void {
  const el = $(id);
  const s = String(v);
  if (el && el.textContent !== s) el.textContent = s;
}
function show(id: string, visible: boolean): void {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !visible);
}

let session: { dispose: () => void } | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  const disposeDebugUI = initDebugUI();

  // ---------- рендерер / сцена ----------
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb8dd);
  scene.fog = new THREE.Fog(0x8fb8dd, 130, 800);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a5d3a, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
  sun.position.set(40, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 260;
  scene.add(sun);
  scene.add(sun.target);

  const track = new Track();
  const { disposables } = track.build(scene);

  // ---------- машина (визуал, low-poly из примитивов) ----------
  const carRoot = new THREE.Group();
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = CAR.cgHeight;
  carRoot.add(bodyGroup);
  const carPaint = new THREE.MeshStandardMaterial({ color: 0xd9481f, roughness: 0.45, metalness: 0.25 });
  const carDark = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.3, metalness: 0.4 });
  const carParts: Array<{ mesh: THREE.Mesh; baseY: number }> = [];
  function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y - CAR.cgHeight, z);
    m.castShadow = true;
    bodyGroup.add(m);
    carParts.push({ mesh: m, baseY: y });
    disposables.push(geo);
    return m;
  }
  part(new THREE.BoxGeometry(1.78, 0.5, 4.15), carPaint, 0, 0.56, 0); // кузов
  part(new THREE.BoxGeometry(1.6, 0.46, 1.85), carDark, 0, 1.02, 0.18); // салон/стёкла
  part(new THREE.BoxGeometry(1.62, 0.07, 0.42), carPaint, 0, 1.12, 1.92); // крыло
  part(new THREE.BoxGeometry(0.09, 0.2, 0.09), carDark, 0.55, 1.0, 1.92);
  part(new THREE.BoxGeometry(0.09, 0.2, 0.09), carDark, -0.55, 1.0, 1.92);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6cc, emissive: 0xfff2b0, emissiveIntensity: 0.9 });
  part(new THREE.BoxGeometry(0.34, 0.1, 0.06), headMat, 0.58, 0.62, -2.09);
  part(new THREE.BoxGeometry(0.34, 0.1, 0.06), headMat, -0.58, 0.62, -2.09);
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff2211, emissiveIntensity: 0.2 });
  part(new THREE.BoxGeometry(1.5, 0.13, 0.06), brakeMat, 0, 0.72, 2.09);
  disposables.push(carPaint, carDark, headMat, brakeMat);

  const wheels: Array<{ pivot: THREE.Group; spin: THREE.Mesh }> = [];
  const wheelRadiusAtBuild = CAR.wheelRadius;
  const wheelGeo = new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.26, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.9 });
  disposables.push(wheelGeo, wheelMat);
  for (const [lx, lz] of [
    [-CAR.trackHalf, CAR.axleFront],
    [CAR.trackHalf, CAR.axleFront],
    [-CAR.trackHalf, CAR.axleRear],
    [CAR.trackHalf, CAR.axleRear],
  ] as Array<[number, number]>) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, CAR.wheelRadius, lz);
    const spin = new THREE.Mesh(wheelGeo, wheelMat);
    spin.castShadow = true;
    pivot.add(spin);
    carRoot.add(pivot);
    wheels.push({ pivot, spin });
  }
  scene.add(carRoot);

  // ---------- следы от шин (пул) ----------
  const SKID_MAX = 150;
  const skidGeo = new THREE.PlaneGeometry(0.3, 0.6);
  skidGeo.rotateX(-Math.PI / 2);
  const skids: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number }> = [];
  let skidHead = 0;
  for (let i = 0; i < SKID_MAX; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x101216, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(skidGeo, mat);
    mesh.visible = false;
    mesh.position.y = 0.012 + (i % 16) * 0.0005; // против z-fighting
    scene.add(mesh);
    skids.push({ mesh, mat, age: 99 });
  }
  disposables.push(skidGeo);

  function dropSkid(x: number, z: number, heading: number, strength: number): void {
    const s = skids[skidHead];
    skidHead = (skidHead + 1) % SKID_MAX;
    s.mesh.position.x = x;
    s.mesh.position.z = z;
    s.mesh.rotation.y = heading + Math.PI / 2;
    s.age = 0;
    s.mat.opacity = 0.28 + strength * 0.3;
    s.mesh.visible = true;
  }

  // ---------- дым (спрайты, пул) ----------
  const smokeTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, "rgba(230,230,235,0.55)");
    grad.addColorStop(1, "rgba(230,230,235,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const SMOKE_MAX = 70;
  const smokes: Array<{ spr: THREE.Sprite; age: number; life: number; grow: number }> = [];
  let smokeHead = 0;
  for (let i = 0; i < SMOKE_MAX; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0 });
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    scene.add(spr);
    smokes.push({ spr, age: 99, life: 1, grow: 1 });
  }
  disposables.push(smokeTex);

  function puffSmoke(x: number, z: number, intensity: number): void {
    const s = smokes[smokeHead];
    smokeHead = (smokeHead + 1) % SMOKE_MAX;
    s.spr.position.set(x, 0.35, z);
    s.spr.scale.setScalar(1.2 + intensity);
    (s.spr.material as THREE.SpriteMaterial).opacity = 0.32;
    s.spr.visible = true;
    s.age = 0;
    s.life = 0.9 + intensity * 0.4;
    s.grow = 2.2 + intensity * 2;
  }

  // ---------- физика / ввод / звук / состояния ----------
  const physics = new CarPhysics();
  const spawn = track.getSpawn();
  physics.reset(spawn.x, spawn.z, spawn.yaw);
  const input = new Input(canvas);
  const audio = new CarAudio();
  const fsm = new GameStateMachine();
  const groundOut = { height: 0, grip: 1, roll: 0.014, dragMul: 1, lat: 0, nx: 0, nz: 0, cx: 0, cz: 0 };

  let best = storage.get<number>(BEST_KEY, 0);
  let score = 0;
  let driftTime = 0;

  let camMode = 0; // 0 — погоня, 1 — капот
  let camYawOff = 0;
  let shake = 0;
  let titleAngle = 0;
  let skidTimer = 0;
  let smokeTimer = 0;

  // автопонижение качества при слабом GPU
  let fpsFrames = 0;
  let fpsTime = 0;
  let degradeStep = 0;

  function saveBest(): void {
    if (score > best) {
      best = Math.floor(score);
      storage.set(BEST_KEY, best);
    }
  }

  function respawn(): void {
    const p = track.respawnPoint(physics.x, physics.z);
    physics.reset(p.x, p.z, p.yaw);
    shake = 0;
  }

  function begin(): void {
    if (!fsm.is("title")) return;
    audio.start();
    fsm.transition("playing");
    show("title-screen", false);
    show("hud", true);
  }

  function toTitle(): void {
    saveBest();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    score = 0;
    driftTime = 0;
    respawn();
    fsm.transition("title");
    show("pause-screen", false);
    show("hud", false);
    show("title-screen", true);
    setText("best-val-title", best);
    audio.setState(0, 0, 0, false);
  }

  function pause(): void {
    if (!fsm.is("playing")) return;
    saveBest();
    fsm.transition("paused");
    show("pause-screen", true);
    audio.setState(0, 0, 0, false);
  }

  function resume(): void {
    if (!fsm.is("paused")) return;
    fsm.transition("playing");
    show("pause-screen", false);
  }

  // ---------- кнопки ----------
  const onStart = () => {
    if (INPUT_CONFIG.STEERING_MODE === "mouse" && document.pointerLockElement !== canvas) {
      requestMouseLock();
    }
    begin();
    ($("start-btn") as HTMLButtonElement | null)?.blur();
  };
  const onResume = () => {
    if (INPUT_CONFIG.STEERING_MODE === "mouse" && document.pointerLockElement !== canvas) {
      requestMouseLock();
    }
    resume();
    ($("resume-btn") as HTMLButtonElement | null)?.blur();
  };
  const onMenu = () => {
    toTitle();
    ($("menu-btn") as HTMLButtonElement | null)?.blur();
  };
  const onMute = () => {
    audio.start();
    const muted = audio.toggleMute();
    setText("mute-btn", muted ? "Звук: выкл" : "Звук: вкл");
    ($("mute-btn") as HTMLButtonElement | null)?.blur();
  };
  $("start-btn")?.addEventListener("click", onStart);
  $("resume-btn")?.addEventListener("click", onResume);
  $("menu-btn")?.addEventListener("click", onMenu);
  $("mute-btn")?.addEventListener("click", onMute);

  const steeringButtonIds = ["steering-mode-btn", "steering-mode-hud"];
  const mouseLockButtonIds = ["mouse-lock-btn", "mouse-lock-hud"];
  const updateSteeringButtons = () => {
    const mode = INPUT_CONFIG.STEERING_MODE;
    const locked = document.pointerLockElement === canvas;
    const label = mode === "keyboard" ? "Руль: клавиатура" : "Руль: мышь";
    for (const id of steeringButtonIds) setText(id, label);
    for (const id of mouseLockButtonIds) show(id, mode === "mouse" && !locked);
  };
  const requestMouseLock = () => {
    try {
      const lockRequest = canvas.requestPointerLock();
      if (lockRequest && typeof lockRequest.catch === "function") {
        void lockRequest.catch(() => updateSteeringButtons());
      }
    } catch {
      updateSteeringButtons();
    }
  };
  const onSteeringModeClick = () => {
    if (INPUT_CONFIG.STEERING_MODE === "keyboard") {
      input.setSteeringMode("mouse");
      document.dispatchEvent(new Event("driftlab:save-settings"));
      requestMouseLock();
    } else {
      input.setSteeringMode("keyboard");
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      document.dispatchEvent(new Event("driftlab:save-settings"));
    }
    updateSteeringButtons();
  };
  const onMouseLockClick = () => requestMouseLock();
  const onSteeringModeChange = () => {
    if (INPUT_CONFIG.STEERING_MODE === "keyboard" && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
    updateSteeringButtons();
  };
  for (const id of steeringButtonIds) {
    $(id)?.addEventListener("click", onSteeringModeClick);
  }
  for (const id of mouseLockButtonIds) {
    $(id)?.addEventListener("click", onMouseLockClick);
  }
  document.addEventListener("pointerlockchange", updateSteeringButtons);
  window.addEventListener("driftlab:steering-mode", onSteeringModeChange);
  updateSteeringButtons();

  // Space не должен прокручивать страницу/нажимать кнопку после клика
  const onKeyGuard = (e: KeyboardEvent) => {
    if (e.code === "Space" && e.target === document.body) e.preventDefault();
  };
  window.addEventListener("keydown", onKeyGuard);

  setText("best-val-title", best);
  setText("mute-btn", audio.muted ? "Звук: выкл" : "Звук: вкл");

  // ---------- игровой цикл ----------
  const controls: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };

  const loop = new GameLoop({
    update: (dt) => {
      if (fsm.is("title")) {
        titleAngle += dt * 0.3;
        if (input.consumeAction("Space") || input.consumeAction("Enter")) begin();
      } else if (fsm.is("playing")) {
        if (input.consumeAction("Escape")) {
          pause();
          return;
        }
        input.update(dt);
        if (input.consumeAction("KeyR")) respawn();
        if (input.consumeAction("KeyC")) camMode = (camMode + 1) % 2;
        if (input.consumeAction("KeyM")) onMute();
        if (input.consumeAction("ShiftLeft") || input.consumeAction("KeyE")) physics.shiftUp();
        if (input.consumeAction("ControlLeft") || input.consumeAction("KeyQ")) physics.shiftDown();

        controls.throttle = Math.max(0, input.moveZ);
        controls.brake = Math.max(0, -input.moveZ);
        controls.steer = input.moveX;
        controls.handbrake = input.isHeld("Space");

        physics.update(dt, controls, (x, z, out) => track.query(x, z, out), groundOut);

        if (physics.lastImpact > 2) {
          shake = Math.min(0.5, physics.lastImpact * 0.045);
        }

        // очки за дрифт
        const slipDeg = Math.abs(physics.slipAngle) * 57.3;
        if (physics.drifting) {
          driftTime += dt;
          const mult = 1 + Math.min(4, driftTime * 0.8);
          score += mult * (slipDeg / 30) * physics.speed * 6 * dt;
        } else {
          driftTime = Math.max(0, driftTime - dt * 2.5);
        }

        // следы и дым от задних колёс
        skidTimer -= dt;
        const slipping = controls.handbrake || physics.drifting || (controls.throttle > 0.7 && physics.speed < 12 && physics.rpm > 3000);
        if (slipping && physics.speed > 3 && skidTimer <= 0) {
          skidTimer = 0.028;
          const sin = Math.sin(physics.yaw);
          const cos = Math.cos(physics.yaw);
          for (const i of [2, 3]) {
            const lx = i === 2 ? -CAR.trackHalf : CAR.trackHalf;
            const wx = physics.x + lx * cos + CAR.axleRear * sin;
            const wz = physics.z - lx * sin + CAR.axleRear * cos;
            const str = Math.min(1, slipDeg / 45 + (controls.handbrake ? 0.4 : 0));
            dropSkid(wx, wz, physics.yaw, str);
            if (physics.drifting && slipDeg > 25 && Math.random() < 0.55) puffSmoke(wx, wz, Math.min(1, slipDeg / 50));
          }
        }

        audio.setState(
          (physics.rpm - CAR.idleRpm) / (CAR.maxRpm - CAR.idleRpm),
          controls.throttle,
          physics.drifting ? Math.min(1, Math.abs(physics.slipAngle) / 0.6) : 0,
          true,
        );
      } else if (fsm.is("paused")) {
        if (input.consumeAction("Escape")) resume();
      }

      // орбита камеры мышью (преследование)
      const look = input.consumeLook();
      camYawOff = Math.max(-1.4, Math.min(1.4, camYawOff + look.yaw));

      // мгновенные действия живут ровно один тик: несъеденные нажатия (Space ручника,
      // KeyR с паузы и т.п.) не должны «доживать» до другого состояния игры
      input.actions.clear();
    },

    render: (_alpha, dt) => {
      // синхронизация визуала с физикой
      carRoot.position.set(physics.x, 0, physics.z);
      carRoot.rotation.y = physics.yaw;
      bodyGroup.rotation.z = physics.roll;
      bodyGroup.rotation.x = physics.pitch;
      carRoot.position.y = physics.y - CAR.cgHeight;
      bodyGroup.position.y = CAR.cgHeight;
      for (const part of carParts) part.mesh.position.y = part.baseY - CAR.cgHeight;
      const wheelRadiusScale = CAR.wheelRadius / wheelRadiusAtBuild;
      for (let i = 0; i < 4; i++) {
        const lx = i % 2 === 0 ? -CAR.trackHalf : CAR.trackHalf;
        const lz = i < 2 ? CAR.axleFront : CAR.axleRear;
        const side = i % 2 === 0 ? -1 : 1;
        const toeDeg = i < 2 ? CAR.toeFrontDeg : CAR.toeRearDeg;
        const wheelY = physics.wheelGroundHeights[i] + CAR.wheelRadius - carRoot.position.y;
        wheels[i].pivot.position.set(lx, wheelY, lz);
        wheels[i].pivot.rotation.y = (i < 2 ? physics.steer : 0) + side * toeDeg * Math.PI / 180;
        wheels[i].spin.scale.set(1, wheelRadiusScale, wheelRadiusScale);
        wheels[i].spin.rotation.x = physics.wheelSpin[i];
      }
      brakeMat.emissiveIntensity = controls.brake > 0.1 || controls.handbrake ? 1.4 : 0.2;

      // старые следы выцветают
      for (const s of skids) {
        if (!s.mesh.visible) continue;
        s.age += dt;
        if (s.age > 7) {
          s.mesh.visible = false;
        } else if (s.age > 4) {
          s.mat.opacity *= Math.exp(-dt * 1.1);
        }
      }
      for (const s of smokes) {
        if (!s.spr.visible) continue;
        s.age += dt;
        if (s.age > s.life) {
          s.spr.visible = false;
        } else {
          const k = s.age / s.life;
          s.spr.position.y += dt * 1.4;
          s.spr.scale.setScalar(s.spr.scale.x + s.grow * dt);
          (s.spr.material as THREE.SpriteMaterial).opacity = 0.32 * (1 - k);
        }
      }

      // камера
      if (fsm.is("title")) {
        const px = physics.x + Math.sin(titleAngle) * 10;
        const pz = physics.z + Math.cos(titleAngle) * 10;
        camera.position.set(px, 3.6, pz);
        camera.lookAt(physics.x, 0.8, physics.z);
      } else if (camMode === 0) {
        camYawOff *= Math.exp(-dt * 0.5);
        const ang = physics.yaw + camYawOff;
        const dist = 8.2 + physics.speed * 0.045;
        const fx = -Math.sin(ang);
        const fz = -Math.cos(ang);
        const tx = physics.x + fx * dist;
        const tz = physics.z + fz * dist;
        const k = 1 - Math.exp(-dt * 7);
        camera.position.x += (tx - camera.position.x) * k;
        camera.position.z += (tz - camera.position.z) * k;
        camera.position.y += (3.4 + physics.speed * 0.02 - camera.position.y) * k;
        shake *= Math.exp(-dt * 4);
        const ox = (Math.random() - 0.5) * shake;
        const oy = (Math.random() - 0.5) * shake * 0.6;
        camera.position.x += ox;
        camera.position.y += oy;
        camera.lookAt(physics.x - fx * 5, 1.2, physics.z - fz * 5);
        camera.fov += (Math.min(74, 62 + physics.speed * 0.25) - camera.fov) * k;
        camera.updateProjectionMatrix();
      } else {
        const fx = -Math.sin(physics.yaw);
        const fz = -Math.cos(physics.yaw);
        camera.position.set(physics.x + fx * 0.25, 1.18, physics.z + fz * 0.25);
        camera.lookAt(physics.x + fx * 12, 1.0, physics.z + fz * 12);
        if (camera.fov !== 68) {
          camera.fov = 68;
          camera.updateProjectionMatrix();
        }
      }

      // тень следует за машиной
      sun.position.set(physics.x + 40, 70, physics.z + 25);
      sun.target.position.set(physics.x, 0, physics.z);

      // HUD
      if (fsm.is("playing")) {
        setText("speed-val", Math.round(physics.speed * 3.6));
        setText("gear-val", physics.gear === -1 ? "R" : String(physics.gear));
        const rpm01 = (physics.rpm - CAR.idleRpm) / (CAR.maxRpm - CAR.idleRpm);
        const fill = $("rpm-fill");
        if (fill) fill.style.width = `${Math.round(Math.max(0, Math.min(1, rpm01)) * 100)}%`;
        setText("slip-val", Math.abs(physics.slipAngle * 57.3).toFixed(0));
        const steeringAngleDeg = physics.steer * 180 / Math.PI;
        setText(
          "steer-angle-val",
          `${steeringAngleDeg >= 0 ? "+" : ""}${steeringAngleDeg.toFixed(1)}°`,
        );
        const steerMax = CAR.steerMaxLow
          + (CAR.steerMaxHigh - CAR.steerMaxLow) * Math.max(0, Math.min(1, physics.speed / CAR.steerSpeedRef));
        const steerFraction = steerMax > 0
          ? Math.max(-1, Math.min(1, physics.steer / steerMax))
          : 0;
        const steerMarker = $("steer-angle-marker");
        if (steerMarker) steerMarker.style.left = `${50 - steerFraction * 42}%`;
        setText("score-val", Math.floor(score));
        const mult = physics.drifting ? 1 + Math.min(4, driftTime * 0.8) : 1;
        setText("mult-val", mult > 1.05 ? `×${mult.toFixed(1)}` : "");
        setText("best-val", best);
        const driftTag = $("drift-tag");
        if (driftTag) driftTag.classList.toggle("on", physics.drifting);
        const grassTag = $("grass-tag");
        if (grassTag) grassTag.classList.toggle("on", physics.grass);
      }

      renderer.render(scene, camera);
      window.__GAME_READY__ = true;

      // FPS-метр для автопонижения качества
      fpsFrames++;
      fpsTime += dt;
      if (fpsTime >= 2) {
        const fps = fpsFrames / fpsTime;
        fpsFrames = 0;
        fpsTime = 0;
        if (fps < 45 && degradeStep === 0) {
          degradeStep = 1;
          renderer.shadowMap.enabled = false;
          sun.castShadow = false;
        } else if (fps < 45 && degradeStep === 1) {
          degradeStep = 2;
          renderer.setPixelRatio(1);
        }
      }
    },
  });
  loop.start();

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  };
  window.addEventListener("resize", onResize);

  window.__gameProbe = () => ({ x: physics.x, y: 0, z: physics.z });

  session = {
    dispose: () => {
      loop.stop();
      input.dispose();
      audio.dispose();
      disposeDebugUI();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyGuard);
      document.removeEventListener("pointerlockchange", updateSteeringButtons);
      window.removeEventListener("driftlab:steering-mode", onSteeringModeChange);
      $("start-btn")?.removeEventListener("click", onStart);
      $("resume-btn")?.removeEventListener("click", onResume);
      $("menu-btn")?.removeEventListener("click", onMenu);
      $("mute-btn")?.removeEventListener("click", onMute);
      for (const id of steeringButtonIds) {
        $(id)?.removeEventListener("click", onSteeringModeClick);
      }
      for (const id of mouseLockButtonIds) {
        $(id)?.removeEventListener("click", onMouseLockClick);
      }
      for (const p of carParts) p.mesh.geometry.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      delete window.__gameProbe;
      window.__GAME_READY__ = false;
    },
  };
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}
