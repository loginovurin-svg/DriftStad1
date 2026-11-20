/**
 * track.ts — кольцевая трасса: замкнутый сплайн Катмулла-Рома по контрольным точкам,
 * сэмплированный в полилинию. Отсюда же: поверхность под колесом (асфальт/бордюр/трава),
 * барьеры по краям, деревья, стартовая линия и визуальная геометрия (лента + приподнятые
 * элементы). Всё генерируется кодом — никаких внешних ассетов.
 */
import * as THREE from "three";

const CONTROL: Array<[number, number]> = [
  [-320, -430],
  [0, -430],
  [320, -430],
  [420, -350],
  [420, 0],
  [420, 350],
  [320, 430],
  [0, 430],
  [-320, 430],
  [-420, 350],
  [-420, 0],
  [-420, -350],
];

const SEG_PER_PT = 48;
const N = CONTROL.length * SEG_PER_PT;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - 3 * c + d - a) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

export class Track {
  readonly halfWidth = 7;
  readonly curbWidth = 1.4;

  private cx: Float32Array;
  private cz: Float32Array;
  private rx: Float32Array;
  private rz: Float32Array;
  private dist: Float32Array;
  readonly length: number;

  constructor() {
    this.cx = new Float32Array(N);
    this.cz = new Float32Array(N);
    this.rx = new Float32Array(N);
    this.rz = new Float32Array(N);
    this.dist = new Float32Array(N);

    let k = 0;
    for (let i = 0; i < CONTROL.length; i++) {
      const p0 = CONTROL[(i - 1 + CONTROL.length) % CONTROL.length];
      const p1 = CONTROL[i];
      const p2 = CONTROL[(i + 1) % CONTROL.length];
      const p3 = CONTROL[(i + 2) % CONTROL.length];
      for (let s = 0; s < SEG_PER_PT; s++) {
        const [x, z] = catmullRom(p0, p1, p2, p3, s / SEG_PER_PT);
        this.cx[k] = x;
        this.cz[k] = z;
        k++;
      }
    }
    // тангенсы/нормали (нормаль = «вправо» по ходу)
    let total = 0;
    for (let i = 0; i < N; i++) {
      const nx = this.cx[(i + 1) % N] - this.cx[(i - 1 + N) % N];
      const nz = this.cz[(i + 1) % N] - this.cz[(i - 1 + N) % N];
      const len = Math.hypot(nx, nz) || 1;
      // вправо по ходу: t=(tx,tz) → right=(−tz, tx)… в XZ-плоскости: right = (tz·−1?) — см. физику: r = (−fz, fx)
      const tx = nx / len;
      const tz = nz / len;
      this.rx[i] = -tz;
      this.rz[i] = tx;
      if (i > 0) total += Math.hypot(this.cx[i] - this.cx[i - 1], this.cz[i] - this.cz[i - 1]);
      this.dist[i] = total;
    }
    this.length = total + Math.hypot(this.cx[0] - this.cx[N - 1], this.cz[0] - this.cz[N - 1]);
  }

  /** Точка старта: сэмпл 0, касательная по соседним сэмплам (катмулл в узле «режет угол»,
   * поэтому направление берём из p[1] − p[N−1], а не из нормали сэмпла 0). */
  getSpawn(): { x: number; z: number; yaw: number } {
    const tx = this.cx[1] - this.cx[N - 1];
    const tz = this.cz[1] - this.cz[N - 1];
    // f = (−sin yaw, −cos yaw) = t̂ → yaw = atan2(−tx, −tz)
    return { x: this.cx[0], z: this.cz[0], yaw: Math.atan2(-tx, -tz) };
  }

  /** Ближайшая точка осевой линии — для возврата машины на трассу (клавиша R). */
  respawnPoint(x: number, z: number): { x: number; z: number; yaw: number } {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = x - this.cx[i];
      const dz = z - this.cz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // f = (−sin yaw, −cos yaw) = (−rx, −rz) → yaw = atan2(rx, rz)
    return { x: this.cx[best], z: this.cz[best], yaw: Math.atan2(this.rx[best], this.rz[best]) };
  }

  /**
   * Ближайший сэмпл к (x,z) + поверхность. Полный скан 720 сэмплов — дёшево и без аллокаций.
   * out заполняется всякий раз (grip/roll/dragMul по |lat|).
   */
  query(x: number, z: number, out: {
    grip: number; roll: number; dragMul: number; lat: number;
    nx: number; nz: number; cx: number; cz: number;
  }): void {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = x - this.cx[i];
      const dz = z - this.cz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const dx = x - this.cx[best];
    const dz = z - this.cz[best];
    const d = Math.sqrt(bestD) || 0.0001;
    const lat = dx * this.rx[best] + dz * this.rz[best];
    const a = Math.abs(lat);
    out.lat = lat;
    out.nx = dx / d;
    out.nz = dz / d;
    out.cx = this.cx[best];
    out.cz = this.cz[best];
    if (a <= this.halfWidth) {
      out.grip = 1.0;
      out.roll = 0.014;
      out.dragMul = 1;
    } else if (a <= this.halfWidth + this.curbWidth) {
      out.grip = 0.85;
      out.roll = 0.03;
      out.dragMul = 1;
    } else {
      out.grip = 0.55;
      out.roll = 0.2;
      out.dragMul = 3;
    }
  }

  /** Визуальная геометрия трассы и окружения. Возвращает группу и список disposable. */
  build(scene: THREE.Scene): { group: THREE.Group; disposables: Array<{ dispose(): void }> } {
    const disposables: Array<{ dispose(): void }> = [];
    const group = new THREE.Group();
    const track = this;

    const trackMats: THREE.MeshStandardMaterial[] = [];
    function strip(latA: number, latB: number, colorFn: (i: number) => THREE.Color): THREE.Mesh {
      const pos = new Float32Array((N + 1) * 2 * 3);
      const col = new Float32Array((N + 1) * 2 * 3);
      const idx: number[] = [];
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const ax = track.cx[j] + track.rx[j] * latA;
        const az = track.cz[j] + track.rz[j] * latA;
        const bx = track.cx[j] + track.rx[j] * latB;
        const bz = track.cz[j] + track.rz[j] * latB;
        pos.set([ax, 0, az, bx, 0, bz], i * 6);
        const c = colorFn(j);
        col.set([c.r, c.g, c.b, c.r, c.g, c.b], i * 6);
        if (i < N) {
          const a0 = i * 2;
          idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
      trackMats.push(mat);
      disposables.push(geo, mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    // асфальт с лёгким шумом тона (vertex colors уходят в линейное пространство — берем светлее)
    const asphalt = new THREE.Color(0x565c68);
    const rngA = mulberry32(1234);
    strip(-this.halfWidth, this.halfWidth, () => {
      const v = 0.94 + rngA() * 0.12;
      return new THREE.Color(asphalt.r * v, asphalt.g * v, asphalt.b * v);
    });
    // белые кромки
    const edge = new THREE.Color(0xd4d4d0);
    strip(-this.halfWidth, -this.halfWidth + 0.4, () => edge);
    strip(this.halfWidth - 0.4, this.halfWidth, () => edge);
    // бордюры красно-белые
    const curbR = new THREE.Color(0xb03a2e);
    const curbW = new THREE.Color(0xd8d8d2);
    const curbFn = (i: number) => (Math.floor(i / 8) % 2 === 0 ? curbR : curbW);
    strip(-this.halfWidth - this.curbWidth, -this.halfWidth, curbFn);
    strip(this.halfWidth, this.halfWidth + this.curbWidth, curbFn);
    // стартовая линия
    const start = new THREE.Color(0xe8e8e4);
    strip(-this.halfWidth + 0.2, this.halfWidth - 0.2, (i) => (track.dist[i] < 2.5 || track.dist[i] > track.length - 1 ? start : asphalt));

    // --- трава ---
    const grassGeo = new THREE.CircleGeometry(1500, 48);
    grassGeo.rotateX(-Math.PI / 2);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x3f7a38, roughness: 1 });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.position.y = -0.03;
    grass.receiveShadow = true;
    disposables.push(grassGeo, grassMat);
    group.add(grass);

    // --- барьеры (инстансы по обе стороны) ---
    const barrierGeo = new THREE.BoxGeometry(4.4, 0.85, 0.35);
    const barrierMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    const nB = Math.floor(N / 5) * 2;
    const barriers = new THREE.InstancedMesh(barrierGeo, barrierMat, nB);
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3(1, 1, 1);
    const E = new THREE.Euler();
    const C = new THREE.Color();
    let bi = 0;
    for (let i = 0; i < N; i += 5) {
      for (const side of [-1, 1]) {
        const lat = side * (this.halfWidth + this.curbWidth + 1.6);
        P.set(this.cx[i] + this.rx[i] * lat, 0.42, this.cz[i] + this.rz[i] * lat);
        // +X бокса → по касательной: θ = atan2(−tz, tx)
        const tx = -this.rx[i];
        const tz = -this.rz[i];
        E.set(0, Math.atan2(-tz, tx), 0);
        Q.setFromEuler(E);
        M.compose(P, Q, S);
        barriers.setMatrixAt(bi, M);
        barriers.setColorAt(bi, C.set(Math.floor(i / 24) % 2 === 0 ? 0xc0392b : 0xe8e8e4));
        bi++;
      }
    }
    barriers.castShadow = true;
    barriers.instanceMatrix.needsUpdate = true;
    if (barriers.instanceColor) barriers.instanceColor.needsUpdate = true;
    disposables.push(barrierGeo, barrierMat);
    group.add(barriers);

    // --- деревья ---
    const rng = mulberry32(777);
    const nT = 170;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 5);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
    const canGeo = new THREE.ConeGeometry(2.1, 5.2, 7);
    const canMat = new THREE.MeshStandardMaterial({ roughness: 1 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, nT);
    const cans = new THREE.InstancedMesh(canGeo, canMat, nT);
    const greens = [0x2f6b2f, 0x3a7a34, 0x2a5d33, 0x356e2e];
    for (let i = 0; i < nT; i++) {
      const j = Math.floor(rng() * N);
      const side = rng() < 0.5 ? -1 : 1;
      const lat = side * (this.halfWidth + this.curbWidth + 8 + rng() * 40);
      const sc = 0.7 + rng() * 1.1;
      P.set(this.cx[j] + this.rx[j] * lat, 1.1 * sc, this.cz[j] + this.rz[j] * lat);
      E.set(0, rng() * Math.PI * 2, 0);
      Q.setFromEuler(E);
      S.set(sc, sc, sc);
      M.compose(P, Q, S);
      trunks.setMatrixAt(i, M);
      P.y = (2.2 + 2.6) * sc;
      M.compose(P, Q, S);
      cans.setMatrixAt(i, M);
      cans.setColorAt(i, C.set(greens[Math.floor(rng() * greens.length)]));
    }
    trunks.castShadow = false;
    cans.castShadow = true;
    disposables.push(trunkGeo, trunkMat, canGeo, canMat);
    group.add(trunks, cans);

    // --- стартовая арка ---
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.18, 6, 6);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.4 });
    const bannerGeo = new THREE.BoxGeometry(this.halfWidth * 2 + 2, 1, 0.3);
    const bannerMat = new THREE.MeshStandardMaterial({ color: 0xff8c1a, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(this.cx[0] + this.rx[0] * side * (this.halfWidth + 1), 3, this.cz[0] + this.rz[0] * side * (this.halfWidth + 1));
      pole.castShadow = true;
      group.add(pole);
    }
    const banner = new THREE.Mesh(bannerGeo, bannerMat);
    banner.position.set(this.cx[0], 6, this.cz[0]);
    const fw = Math.atan2(-(-this.rz[0]), -this.rx[0]); // ориентация поперёк трассы
    banner.rotation.y = fw + Math.PI / 2;
    group.add(banner);
    disposables.push(poleGeo, poleMat, bannerGeo, bannerMat);

    scene.add(group);
    return { group, disposables };
  }
}
