import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'frontend/static/js/onscreen-keyboard.js'),
  'utf8',
);

const activeWindows = new Set();

function buildDom(bodyHtml = '', { oskEnabled = null } = {}) {
  const store = {};
  if (oskEnabled !== null) store['osvium_keyboard'] = oskEnabled ? 'on' : 'off';

  const dom = new JSDOM(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
    { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true },
  );
  const { window } = dom;

  window.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  window.requestAnimationFrame = (cb) => { cb(); return 1; };

  window.eval(SOURCE);
  activeWindows.add(window);

  return dom;
}

afterEach(() => {
  activeWindows.forEach((w) => w.close());
  activeWindows.clear();
});

/* ── isTypeableField ──────────────────────────────────────────────────────── */

describe('isTypeableField', () => {
  it('accepts text/password/email/search/url/tel/number', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;
    for (const type of ['text', 'password', 'email', 'search', 'url', 'tel', 'number']) {
      const el = document.createElement('input');
      el.type = type;
      expect(kb.isTypeableField(el), `type=${type}`).toBe(true);
    }
  });

  it('accepts textarea', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;
    expect(kb.isTypeableField(document.createElement('textarea'))).toBe(true);
  });

  it('rejects date, time, checkbox, radio, file, button, submit', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;
    for (const type of ['date', 'time', 'datetime-local', 'checkbox', 'radio', 'file', 'button', 'submit']) {
      const el = document.createElement('input');
      el.type = type;
      expect(kb.isTypeableField(el), `type=${type}`).toBe(false);
    }
  });

  it('rejects disabled and readonly inputs', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;

    const dis = Object.assign(document.createElement('input'), { type: 'text', disabled: true });
    expect(kb.isTypeableField(dis)).toBe(false);

    const ro = document.createElement('input');
    ro.type = 'text';
    ro.readOnly = true;
    expect(kb.isTypeableField(ro)).toBe(false);
  });

  it('rejects select elements and null', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;
    expect(kb.isTypeableField(document.createElement('select'))).toBe(false);
    expect(kb.isTypeableField(null)).toBe(false);
  });
});

/* ── Character insertion & input event ───────────────────────────────────── */

describe('character insertion', () => {
  it('inserts a character and fires input event', () => {
    const dom = buildDom('<input id="f" type="text" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');

    const fired = [];
    input.addEventListener('input', () => fired.push(input.value));

    kb.show(input);
    document.querySelector('[data-osk-char="a"]').click();

    expect(input.value).toBe('a');
    expect(fired).toHaveLength(1);
  });

  it('inserts uppercase on shift; auto-deactivates after one char', () => {
    const dom = buildDom('<input id="f" type="text" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    kb.show(input);

    document.querySelector('[data-osk-action="shift"]').click();
    document.querySelector('[data-osk-char="a"]').click();
    expect(input.value).toBe('A');

    document.querySelector('[data-osk-char="b"]').click();
    expect(input.value).toBe('Ab');
  });

  it('inserts at caret position', () => {
    const dom = buildDom('<input id="f" type="text" value="ac" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    input.setSelectionRange(1, 1);
    kb.show(input);

    document.querySelector('[data-osk-char="b"]').click();
    expect(input.value).toBe('abc');
    expect(input.selectionStart).toBe(2);
  });

  it('respects maxLength', () => {
    const dom = buildDom('<input id="f" type="text" maxlength="2" value="ab" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    kb.show(input);

    document.querySelector('[data-osk-char="c"]').click();
    expect(input.value).toBe('ab');
  });
});

/* ── Backspace ───────────────────────────────────────────────────────────── */

describe('backspace', () => {
  it('deletes the character before the caret and fires input event', () => {
    const dom = buildDom('<input id="f" type="text" value="hello" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    input.setSelectionRange(5, 5);

    const fired = [];
    input.addEventListener('input', () => fired.push(input.value));

    kb.show(input);
    document.querySelector('[data-osk-action="backspace"]').click();

    expect(input.value).toBe('hell');
    expect(input.selectionStart).toBe(4);
    expect(fired).toHaveLength(1);
  });

  it('deletes a selection', () => {
    const dom = buildDom('<input id="f" type="text" value="hello" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    input.setSelectionRange(1, 4);
    kb.show(input);

    document.querySelector('[data-osk-action="backspace"]').click();
    expect(input.value).toBe('ho');
  });
});

/* ── Numeric pad ─────────────────────────────────────────────────────────── */

describe('numeric pad', () => {
  it('uses numpad layout for type=number', () => {
    const dom = buildDom('<input id="f" type="number" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    kb.show(document.getElementById('f'));

    expect(document.querySelector('.osk-numpad')).toBeTruthy();
    expect(document.querySelector('.osk-row')).toBeNull();
  });

  it('uses numpad layout for type=tel', () => {
    const dom = buildDom('<input id="f" type="tel" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    kb.show(document.getElementById('f'));

    expect(document.querySelector('.osk-numpad')).toBeTruthy();
  });

  it('uses QWERTY for type=text', () => {
    const dom = buildDom('<input id="f" type="text" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    kb.show(document.getElementById('f'));

    expect(document.querySelector('.osk-row')).toBeTruthy();
    expect(document.querySelector('.osk-numpad')).toBeNull();
  });

  it('appends digits to type=number value', () => {
    const dom = buildDom('<input id="f" type="tel" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');
    kb.show(input);

    document.querySelector('[data-osk-char="5"]').click();
    expect(input.value).toBe('5');
  });
});

/* ── Toggle (setEnabled / isEnabled) ─────────────────────────────────────── */

describe('toggle enable/disable', () => {
  it('is enabled by default', () => {
    const dom = buildDom();
    expect(dom.window.OsviumKeyboard.isEnabled()).toBe(true);
  });

  it('persists "off" to localStorage', () => {
    const dom = buildDom();
    const { OsviumKeyboard: kb, localStorage: ls } = dom.window;
    kb.setEnabled(false);
    expect(ls.getItem('osvium_keyboard')).toBe('off');
    expect(kb.isEnabled()).toBe(false);
  });

  it('persists "on" to localStorage', () => {
    const dom = buildDom();
    const { OsviumKeyboard: kb, localStorage: ls } = dom.window;
    kb.setEnabled(true);
    expect(ls.getItem('osvium_keyboard')).toBe('on');
    expect(kb.isEnabled()).toBe(true);
  });

  it('reads "off" from localStorage at init', () => {
    const dom = buildDom('', { oskEnabled: false });
    expect(dom.window.OsviumKeyboard.isEnabled()).toBe(false);
  });

  it('does not show keyboard when disabled', () => {
    const dom = buildDom('<input id="f" type="text" />');
    const { document, OsviumKeyboard: kb } = dom.window;
    kb.setEnabled(false);
    kb.show(document.getElementById('f'));
    expect(document.querySelector('.osk-visible')).toBeNull();
  });

  it('dispatches osk:changed event on toggle', () => {
    const dom = buildDom();
    const { document, OsviumKeyboard: kb } = dom.window;
    const events = [];
    document.addEventListener('osk:changed', (e) => events.push(e.detail));
    kb.setEnabled(false);
    kb.setEnabled(true);
    expect(events).toEqual([{ enabled: false }, { enabled: true }]);
  });
});

/* ── Hide on focusout ─────────────────────────────────────────────────────── */

describe('hide on focusout', () => {
  it('hides when focus moves to a non-typeable element', async () => {
    const dom = buildDom('<input id="f" type="text" /><div id="out" tabindex="0"></div>');
    const { document, OsviumKeyboard: kb } = dom.window;
    const input = document.getElementById('f');

    kb.show(input);
    expect(document.querySelector('.osk-visible')).toBeTruthy();

    input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));

    expect(document.querySelector('.osk-visible')).toBeNull();
  });
});
