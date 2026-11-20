/**
 * config.ts — global tuning. Input sensitivity and invert switches live here (sync verify-game.mjs when changing the mapping).
 */

export type SteeringMode = "keyboard" | "mouse";

export const INPUT_CONFIG: {
  MOUSE_SENS_X: number;
  MOUSE_SENS_Y: number;
  INVERT_X: boolean;
  INVERT_Y: boolean;
  MOUSE_STEER_GAIN: number;
  MOUSE_STEER_CENTER_RATE: number;
  STEERING_MODE: SteeringMode;
} = {
  /** Mouse/touch camera sensitivity (radians/pixel). */
  MOUSE_SENS_X: 0.0026,
  MOUSE_SENS_Y: 0.0022,
  /** Camera invert switches: default false = mouse right turns camera right, mouse up looks up (intuitive directions). */
  INVERT_X: false,
  INVERT_Y: false,
  /** Normalized steering input per locked-pointer pixel. */
  MOUSE_STEER_GAIN: 0.0025,
  /** Automatic centering when the pointer is not locked, in normalized input per second. */
  MOUSE_STEER_CENTER_RATE: 1.8,
  STEERING_MODE: "keyboard",
};

export const QUALITY = {
  /** Degradation tier for insufficient performance: cut particles and effects instead of dropping frames. */
  PARTICLES_HIGH: 500,
  PARTICLES_LOW: 150,
  /** Auto-degrade when the frame rate stays below this for 2s. */
  DEGRADE_FPS: 45,
} as const;

export const COLORS = {
  background: 0x0b0e12,
} as const;
