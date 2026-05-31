(function () {
  'use strict';

  const STORAGE_KEY = 'osvium_keyboard';

  /* Types that open the keyboard */
  const TYPEABLE = new Set(['text', 'password', 'email', 'search', 'url', 'tel', 'number']);
  /* Types that use the numeric pad */
  const NUMERIC = new Set(['number', 'tel']);

  function isTypeableField(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return TYPEABLE.has((el.type || 'text').toLowerCase());
    return false;
  }

  function isNumericField(el) {
    return el && el.tagName === 'INPUT' && NUMERIC.has((el.type || '').toLowerCase());
  }

  /* ── Key layouts ────────────────────────────────────────────────────────── */

  const LAYERS = {
    qwerty: [
      ['q','w','e','r','t','y','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l','ñ'],
      ['⇧','z','x','c','v','b','n','m','⌫'],
      ['?123',' ','↵'],
    ],
    symbols: [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['@','#','$','%','&','*','-','+','(',')'],
      ['ABC','.', ',','!','?',':',';','_','⌫'],
      [' ','↵'],
    ],
  };

  const NUMPAD = [
    ['1','2','3'],
    ['4','5','6'],
    ['7','8','9'],
    ['.','0','⌫'],
    ['↵'],
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */

  let panel = null;
  let activeEl = null;
  let shiftOn = false;
  let currentLayer = 'qwerty';
  let useNumpad = false;
  let enabled = true;
  let blurTimer = null;
  /* Store original inputmode per element to restore on hide */
  const origInputModes = new WeakMap();

  /* ── Preference persistence ─────────────────────────────────────────────── */

  function readEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (_) { return true; }
  }

  function persistEnabled(v) {
    try { localStorage.setItem(STORAGE_KEY, v ? 'on' : 'off'); } catch (_) {}
  }

  function isEnabled() { return enabled; }

  function setEnabled(v) {
    enabled = !!v;
    persistEnabled(enabled);
    if (!enabled) hide();
    document.dispatchEvent(new CustomEvent('osk:changed', { detail: { enabled } }));
  }

  /* ── OS keyboard suppression ────────────────────────────────────────────── */

  function suppressOSKeyboard(el) {
    if (!el) return;
    if (!origInputModes.has(el)) origInputModes.set(el, el.getAttribute('inputmode'));
    el.setAttribute('inputmode', 'none');
  }

  function restoreOSKeyboard(el) {
    if (!el || !origInputModes.has(el)) return;
    const orig = origInputModes.get(el);
    if (orig === null) el.removeAttribute('inputmode');
    else el.setAttribute('inputmode', orig);
    origInputModes.delete(el);
  }

  /* ── Text manipulation ──────────────────────────────────────────────────── */

  function insertChar(char) {
    const el = activeEl;
    if (!el) return;
    const max = el.maxLength > 0 ? el.maxLength : Infinity;

    if (isNumericField(el)) {
      if (el.value.length < max) el.value += char;
    } else {
      const s = el.selectionStart != null ? el.selectionStart : el.value.length;
      const e = el.selectionEnd != null ? el.selectionEnd : el.value.length;
      if (el.value.length - (e - s) + 1 <= max) {
        el.value = el.value.slice(0, s) + char + el.value.slice(e);
        el.setSelectionRange(s + 1, s + 1);
      }
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false }));
  }

  function doBackspace() {
    const el = activeEl;
    if (!el) return;

    if (isNumericField(el)) {
      el.value = el.value.slice(0, -1);
    } else {
      const s = el.selectionStart != null ? el.selectionStart : el.value.length;
      const e = el.selectionEnd != null ? el.selectionEnd : el.value.length;
      if (s !== e) {
        el.value = el.value.slice(0, s) + el.value.slice(e);
        el.setSelectionRange(s, s);
      } else if (s > 0) {
        el.value = el.value.slice(0, s - 1) + el.value.slice(s);
        el.setSelectionRange(s - 1, s - 1);
      }
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false }));
  }

  function doEnter() {
    const el = activeEl;
    if (el) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
      const form = el.closest('form');
      if (form && el.tagName === 'INPUT') {
        activeEl = null; /* clear before hide so hide() doesn't re-dispatch change */
        hide();
        form.requestSubmit();
        return;
      }
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }
    activeEl = null; /* clear before hide to avoid double change dispatch */
    hide();
  }

  /* ── DOM construction ───────────────────────────────────────────────────── */

  function keyClass(label) {
    if (label === '⌫') return 'osk-key osk-key--backspace';
    if (label === '⇧') return 'osk-key osk-key--action osk-key--shift';
    if (label === ' ') return 'osk-key osk-key--space';
    if (label === '↵') return 'osk-key osk-key--enter';
    if (label === '?123' || label === 'ABC') return 'osk-key osk-key--action osk-key--layer';
    return 'osk-key';
  }

  function makeKey(label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = keyClass(label);

    if (label === ' ') {
      btn.textContent = 'espacio';
      btn.dataset.oskAction = 'space';
    } else if (label === '↵') {
      btn.textContent = '↵';
      btn.dataset.oskAction = 'enter';
    } else if (label === '⌫') {
      btn.textContent = '⌫';
      btn.dataset.oskAction = 'backspace';
    } else if (label === '⇧') {
      btn.textContent = '⇧';
      btn.dataset.oskAction = 'shift';
    } else if (label === '?123' || label === 'ABC') {
      btn.textContent = label;
      btn.dataset.oskAction = 'layer';
    } else {
      btn.textContent = label;
      btn.dataset.oskChar = label;
    }
    return btn;
  }

  function buildQwerty() {
    panel.innerHTML = '';
    const rows = LAYERS[currentLayer];
    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'osk-row';
      for (const k of row) rowEl.appendChild(makeKey(k));
      panel.appendChild(rowEl);
    }
    syncShift();
  }

  function buildNumpad() {
    panel.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'osk-numpad';
    for (const row of NUMPAD) {
      for (const k of row) {
        const btn = makeKey(k);
        if (k === '↵') btn.style.gridColumn = 'span 3';
        grid.appendChild(btn);
      }
    }
    panel.appendChild(grid);
  }

  function syncShift() {
    if (!panel) return;
    panel.querySelectorAll('[data-osk-action="shift"]').forEach((b) => {
      b.classList.toggle('is-active', shiftOn);
    });
    panel.querySelectorAll('[data-osk-char]').forEach((b) => {
      b.textContent = shiftOn ? b.dataset.oskChar.toUpperCase() : b.dataset.oskChar;
    });
  }

  function rebuildLayout() {
    if (!panel) return;
    if (useNumpad) buildNumpad();
    else buildQwerty();
  }

  /* ── Click handler ──────────────────────────────────────────────────────── */

  function handleClick(e) {
    const btn = e.target.closest('[data-osk-action],[data-osk-char]');
    if (!btn) return;

    const action = btn.dataset.oskAction;
    const char = btn.dataset.oskChar;

    if (char !== undefined) {
      insertChar(shiftOn ? char.toUpperCase() : char);
      if (shiftOn) { shiftOn = false; syncShift(); }
      return;
    }

    switch (action) {
      case 'backspace': doBackspace(); break;
      case 'space': insertChar(' '); break;
      case 'enter': doEnter(); break;
      case 'shift': shiftOn = !shiftOn; syncShift(); break;
      case 'layer':
        currentLayer = currentLayer === 'qwerty' ? 'symbols' : 'qwerty';
        shiftOn = false;
        rebuildLayout();
        break;
    }
  }

  /* ── Panel lifecycle ────────────────────────────────────────────────────── */

  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'oskPanel';
    panel.className = 'osk-panel';
    panel.setAttribute('aria-hidden', 'true');
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Teclado en pantalla');
    /* Prevent any pointer interaction from moving focus away from the active input */
    panel.addEventListener('pointerdown', (e) => e.preventDefault());
    panel.addEventListener('mousedown', (e) => e.preventDefault());
    panel.addEventListener('pointerup', handleClick);
    document.body.appendChild(panel);
  }

  function show(el) {
    if (!enabled) return;
    activeEl = el;
    shiftOn = false;
    currentLayer = 'qwerty';
    useNumpad = isNumericField(el);

    ensurePanel();
    suppressOSKeyboard(el);
    rebuildLayout();

    panel.classList.add('osk-visible');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('kb-open');

    requestAnimationFrame(() => {
      const h = panel.offsetHeight;
      document.body.style.setProperty('--kb-height', h + 'px');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function hide() {
    if (activeEl) {
      restoreOSKeyboard(activeEl);
      activeEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    activeEl = null;
    if (panel) {
      panel.classList.remove('osk-visible');
      panel.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('kb-open');
    document.body.style.removeProperty('--kb-height');
  }

  /* ── Focus delegation ───────────────────────────────────────────────────── */

  function onFocusIn(e) {
    if (!enabled || !isTypeableField(e.target)) return;
    clearTimeout(blurTimer);
    if (e.target === activeEl) return;
    show(e.target);
  }

  function onFocusOut() {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      const a = document.activeElement;
      if (!a || !isTypeableField(a)) hide();
    }, 150);
  }

  /* ── Init ───────────────────────────────────────────────────────────────── */

  function init() {
    enabled = readEnabled();
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);

    /* Handle fields that already have focus (e.g., autofocus on login page) */
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && isTypeableField(a)) show(a);
    });
  }

  window.OsviumKeyboard = { STORAGE_KEY, isEnabled, setEnabled, show, hide, isTypeableField };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
