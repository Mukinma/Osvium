/**
 * Osvium — Bloqueo por exceso de taps/clicks.
 *
 * Cuenta los toques/clicks del usuario sobre el kiosco. Al alcanzar
 * MAX_TAPS dentro de una ventana corta (TAP_WINDOW_MS) se muestra un
 * pop-up gris modal con una cuenta regresiva de LOCKOUT_SECONDS.
 *
 * Reglas (requisito del producto):
 * - El pop-up NO se puede cerrar manualmente: desaparece solo al llegar a 0.
 * - Mientras está activo, todo el fondo se difumina (backdrop-filter) y se
 *   bloquea cualquier interacción (taps, clicks, teclado).
 * - Al terminar el contador se quita el blur y se reinicia el conteo.
 *
 * Se auto-inicializa si existe el marcado #tapLockout en el DOM.
 */
(function () {
  'use strict';

  const MAX_TAPS = 5;          /* taps que disparan el bloqueo */
  const TAP_WINDOW_MS = 3000;  /* ventana para contar los taps */
  const LOCKOUT_SECONDS = 20;  /* duración de la cuenta regresiva */

  const overlay = document.getElementById('tapLockout');
  if (!overlay) return;

  const titleEl = document.getElementById('tapLockoutTitle');
  const messageEl = document.getElementById('tapLockoutMessage');
  const countEl = document.getElementById('tapLockoutCount');
  const barEl = document.getElementById('tapLockoutBar');

  let taps = [];
  let locked = false;
  let remaining = 0;
  let intervalId = null;

  /* i18n con fallback silencioso al texto en español. */
  function tr(text) {
    try {
      return window.i18n ? window.i18n.t(text) : text;
    } catch (_) {
      return text;
    }
  }

  function render() {
    if (titleEl) {
      titleEl.textContent = tr('Oops, demasiados intentos');
    }
    if (messageEl) {
      /* La clave incluye {s}; el contador vive dentro del mismo mensaje. */
      messageEl.textContent = tr('Podrás acceder nuevamente en {s} segundos')
        .replace('{s}', String(remaining));
    }
    if (countEl) {
      countEl.textContent = String(remaining);
    }
    if (barEl) {
      const pct = Math.max(0, (remaining / LOCKOUT_SECONDS) * 100);
      barEl.style.width = `${pct}%`;
    }
  }

  function startLockout() {
    if (locked) return;
    locked = true;
    remaining = LOCKOUT_SECONDS;
    taps = [];
    render();
    overlay.classList.remove('is-hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('tap-lockout-open');

    /* Avisa a la app para que pause el reconocimiento mientras dura el
       bloqueo (de lo contrario el sistema seguiría reconociendo de fondo). */
    try {
      document.dispatchEvent(new CustomEvent('tap-lockout:start'));
    } catch (_) { /* CustomEvent no disponible */ }

    intervalId = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        endLockout();
        return;
      }
      render();
    }, 1000);
  }

  function endLockout() {
    locked = false;
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    overlay.classList.add('is-hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('tap-lockout-open');
    taps = [];

    /* Reanuda el reconocimiento al terminar la cuenta regresiva. */
    try {
      document.dispatchEvent(new CustomEvent('tap-lockout:end'));
    } catch (_) { /* CustomEvent no disponible */ }
  }

  function registerTap() {
    const now = Date.now();
    taps.push(now);
    taps = taps.filter((stamp) => now - stamp <= TAP_WINDOW_MS);
    if (taps.length >= MAX_TAPS) {
      startLockout();
    }
  }

  /* Listener en fase de captura: cuenta los taps y, mientras dura el
     bloqueo, intercepta toda interacción antes de que llegue al resto
     de la app (incluido el lockscreen). */
  function onCapture(event) {
    if (locked) {
      if (!overlay.contains(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (event.type === 'pointerdown') {
      registerTap();
    }
  }

  ['pointerdown', 'touchstart', 'click', 'keydown'].forEach((type) => {
    document.addEventListener(type, onCapture, { capture: true, passive: false });
  });

  /* Re-traducir el mensaje si cambia el idioma con el pop-up abierto. */
  document.addEventListener('i18n:change', () => {
    if (locked) render();
  });

  /* API mínima para pruebas / control externo. */
  window.CameraPITapLockout = {
    start: startLockout,
    end: endLockout,
    isLocked: () => locked,
    _registerTap: registerTap,
  };
})();
