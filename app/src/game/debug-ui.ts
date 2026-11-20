/**
 * F2 tuning console. Values are applied to the live physics/input objects as
 * soon as a field changes; saved presets survive reloads without a dependency
 * on a remote GUI library.
 */
import { CAR } from "./physics";
import { INPUT_CONFIG, type SteeringMode } from "./config";
import "./debug-ui.css";

const SETTINGS_VERSION = 3;
const STORAGE_KEY = "driftLabTune.v3";
const PREVIOUS_STORAGE_KEY = "driftLabTune.v2";
const DEFAULT_CAR = snapshot(CAR);
const DEFAULT_INPUT = { ...INPUT_CONFIG };
const carValues = CAR as unknown as Record<string, unknown>;
const inputValues = INPUT_CONFIG as unknown as Record<string, unknown>;

type ParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  description: string;
  read: () => number;
  write: (value: number) => void;
};

type ScalarSpec = Omit<ParamSpec, "read" | "write">;
type ParamGroup = { title: string; values: ScalarSpec[] };

const PARAM_GROUPS: ParamGroup[] = [
  {
    title: "Масса, оси и инерция",
    values: [
      scalar("mass", "Масса", 800, 2500, 10, "кг", "Общая масса кузова и водителя."),
      scalar("inertia", "Инерция рысканья", 500, 6000, 25, "кг·м²", "Сопротивление вращению вокруг вертикальной оси."),
      scalar("inertiaPitch", "Инерция pitch", 500, 8000, 50, "кг·м²", "Инерция продольного наклона кузова."),
      scalar("inertiaRoll", "Инерция roll", 100, 3000, 25, "кг·м²", "Инерция крена кузова."),
      scalar("bodyPitchStiffness", "Жёсткость pitch", 10000, 120000, 1000, "Н·м/рад", "Скорость возврата продольного наклона."),
      scalar("bodyPitchDamping", "Демпфер pitch", 1000, 40000, 500, "Н·м·с/рад", "Гасит раскачивание кузова при газе и торможении."),
      scalar("bodyRollStiffness", "Жёсткость roll", 10000, 180000, 1000, "Н·м/рад", "Сопротивление крену в поворотах."),
      scalar("bodyRollDamping", "Демпфер roll", 1000, 30000, 500, "Н·м·с/рад", "Гасит поперечную раскачку кузова."),
      scalar("axleFront", "Передняя ось Z", -2.2, -0.8, 0.01, "м", "Положение передней оси относительно центра масс; отрицательное значение — впереди."),
      scalar("axleRear", "Задняя ось Z", 0.8, 2.2, 0.01, "м", "Положение задней оси относительно центра масс."),
      scalar("trackHalf", "Половина колеи", 0.55, 1.2, 0.01, "м", "Расстояние от центра кузова до колеса."),
      scalar("cgHeight", "Высота центра масс", 0.25, 1.1, 0.01, "м", "Больше значение — сильнее перенос веса."),
    ],
  },
  {
    title: "Колёса",
    values: [
      scalar("wheelRadius", "Радиус", 0.2, 0.6, 0.005, "м", "Меняет радиус в модели и масштабе видимых колёс."),
      scalar("wheelInertia", "Инерция колеса", 0.2, 4, 0.05, "кг·м²", "Инерция вращения; большее значение медленнее раскручивается."),
      scalar("wheelDamp", "Демпфер колеса", 0, 5, 0.05, "Н·м·с", "Сопротивление свободному вращению колеса."),
    ],
  },
  {
    title: "Двигатель и трансмиссия",
    values: [
      scalar("peakTorque", "Пиковый момент", 200, 1000, 10, "Н·м", "Крутящий момент двигателя до учёта передаточных чисел."),
      scalar("peakRpm", "Обороты пика", 2500, 7500, 50, "об/мин", "Диапазон максимального момента."),
      scalar("idleRpm", "Холостой ход", 500, 1800, 25, "об/мин", "Минимальные обороты двигателя."),
      scalar("maxRpm", "Ограничитель", 5000, 10000, 50, "об/мин", "Предельные обороты двигателя."),
      scalar("reverseRatio", "Передача заднего хода", 1, 5, 0.05, "×", "Передаточное число задней передачи."),
      scalar("finalDrive", "Главная пара", 2, 6, 0.05, "×", "Увеличение момента на ведущих колёсах."),
      scalar("driveEff", "КПД привода", 0.5, 1, 0.01, "×", "Потери мощности в трансмиссии."),
    ],
  },
  {
    title: "Тормоза и ABS",
    values: [
      scalar("brakeTorque", "Момент тормозов", 500, 6000, 50, "Н·м", "Суммарный момент рабочих тормозов."),
      scalar("brakeBiasFront", "Баланс спереди", 0.4, 0.85, 0.01, "доля", "Доля тормозного усилия, приходящаяся на переднюю ось."),
      scalar("handbrakeTorque", "Момент ручника", 500, 6000, 50, "Н·м", "Усилие ручного тормоза на задних колёсах."),
      scalar("absSlipStart", "ABS: начало", 0.02, 0.5, 0.01, "слип", "Слип, при котором ABS начинает отпускать тормоз."),
      scalar("absSlipFull", "ABS: полный сброс", 0.1, 0.9, 0.01, "слип", "Слип, при котором вмешательство ABS максимально."),
    ],
  },
  {
    title: "Аэродинамика",
    values: [
      scalar("aeroCd", "Cd", 0.15, 1.2, 0.01, "×", "Коэффициент аэродинамического сопротивления."),
      scalar("frontalArea", "Лобовая площадь", 1, 3.5, 0.01, "м²", "Площадь проекции автомобиля спереди."),
      scalar("airDensity", "Плотность воздуха", 0.8, 1.5, 0.005, "кг/м³", "Участвует в расчёте сопротивления и прижимной силы."),
      scalar("downforceCl", "Cl прижима", 0, 2, 0.01, "×", "Положительное значение создаёт прижимную силу, растущую со скоростью."),
      scalar("downforceBalanceFront", "Прижим спереди", 0, 1, 0.01, "доля", "Доля аэродинамической прижимной силы на передней оси."),
    ],
  },
  {
    title: "Руль и геометрия",
    values: [
      scalar("steerMaxLow", "Макс. угол на малой скорости", 0.1, 0.8, 0.01, "рад", "Максимальный угол передних колёс почти на месте."),
      scalar("steerMaxHigh", "Макс. угол на высокой скорости", 0.03, 0.35, 0.005, "рад", "Максимальный угол руля на скорости."),
      scalar("steerSpeedRef", "Скорость снижения руля", 10, 80, 1, "м/с", "Скорость перехода от малого к большому скоростному углу."),
      scalar("steerResponse", "Отклик руля", 0.5, 12, 0.1, "рад/с", "Как быстро колёса достигают заданного угла."),
      scalar("steerReturnRate", "Возврат руля", 0.2, 8, 0.1, "рад/с", "Самовозврат руля без ввода игрока."),
      scalar("casterDeg", "Кастор", 0, 14, 0.1, "°", "Усиливает самовозврат передних колёс на скорости."),
      scalar("camberFrontDeg", "Развал спереди", -6, 3, 0.1, "°", "Избыточный отрицательный развал немного снижает доступный грип."),
      scalar("camberRearDeg", "Развал сзади", -6, 3, 0.1, "°", "Развал задних колёс влияет на их доступный грип."),
      scalar("toeFrontDeg", "Схождение спереди", -1, 1, 0.01, "°/колесо", "Угол схождения влияет на устойчивость передней оси."),
      scalar("toeRearDeg", "Схождение сзади", -1, 1, 0.01, "°/колесо", "Угол схождения влияет на устойчивость задней оси."),
      scalar("yawDamp", "Демпфер рысканья", 0, 800, 5, "Н·м·с", "Больше — машина быстрее гасит вращение кузова."),
    ],
  },
  {
    title: "Шины, слип и стабилизация",
    values: [
      scalar("mu", "Базовый μ", 0.4, 2.2, 0.01, "×", "Общий множитель сцепления всех шин."),
      scalar("muFront", "μ спереди", 0.5, 2, 0.01, "×", "Относительное сцепление передней оси."),
      scalar("muRear", "μ сзади", 0.5, 2, 0.01, "×", "Относительное сцепление задней оси; повышение помогает бороться с заносом."),
      scalar("pacejkaB", "Pacejka B", 2, 20, 0.1, "×", "Наклон характеристики поперечного слипа."),
      scalar("pacejkaC", "Pacejka C", 0.8, 2.2, 0.01, "×", "Форма характеристики поперечного слипа."),
      scalar("slipB", "Продольный слип B", 2, 20, 0.1, "×", "Чувствительность продольной силы к пробуксовке."),
      scalar("loadSensitivity", "Чувствительность к нагрузке", 0, 0.00006, 0.0000005, "1/Н", "Уменьшает прирост сцепления при переносе веса на одно колесо."),
      scalar("loadReference", "Опорная нагрузка шины", 500, 8000, 25, "Н", "Нагрузка, относительно которой рассчитывается потеря сцепления."),
      scalar("tcStart", "TC: начало", 0, 1, 0.01, "слип", "Слип ведущих колёс, при котором начинает работать traction control."),
      scalar("tcFull", "TC: максимум", 0.1, 2, 0.01, "слип", "Слип, при котором traction control действует максимально."),
    ],
  },
  {
    title: "Подвеска",
    values: [
      scalar("springRate", "Жёсткость пружины", 10000, 100000, 500, "Н/м", "Сила пружины на единицу хода."),
      scalar("damping", "Демпфирование амортизатора", 500, 14000, 100, "Н·с/м", "Амортизатор сопротивляется сжатию и отбою."),
      scalar("suspensionRest", "Длина в покое", 0.05, 0.4, 0.005, "м", "Расстояние от ступицы до точки подвески."),
      scalar("suspensionMax", "Макс. ход", 0.1, 0.5, 0.005, "м", "Максимальное сжатие подвески."),
      scalar("suspensionOffsetY", "Смещение подвески Y", -0.5, 0.5, 0.005, "м", "Сдвиг верхней точки подвески относительно кузова."),
      scalar("antiRollBar", "Стабилизатор поперечной устойчивости", 0, 30000, 250, "Н/м", "Перераспределяет усилие между левым и правым колесом оси."),
    ],
  },
];

function scalar(
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit: string,
  description: string,
): ScalarSpec {
  return { key, label, min, max, step, unit, description };
}

function snapshot(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
  );
}

function allParams(): ParamSpec[] {
  const params = PARAM_GROUPS.flatMap((group) =>
    group.values.map((spec): ParamSpec => ({
      ...spec,
      read: () => Number(carValues[spec.key]),
      write: (value) => { carValues[spec.key] = value; },
    })),
  );
  for (let gear = 1; gear < CAR.gears.length; gear++) {
    const index = gear;
    params.push({
      ...scalar(`gear-${gear}`, `Передача ${gear}`, 0.4, 5, 0.01, "×", "Передаточное число выбранной передачи."),
      read: () => CAR.gears[index] ?? 1,
      write: (value) => { CAR.gears[index] = value; },
    });
  }
  return params;
}

const PARAMS = allParams();
const INPUT_NUMBERS = [
  { key: "MOUSE_SENS_X", label: "Чувствительность обзора X", min: 0.0002, max: 0.01, step: 0.0001, unit: "рад/пиксель" },
  { key: "MOUSE_SENS_Y", label: "Чувствительность обзора Y", min: 0.0002, max: 0.01, step: 0.0001, unit: "рад/пиксель" },
  { key: "MOUSE_STEER_GAIN", label: "Руль от мыши", min: 0.0002, max: 0.02, step: 0.0001, unit: "на пиксель" },
  { key: "MOUSE_STEER_CENTER_RATE", label: "Возврат руля мыши", min: 0, max: 8, step: 0.1, unit: "на секунду" },
] as const;

type BoundNumber = { range: HTMLInputElement; number: HTMLInputElement; read: () => number };

export function initDebugUI(): () => void {
  loadFromStorage();

  document.getElementById("driftlab-tune-panel")?.remove();
  const panel = document.createElement("aside");
  panel.id = "driftlab-tune-panel";
  panel.className = "tune-panel";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Консоль настройки физики");
  panel.innerHTML = `
    <header class="tune-header">
      <div><p class="tune-kicker">DRIFTLABE / TELEMETRY</p><h2>Настройка физики</h2></div>
      <button class="tune-close" type="button" aria-label="Закрыть консоль">×</button>
    </header>
    <p class="tune-intro">Параметры действуют сразу. Нажмите F2, чтобы скрыть панель.</p>
    <section class="tune-inputs">
      <h3>Управление</h3>
      <label class="tune-select-row"><span>Режим руля</span>
        <select id="tune-steering-mode" aria-label="Режим руля">
          <option value="keyboard">Клавиатура</option>
          <option value="mouse">Мышь с фиксацией курсора</option>
        </select>
      </label>
    </section>
    <div class="tune-groups"></div>
    <section class="tune-inputs tune-camera">
      <h3>Мышь и обзор</h3>
      <div class="tune-input-number-fields"></div>
      <label class="tune-toggle"><input type="checkbox" id="tune-invert-x"><span>Инвертировать X</span></label>
      <label class="tune-toggle"><input type="checkbox" id="tune-invert-y"><span>Инвертировать Y</span></label>
    </section>
    <footer class="tune-footer">
      <p class="tune-status" aria-live="polite">Изменения применяются в реальном времени</p>
      <div class="tune-actions">
        <button type="button" data-action="save">Сохранить</button>
        <button type="button" data-action="export">Экспорт JSON</button>
        <button type="button" data-action="import">Импорт JSON</button>
        <button type="button" data-action="reset">Сбросить</button>
      </div>
    </footer>
  `;
  document.body.append(panel);

  const status = panel.querySelector<HTMLElement>(".tune-status")!;
  const boundNumbers: BoundNumber[] = [];
  const saveStatus = (message = "Настройки сохранены") => {
    saveToStorage();
    status.textContent = message;
  };
  let saveTimer: number | undefined;
  const queueSave = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveStatus(), 250);
  };

  const groupsRoot = panel.querySelector<HTMLElement>(".tune-groups")!;
  PARAM_GROUPS.forEach((group, index) => {
    const details = document.createElement("details");
    details.className = "tune-group";
    details.open = index === 0 || index === 2;
    const summary = document.createElement("summary");
    summary.textContent = group.title;
    details.append(summary);
    const content = document.createElement("div");
    content.className = "tune-group-content";
    for (const spec of group.values) {
      const param = PARAMS.find((entry) => entry.key === spec.key)!;
      content.append(createNumberRow(spec.label, spec.unit, spec.description, spec.min, spec.max, spec.step, param.read, param.write, queueSave, boundNumbers));
    }
    if (group.title === "Двигатель и трансмиссия") {
      for (const param of PARAMS.filter((entry) => entry.key.startsWith("gear-"))) {
        content.append(createNumberRow(param.label, param.unit, param.description, param.min, param.max, param.step, param.read, param.write, queueSave, boundNumbers));
      }
    }
    details.append(content);
    groupsRoot.append(details);
  });

  const inputRoot = panel.querySelector<HTMLElement>(".tune-input-number-fields")!;
  for (const spec of INPUT_NUMBERS) {
    const read = () => Number(inputValues[spec.key]);
    const write = (value: number) => { inputValues[spec.key] = value; };
    inputRoot.append(createNumberRow(
      spec.label,
      spec.unit,
      "Настройка применяется сразу к вводу мышью.",
      spec.min,
      spec.max,
      spec.step,
      read,
      write,
      queueSave,
      boundNumbers,
    ));
  }

  const modeSelect = panel.querySelector<HTMLSelectElement>("#tune-steering-mode")!;
  modeSelect.value = INPUT_CONFIG.STEERING_MODE;
  modeSelect.addEventListener("change", () => {
    INPUT_CONFIG.STEERING_MODE = modeSelect.value as SteeringMode;
    window.dispatchEvent(new CustomEvent<SteeringMode>("driftlab:steering-mode", { detail: INPUT_CONFIG.STEERING_MODE }));
    saveStatus("Режим руля применён");
  });

  const invertX = panel.querySelector<HTMLInputElement>("#tune-invert-x")!;
  const invertY = panel.querySelector<HTMLInputElement>("#tune-invert-y")!;
  invertX.checked = INPUT_CONFIG.INVERT_X;
  invertY.checked = INPUT_CONFIG.INVERT_Y;
  invertX.addEventListener("change", () => { INPUT_CONFIG.INVERT_X = invertX.checked; saveStatus(); });
  invertY.addEventListener("change", () => { INPUT_CONFIG.INVERT_Y = invertY.checked; saveStatus(); });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.code !== "F2" || event.repeat) return;
    event.preventDefault();
    panel.hidden = !panel.hidden;
  };
  const onSaveRequest = () => saveStatus("Режим руля сохранён");
  panel.querySelector<HTMLButtonElement>(".tune-close")!.addEventListener("click", () => { panel.hidden = true; });
  panel.querySelector<HTMLButtonElement>('[data-action="save"]')!.addEventListener("click", () => saveStatus());
  panel.querySelector<HTMLButtonElement>('[data-action="export"]')!.addEventListener("click", exportJSON);
  panel.querySelector<HTMLButtonElement>('[data-action="import"]')!.addEventListener("click", () => importJSON(refresh));
  panel.querySelector<HTMLButtonElement>('[data-action="reset"]')!.addEventListener("click", () => {
    if (!window.confirm("Сбросить физику и управление к исходным настройкам?")) return;
    resetAll();
    refresh();
    saveStatus("Возвращены исходные настройки");
  });
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("driftlab:save-settings", onSaveRequest);
  console.info("DriftLabe tuning console ready. Press F2 to toggle.");

  function refresh(): void {
    for (const field of boundNumbers) {
      const value = field.read();
      field.range.value = String(value);
      field.number.value = String(value);
    }
    modeSelect.value = INPUT_CONFIG.STEERING_MODE;
    invertX.checked = INPUT_CONFIG.INVERT_X;
    invertY.checked = INPUT_CONFIG.INVERT_Y;
    window.dispatchEvent(new CustomEvent<SteeringMode>("driftlab:steering-mode", { detail: INPUT_CONFIG.STEERING_MODE }));
  }

  return () => {
    window.clearTimeout(saveTimer);
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("driftlab:save-settings", onSaveRequest);
    panel.remove();
  };
}

function createNumberRow(
  labelText: string,
  unit: string,
  description: string,
  min: number,
  max: number,
  step: number,
  read: () => number,
  write: (value: number) => void,
  onCommit: () => void,
  bindings: BoundNumber[],
): HTMLElement {
  const row = document.createElement("label");
  row.className = "tune-field";
  row.title = description;
  const heading = document.createElement("span");
  heading.className = "tune-field-heading";
  heading.innerHTML = `<span></span><small></small>`;
  heading.querySelector("span")!.textContent = labelText;
  heading.querySelector("small")!.textContent = unit;
  const controls = document.createElement("span");
  controls.className = "tune-field-controls";
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(read());
  range.setAttribute("aria-label", labelText);
  const number = document.createElement("input");
  number.type = "number";
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.value = String(read());
  number.setAttribute("aria-label", `${labelText}, точное значение`);
  const update = (source: HTMLInputElement, other: HTMLInputElement) => {
    const raw = Number(source.value);
    if (!Number.isFinite(raw)) return;
    const value = Math.min(max, Math.max(min, raw));
    write(value);
    source.value = String(value);
    other.value = String(value);
    onCommit();
  };
  range.addEventListener("input", () => update(range, number));
  number.addEventListener("input", () => update(number, range));
  controls.append(range, number);
  row.append(heading, controls);
  bindings.push({ range, number, read });
  return row;
}

function loadFromStorage(): void {
  try {
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    const migrating = !currentRaw;
    const raw = currentRaw ?? localStorage.getItem(PREVIOUS_STORAGE_KEY);
    if (!raw) return;
    const settings = JSON.parse(raw) as { car?: Record<string, unknown>; input?: Record<string, unknown> };
    if (settings.car) {
      for (const param of PARAMS) {
        // v3 corrects the suspension mount's vertical reference; don't carry
        // the old offset value into the new coordinate convention.
        if (migrating && param.key === "suspensionOffsetY") continue;
        const value = settings.car[param.key];
        if (typeof value === "number" && Number.isFinite(value)) {
          param.write(Math.min(param.max, Math.max(param.min, value)));
        }
      }
      if (Array.isArray(settings.car.gears)) {
        settings.car.gears.forEach((value, index) => {
          if (index > 0 && index < CAR.gears.length && typeof value === "number" && Number.isFinite(value)) {
            CAR.gears[index] = Math.max(0.4, Math.min(5, value));
          }
        });
      }
    }
    if (settings.input) {
      for (const spec of INPUT_NUMBERS) {
        const value = settings.input[spec.key];
        if (typeof value === "number" && Number.isFinite(value)) {
          inputValues[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
        }
      }
      if (settings.input.STEERING_MODE === "keyboard" || settings.input.STEERING_MODE === "mouse") {
        INPUT_CONFIG.STEERING_MODE = settings.input.STEERING_MODE;
      }
      if (typeof settings.input.INVERT_X === "boolean") INPUT_CONFIG.INVERT_X = settings.input.INVERT_X;
      if (typeof settings.input.INVERT_Y === "boolean") INPUT_CONFIG.INVERT_Y = settings.input.INVERT_Y;
    }
    if (migrating) saveToStorage();
  } catch {
    // Blocked or malformed storage must not stop the simulator from starting.
  }
}

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      formatVersion: SETTINGS_VERSION,
      car: snapshot(carValues),
      input: { ...INPUT_CONFIG },
    }));
  } catch {
    // Settings still apply for the current session if browser storage is unavailable.
  }
}

function resetAll(): void {
  for (const [key, value] of Object.entries(DEFAULT_CAR)) {
    carValues[key] = Array.isArray(value) ? [...value] : value;
  }
  Object.assign(INPUT_CONFIG, DEFAULT_INPUT);
}

function exportJSON(): void {
  const blob = new Blob([JSON.stringify({
    formatVersion: SETTINGS_VERSION,
    car: snapshot(carValues),
    input: { ...INPUT_CONFIG },
  }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "driftlabe-tuning.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importJSON(refresh: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const settings = JSON.parse(await file.text()) as {
        formatVersion?: number;
        car?: Record<string, unknown>;
        input?: Record<string, unknown>;
      };
      if (!settings || typeof settings !== "object") throw new Error("Неверный формат файла");
      const sourceCar = settings.car ?? settings as unknown as Record<string, unknown>;
      for (const param of PARAMS) {
        if (settings.formatVersion !== SETTINGS_VERSION && param.key === "suspensionOffsetY") continue;
        const value = sourceCar[param.key];
        if (typeof value === "number" && Number.isFinite(value)) {
          param.write(Math.min(param.max, Math.max(param.min, value)));
        }
      }
      const gears = sourceCar.gears;
      if (Array.isArray(gears)) {
        gears.forEach((value, index) => {
          if (index > 0 && index < CAR.gears.length && typeof value === "number" && Number.isFinite(value)) {
            CAR.gears[index] = Math.max(0.4, Math.min(5, value));
          }
        });
      }
      if (settings.input) {
        for (const spec of INPUT_NUMBERS) {
          const value = settings.input[spec.key];
          if (typeof value === "number" && Number.isFinite(value)) {
            inputValues[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
          }
        }
        if (settings.input.STEERING_MODE === "keyboard" || settings.input.STEERING_MODE === "mouse") {
          INPUT_CONFIG.STEERING_MODE = settings.input.STEERING_MODE;
        }
        if (typeof settings.input.INVERT_X === "boolean") INPUT_CONFIG.INVERT_X = settings.input.INVERT_X;
        if (typeof settings.input.INVERT_Y === "boolean") INPUT_CONFIG.INVERT_Y = settings.input.INVERT_Y;
      }
      refresh();
      saveToStorage();
    } catch (error) {
      window.alert(`Не удалось импортировать настройки: ${(error as Error).message}`);
    }
  };
  input.click();
}
