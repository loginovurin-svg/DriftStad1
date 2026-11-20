/**
 * Home.tsx — DOM-оболочка: канвас + HUD и экраны (титул/пауза).
 * Игра в src/game/ сама обновляет содержимое элементов по id — React не рендерится 60 раз в секунду.
 */

import { useEffect, useRef } from 'react'
import { startGame, stopGame } from '@/game/boot'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    startGame(canvas)
    return () => stopGame()
  }, [])

  return (
    <div id="game-root">
      <canvas id="game-canvas" ref={canvasRef} />

      <div id="ui-overlay">
        {/* HUD во время езды */}
        <div id="hud" className="hidden">
          <div className="cockpit-mark">
            <span className="mark-dot" />
            <span>DRIFTLABE</span>
            <span className="mark-divider" />
            <span className="mark-mode">ТЕСТОВЫЙ ЗАЕЗД</span>
          </div>
          <div id="hud-left">
            <div id="speed-block">
              <span id="speed-val">0</span>
              <span className="unit">км/ч</span>
            </div>
            <div id="gear-block">
              <span className="label">Передача</span>
              <span id="gear-val">1</span>
            </div>
            <div id="steer-block" aria-label="Угол поворота передних колёс">
              <div className="steer-readout">
                <span className="label">Угол колёс</span>
                <span id="steer-angle-val">+0.0°</span>
              </div>
              <div className="steer-meter" aria-hidden="true">
                <span className="steer-meter-center" />
                <span id="steer-angle-marker" />
              </div>
            </div>
            <div id="rpm-bar">
              <div id="rpm-fill" />
            </div>
            <div id="slip-block">
              <span className="label">Снос</span>
              <span><span id="slip-val">0</span>°</span>
            </div>
            <div id="grass-tag">ТРАВА</div>
            <div id="drift-tag">ДРИФТ</div>
          </div>

          <div id="hud-right">
            <div id="score-block">
              <span className="label">Очки дрифта</span>
              <span id="score-val">0</span>
              <span id="mult-val" />
            </div>
            <div id="best-block">
              <span className="label">Рекорд</span>
              <span id="best-val">0</span>
            </div>
          </div>

          <button id="steering-mode-hud" className="btn control-mode-btn" type="button">
            Руль: клавиатура
          </button>
          <button id="mouse-lock-hud" className="btn mouse-lock-btn hidden" type="button">
            Захватить курсор
          </button>

          <div id="hud-help">
            W/S — газ/тормоз · A/D — руль · Space — ручник · Shift/Ctrl или E/Q — передачи ·
            R — сброс · C — камера · M — звук · F2 — настройки · Esc — пауза
          </div>
        </div>

        {/* Титульный экран */}
        <div id="title-screen">
          <div className="panel">
            <div className="panel-topline">
              <span className="brand-lockup"><span className="brand-mark">D</span> DRIFTLABE</span>
              <span className="session-code">ЛАБОРАТОРИЯ / 01</span>
            </div>
            <div className="panel-content">
              <div className="intro-copy">
                <p className="eyebrow"><span className="live-indicator" /> ФИЗИКА В ДВИЖЕНИИ</p>
                <h1>Найди<br /><span>свой угол.</span></h1>
                <p className="subtitle">
                  Настрой суперкар на пределе сцепления. Каждый вход в поворот — новый замер.
                </p>
              </div>

              <div className="spec-strip" aria-label="Параметры симуляции">
                <div><span className="spec-label">ПРИВОД</span><strong>ЗАДНИЙ</strong></div>
                <div><span className="spec-label">МОДЕЛЬ</span><strong>PACEJKA</strong></div>
                <div><span className="spec-label">ТРЕК</span><strong>КОЛЬЦО</strong></div>
              </div>

              <div className="panel-lower">
                <section className="controls-section" aria-label="Управление">
                  <div className="section-heading"><span>01</span> УПРАВЛЕНИЕ</div>
                  <div className="controls-grid">
                    <span>W / S</span><span>газ / тормоз, задняя</span>
                    <span>A / D</span><span>рулевое управление</span>
                    <span>Space</span><span>ручник — сорвать заднюю ось</span>
                    <span>Shift / Ctrl</span><span>передача вверх / вниз</span>
                    <span>E / Q</span><span>альтернативное переключение</span>
                    <span>R</span><span>вернуться на трассу</span>
                    <span>C</span><span>камера: погоня / капот</span>
                    <span>мышь</span><span>кнопка ниже — руль и фиксация курсора</span>
                  </div>
                </section>
                <aside className="run-card">
                  <div className="section-heading"><span>02</span> ТЕКУЩИЙ РЕКОРД</div>
                  <p className="best"><span id="best-val-title">0</span><small>очков</small></p>
                  <p className="tip">Войди в поворот, добавь газ и лови контрруление.</p>
                  <div className="btn-row">
                    <button id="start-btn" className="btn primary">Начать заезд <span>ПРОБЕЛ ↗</span></button>
                    <button id="mute-btn" className="btn sound-btn">Звук: вкл</button>
                    <button id="steering-mode-btn" className="btn control-mode-btn" type="button">
                      Руль: клавиатура
                    </button>
                    <button id="mouse-lock-btn" className="btn mouse-lock-btn hidden" type="button">
                      Захватить курсор
                    </button>
                  </div>
                </aside>
              </div>
            </div>
            <div className="panel-footer"><span>ЛЁГКИЙ ФИЗИЧЕСКИЙ ДВИЖОК</span><span>ВЕРСИЯ 01.04 <i /></span></div>
          </div>
        </div>

        {/* Пауза */}
        <div id="pause-screen" className="hidden">
          <div className="panel pause-panel">
            <div className="panel-topline">
              <span className="brand-lockup"><span className="brand-mark">D</span> DRIFTLABE</span>
              <span className="session-code">ЗАЕЗД ПРИОСТАНОВЛЕН</span>
            </div>
            <div className="pause-content">
              <p className="eyebrow">СЕССИЯ НА ПАУЗЕ</p>
              <h2>Поймай<br /><span>момент.</span></h2>
              <p className="pause-note">Трасса ждёт. Продолжай с той же точки.</p>
              <div className="btn-row">
                <button id="resume-btn" className="btn primary">Продолжить <span>ESC ↗</span></button>
                <button id="menu-btn" className="btn sound-btn">В меню</button>
              </div>
            </div>
            <div className="panel-footer"><span>DRIFTLABE / ТЕСТОВЫЙ ПОЛИГОН</span><span>ПАУЗА</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
