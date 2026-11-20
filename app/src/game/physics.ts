/**
 * physics.ts — физика автомобиля: raycast-подвеска, шины по Пачеке, RWD, ручник.
 * Координаты: плоскость XZ, ось Y вверх. Поворот руля: yaw = 0 → машина смотрит в −Z.
 */

export interface CarControls {
  throttle: number; brake: number; steer: number; handbrake: boolean;
}

export interface GroundInfo {
  height: number; // высота поверхности
  grip: number; roll: number; dragMul: number;
  lat: number; nx: number; nz: number; cx: number; cz: number;
}

export const CAR = {
  // SI units throughout: kg, m, s, N, N·m, rad/s.
  mass: 1490,
  inertia: 2500,
  inertiaPitch: 2800,
  inertiaRoll: 650,
  bodyPitchStiffness: 60000,
  bodyPitchDamping: 18000,
  bodyRollStiffness: 85000,
  bodyRollDamping: 9000,
  axleFront: -1.32,
  axleRear: 1.38,
  trackHalf: 0.82,
  cgHeight: 0.48,
  wheelRadius: 0.34,
  wheelInertia: 1.7,
  wheelDamp: 1.2,
  peakTorque: 560,
  peakRpm: 5400,
  idleRpm: 850,
  maxRpm: 7800,
  gears: [0, 3.1, 2.17, 1.6, 1.25, 1, 0.82],
  reverseRatio: 3,
  finalDrive: 3.45,
  driveEff: 0.9,
  brakeTorque: 2500,
  brakeBiasFront: 0.64,
  handbrakeTorque: 2100,
  absSlipStart: 0.12,
  absSlipFull: 0.38,
  aeroCd: 0.32,
  frontalArea: 2.05,
  airDensity: 1.225,
  downforceCl: 0.48,
  downforceBalanceFront: 0.42,
  steerMaxLow: 0.48,
  steerMaxHigh: 0.11,
  steerSpeedRef: 45,
  steerResponse: 4.5,
  steerReturnRate: 2.3,
  casterDeg: 6,
  camberFrontDeg: -1.5,
  camberRearDeg: -1,
  toeFrontDeg: 0.05,
  toeRearDeg: 0.12,
  pacejkaB: 10,
  pacejkaC: 1.3,
  slipB: 9.5,
  mu: 1,
  muFront: 1.15,
  muRear: 1.2,
  loadSensitivity: 0.000015,
  loadReference: 3600,
  yawDamp: 115,
  tcStart: 0.28,
  tcFull: 0.8,
  // Vertical offset of the upper suspension pickup relative to the base mount.
  // Together with rest length, this puts the default pickup at 0.603 m when the CG is at 0.48 m.
  suspensionOffsetY: 0.063,
  springRate: 42000,
  damping: 5600,
  suspensionRest: 0.2,
  suspensionMax: 0.35,
  antiRollBar: 8500,
};

const G = 9.81;
const DEG_TO_RAD = Math.PI / 180;

function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v; return Math.abs(d) <= maxDelta ? target : v + Math.sign(d) * maxDelta;
}
function pacejka(x: number, B: number, C: number): number { return Math.sin(C * Math.atan(B * x)); }
function torqueCurve(rpm: number): number {
  const x = (rpm - CAR.peakRpm) / 2900; return clamp(1 - x * x, 0.42, 1);
}

export class CarPhysics {
  x = 0; z = 0; yaw = 0; vx = 0; vz = 0; omega = 0; steer = 0;
  longitudinalAccel = 0; lateralAccel = 0;
  // 3D кузов
  y = CAR.cgHeight; pitch = 0; roll = 0; vy = 0; omegaPitch = 0; omegaRoll = 0;
  readonly wheelSpin = [0, 0, 0, 0]; readonly wheelOmega = [0, 0, 0, 0];
  readonly wheelCompression = [0, 0, 0, 0];
  readonly wheelGroundHeights = [0, 0, 0, 0];
  gear = 1; rpm: number = CAR.idleRpm; private shiftTimer = 0; private rearSlip = 0;
  speed = 0; slipAngle = 0; drifting = false; lastImpact = 0; grass = false;

  reset(x: number, z: number, yaw: number): void {
    this.x = x; this.z = z; this.yaw = yaw; this.vx = 0; this.vz = 0; this.omega = 0; this.steer = 0;
    // Равновесная высота: подвеска сжата ровно настолько, чтобы держать вес машины
    const eqCompression = (CAR.mass * G) / (4 * CAR.springRate);
    const hubLocalY = CAR.wheelRadius + CAR.suspensionRest - CAR.cgHeight + CAR.suspensionOffsetY;
    this.y = (CAR.suspensionMax + CAR.wheelRadius - eqCompression) - hubLocalY;
    this.pitch = 0; this.roll = 0; this.vy = 0; this.omegaPitch = 0; this.omegaRoll = 0;
    this.longitudinalAccel = 0; this.lateralAccel = 0;
    this.wheelSpin.fill(0); this.wheelOmega.fill(0); this.wheelCompression.fill(eqCompression);
    this.wheelGroundHeights.fill(0);
    this.gear = 1; this.rpm = CAR.idleRpm; this.shiftTimer = 0; this.rearSlip = 0;
    this.speed = 0; this.slipAngle = 0; this.drifting = false; this.lastImpact = 0;
  }

  shiftUp(): void {
    if (this.gear === -1) this.gear = 1;
    else if (this.gear < CAR.gears.length - 1) { this.gear += 1; this.shiftTimer = 0.15; }
  }
  shiftDown(): void {
    if (this.gear > 1) { this.gear -= 1; this.shiftTimer = 0.15; }
    else if (this.gear === 1 && this.speed < 2) { this.gear = -1; this.shiftTimer = 0.15; }
  }

  update(dt: number, ctl: CarControls, ground: (x: number, z: number, out: GroundInfo) => void, gOut: GroundInfo): void {
    const SUB = 3; const h = dt / SUB; this.lastImpact = 0;
    for (let s = 0; s < SUB; s++) this.substep(h, ctl, ground, gOut);
  }

  private substep(h: number, ctl: CarControls, ground: (x: number, z: number, out: GroundInfo) => void, g: GroundInfo): void {
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fx = -sin, fz = -cos, rx = -fz, rz = fx;

    this.speed = Math.hypot(this.vx, this.vz);
    const sf = clamp(this.speed / CAR.steerSpeedRef, 0, 1);
    const maxSteer = CAR.steerMaxLow + (CAR.steerMaxHigh - CAR.steerMaxLow) * sf;
    const steerTarget = -ctl.steer * maxSteer;
    const casterAssist = Math.sin(CAR.casterDeg * DEG_TO_RAD) * clamp(this.speed / 25, 0, 1);
    const steerSpeed = Math.abs(ctl.steer) > 0.01
      ? CAR.steerResponse
      : CAR.steerReturnRate + casterAssist;
    this.steer = approach(this.steer, steerTarget, steerSpeed * h);
    if (this.shiftTimer > 0) this.shiftTimer -= h;

    const ratio = this.gear === -1 ? -CAR.reverseRatio : (CAR.gears[this.gear] ?? 1);
    const wRear = 0.5 * (this.wheelOmega[2] + this.wheelOmega[3]);
    let rpm = Math.abs(wRear * ratio * CAR.finalDrive) * 60 / (2 * Math.PI);
    if (ctl.throttle > 0.15) {
      const slipBlend = Math.max(0, 1 - this.speed / 8);
      rpm = Math.max(rpm, CAR.idleRpm + ctl.throttle * (CAR.maxRpm - CAR.idleRpm) * 0.62 * slipBlend);
    } else { rpm = Math.max(rpm, CAR.idleRpm); }
    rpm = Math.min(rpm, CAR.maxRpm + 400);
    let engineTq = CAR.peakTorque * torqueCurve(rpm) * ctl.throttle;
    if (this.shiftTimer > 0) engineTq = 0;
    const tc = clamp((this.rearSlip - CAR.tcStart) / (CAR.tcFull - CAR.tcStart), 0, 1);
    engineTq *= 1 - 0.5 * tc;
    if (rpm > CAR.maxRpm) engineTq *= 0.15;
    this.rpm = rpm;

    const hubLocalY = CAR.wheelRadius + CAR.suspensionRest - CAR.cgHeight + CAR.suspensionOffsetY;
    const springForces = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const lx = i % 2 === 0 ? -CAR.trackHalf : CAR.trackHalf;
      const lz = i < 2 ? CAR.axleFront : CAR.axleRear;
      const px = lx * cos + lz * sin, pz = -lx * sin + lz * cos;
      const wx = this.x + px, wz = this.z + pz;
      ground(wx, wz, g);
      this.wheelGroundHeights[i] = g.height;

      // Raycast подвеска
      const yHub = this.y + hubLocalY + lx * this.roll - lz * this.pitch;
      const distToGround = yHub - g.height;
      const rayLength = CAR.suspensionMax + CAR.wheelRadius;
      let Fz = 0;

      if (distToGround < rayLength) {
        let c = rayLength - distToGround;
        c = clamp(c, 0, CAR.suspensionMax);
        this.wheelCompression[i] = c;
        const vRel = this.vy + this.omegaRoll * lx - this.omegaPitch * lz;
        // Damper force must oppose suspension velocity; the previous plus sign added energy.
        Fz = CAR.springRate * c - CAR.damping * vRel;
      } else {
        this.wheelCompression[i] = 0;
      }
      springForces[i] = Math.max(0, Fz);
    }

    // Стабилизатор поперечной устойчивости
    const arbFront = CAR.antiRollBar * (this.wheelCompression[0] - this.wheelCompression[1]);
    const arbRear = CAR.antiRollBar * (this.wheelCompression[2] - this.wheelCompression[3]);
    springForces[0] = Math.max(0, springForces[0] + arbFront);
    springForces[1] = Math.max(0, springForces[1] - arbFront);
    springForces[2] = Math.max(0, springForces[2] + arbRear);
    springForces[3] = Math.max(0, springForces[3] - arbRear);

    const wheelbase = Math.max(0.5, CAR.axleRear - CAR.axleFront);
    const frontWeightShare = clamp(CAR.axleRear / wheelbase, 0.1, 0.9);
    const speedForAero = Math.hypot(this.vx, this.vz);
    const aeroScale = 0.5 * CAR.airDensity * CAR.frontalArea * speedForAero * speedForAero;
    const downforce = Math.max(0, aeroScale * CAR.downforceCl);
    const frontDownforce = downforce * clamp(CAR.downforceBalanceFront, 0, 1);
    const rearDownforce = downforce - frontDownforce;
    const longitudinalTransfer = CAR.mass * this.longitudinalAccel * CAR.cgHeight / wheelbase;
    const lateralTransfer = CAR.mass * this.lateralAccel * CAR.cgHeight / (2 * Math.max(0.2, CAR.trackHalf * 2));
    const fzArray = [0, 0, 0, 0];
    let F_up_Tot = 0;
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2;
      const side = i % 2 === 0 ? -1 : 1;
      const axleShare = isFront ? frontWeightShare : 1 - frontWeightShare;
      const aeroBalanceOffset = (frontDownforce - downforce / 2) / 2;
      const staticLoad = CAR.mass * G * axleShare / 2
        + (isFront ? aeroBalanceOffset : -aeroBalanceOffset);
      const suspensionDelta = springForces[i] - CAR.mass * G / 4;
      const foreAftLoad = isFront ? -longitudinalTransfer / 2 : longitudinalTransfer / 2;
      // Positive lateral acceleration is to the car's right, loading the left-side tires.
      const leftRightLoad = side < 0 ? lateralTransfer / 2 : -lateralTransfer / 2;
      fzArray[i] = Math.max(0, staticLoad + suspensionDelta + foreAftLoad + leftRightLoad);
      F_up_Tot += springForces[i];
    }

    let FxTot = 0, FzTot = 0, tauYaw = 0, rearSigSum = 0;

    for (let i = 0; i < 4; i++) {
      const lx = i % 2 === 0 ? -CAR.trackHalf : CAR.trackHalf;
      const lz = i < 2 ? CAR.axleFront : CAR.axleRear;
      const isFront = i < 2, isDriven = i >= 2;
      const px = lx * cos + lz * sin, pz = -lx * sin + lz * cos;
      ground(this.x + px, this.z + pz, g);

      const Fz = fzArray[i];
      const camberDeg = isFront ? CAR.camberFrontDeg : CAR.camberRearDeg;
      const camberGrip = clamp(1 - Math.max(0, Math.abs(camberDeg) - 2) * 0.015, 0.85, 1.05);
      const mu = CAR.mu * (isFront ? CAR.muFront : CAR.muRear) * g.grip * camberGrip;
      const loadSens = clamp(1 - CAR.loadSensitivity * (Fz - CAR.loadReference), 0.72, 1.08);
      const D = mu * Fz * loadSens;

      const side = i % 2 === 0 ? -1 : 1;
      const toeDeg = isFront ? CAR.toeFrontDeg : CAR.toeRearDeg;
      const steerAngle = (isFront ? this.steer : 0) + side * toeDeg * DEG_TO_RAD;
      const phi = this.yaw + steerAngle;
      const fwx = -Math.sin(phi), fwz = -Math.cos(phi), rwx = -fwz, rwz = fwx;
      const vwx = this.vx + this.omega * pz, vwz = this.vz - this.omega * px;
      const vLong = vwx * fwx + vwz * fwz, vLat = vwx * rwx + vwz * rwz;

      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.0));
      const w = this.wheelOmega[i];
      const sigma = (w * CAR.wheelRadius - vLong) / Math.max(Math.abs(vLong), 1.0);
      if (isDriven) rearSigSum += sigma;

      let Fxi = D * pacejka(sigma, CAR.slipB, CAR.pacejkaC);
      let Fyi = D * pacejka(alpha, CAR.pacejkaB, CAR.pacejkaC);
      const forceUse = Math.hypot(Fxi, Fyi);
      if (forceUse > D && forceUse > 0) { const k = D / forceUse; Fxi *= k; Fyi *= k; }

      if (ctl.handbrake && isDriven) { Fxi = clamp(-vLong * 55, -D * 0.95, D * 0.95); Fyi *= 0.55; }

      const Fwx = Fxi * fwx - Fyi * rwx, Fwz = Fxi * fwz - Fyi * rwz;
      FxTot += Fwx; FzTot += Fwz; tauYaw += pz * Fwx - px * Fwz;

      let Tw = 0;
      if (isDriven && this.shiftTimer <= 0) Tw = (engineTq * ratio * CAR.finalDrive * CAR.driveEff) / 2;
      if (ctl.brake > 0.01) {
        const axleBrakeShare = isFront ? CAR.brakeBiasFront : 1 - CAR.brakeBiasFront;
        const lockAmount = clamp(
          (-sigma - CAR.absSlipStart) / Math.max(0.01, CAR.absSlipFull - CAR.absSlipStart),
          0,
          1,
        );
        Tw -= ctl.brake * (CAR.brakeTorque * axleBrakeShare / 2)
          * Math.tanh(w * 10) * (1 - lockAmount * 0.75);
      }
      if (ctl.handbrake && isDriven) Tw -= CAR.handbrakeTorque * Math.tanh(w * 10);
      
      const dw = (Tw - Fxi * CAR.wheelRadius - CAR.wheelDamp * w) / CAR.wheelInertia;
      this.wheelOmega[i] += dw * h;
      if (Math.abs(this.wheelOmega[i]) < 0.02 && Math.abs(Tw) < 1) this.wheelOmega[i] = 0;
      this.wheelSpin[i] += this.wheelOmega[i] * h;

    }

    this.rearSlip += (rearSigSum / 2 - this.rearSlip) * (1 - Math.exp(-h * 18));

    const spd = this.speed;
    if (spd > 0.01) {
      const inv = 1 / spd;
      const fAero = 0.5 * CAR.airDensity * CAR.aeroCd * CAR.frontalArea * spd * spd * g.dragMul;
      const fRoll = g.roll * CAR.mass * G;
      const fr = (fAero + fRoll) * inv;
      FxTot -= this.vx * fr; FzTot -= this.vz * fr;
      this.grass = g.grip < 0.8;
    } else { this.grass = false; }

    if (spd < 0.4 && ctl.throttle < 0.05) {
      const damp = Math.exp(-6 * h); this.vx *= damp; this.vz *= damp;
    }

    // Интегрирование 2D
    const ax = FxTot / CAR.mass, az = FzTot / CAR.mass;
    this.longitudinalAccel = ax * fx + az * fz;
    this.lateralAccel = ax * rx + az * rz;
    const pitchTarget = clamp(this.longitudinalAccel * 0.008, -0.15, 0.15);
    const rollTarget = clamp(this.lateralAccel * 0.006, -0.12, 0.12);
    this.omegaPitch += (
      CAR.bodyPitchStiffness * (pitchTarget - this.pitch)
      - CAR.bodyPitchDamping * this.omegaPitch
    ) / Math.max(1, CAR.inertiaPitch) * h;
    this.omegaRoll += (
      CAR.bodyRollStiffness * (rollTarget - this.roll)
      - CAR.bodyRollDamping * this.omegaRoll
    ) / Math.max(1, CAR.inertiaRoll) * h;
    this.pitch += this.omegaPitch * h;
    this.roll += this.omegaRoll * h;
    this.vx += ax * h; this.vz += az * h;
    this.omega += ((tauYaw - CAR.yawDamp * this.omega) / CAR.inertia) * h;
    this.omega = clamp(this.omega, -6, 6);
    this.yaw += this.omega * h;
    this.x += this.vx * h; this.z += this.vz * h;

    // Вертикальный отклик подрессоренной массы; pitch/roll интегрируются отдельно выше.
    F_up_Tot -= CAR.mass * G + downforce;
    this.vy += (F_up_Tot / CAR.mass) * h;
    this.y += this.vy * h;
    if (this.y < CAR.wheelRadius + 0.01) { 
      this.y = CAR.wheelRadius + 0.01; 
      this.vy = Math.max(0, this.vy); 
    }
    ground(this.x, this.z, g);
    const wallLat = 9.2;
    if (Math.abs(g.lat) > wallLat) {
      const over = Math.abs(g.lat) - wallLat;
      this.x -= g.nx * over; this.z -= g.nz * over;
      const vn = this.vx * g.nx + this.vz * g.nz;
      if (vn > 0) { this.lastImpact = vn; this.vx -= g.nx * vn * 1.35; this.vz -= g.nz * vn * 1.35; this.omega *= 0.92; }
    }

    this.speed = Math.hypot(this.vx, this.vz);
    this.slipAngle = Math.atan2(this.vx * rx + this.vz * rz, Math.abs(this.vx * fx + this.vz * fz) + 0.001);
    this.drifting = this.speed > 5 && Math.abs(this.slipAngle) > 0.2 && Math.abs(this.slipAngle) < 1.3;
  }
}
