import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const activeWindows = new Set();

function createDom() {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <div id="kioskShell"></div>
        <div id="tapLockout" class="tap-lockout is-hidden" aria-hidden="true">
          <div class="tap-lockout__backdrop"></div>
          <section class="tap-lockout__panel">
            <p class="tap-lockout__title" id="tapLockoutTitle">Oops, demasiados intentos</p>
            <p class="tap-lockout__message" id="tapLockoutMessage"></p>
            <div class="tap-lockout__bar"><span id="tapLockoutBar"></span></div>
          </section>
        </div>
      </body>
    </html>`,
    { runScripts: 'outside-only', url: 'https://example.test/', pretendToBeVisual: true },
  );

  const { window } = dom;
  window.i18n = { t: (value) => value };

  global.window = window;
  global.document = window.document;

  activeWindows.add(window);
  return dom;
}

async function importTapLockout() {
  const url = `${pathToFileURL(resolve(process.cwd(), 'frontend/static/js/tap-lockout.js')).href}?v=${Date.now()}-${Math.random()}`;
  await import(url);
}

function tap(win) {
  win.document.dispatchEvent(new win.Event('pointerdown', { bubbles: true, cancelable: true }));
}

afterEach(() => {
  activeWindows.forEach((win) => win.close());
  activeWindows.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete global.window;
  delete global.document;
});

describe('tap lockout', () => {
  it('opens a grey countdown popup and blurs the background after 5 taps', async () => {
    vi.useFakeTimers();
    const dom = createDom();
    await importTapLockout();

    const overlay = dom.window.document.getElementById('tapLockout');
    const message = dom.window.document.getElementById('tapLockoutMessage');

    for (let i = 0; i < 4; i += 1) tap(dom.window);
    expect(overlay.classList.contains('is-hidden')).toBe(true);

    tap(dom.window); // quinto tap dispara el bloqueo
    expect(overlay.classList.contains('is-hidden')).toBe(false);
    expect(dom.window.document.documentElement.classList.contains('tap-lockout-open')).toBe(true);
    expect(message.textContent).toContain('20');
  });

  it('counts down and cannot be closed until it reaches zero', async () => {
    vi.useFakeTimers();
    const dom = createDom();
    await importTapLockout();

    const overlay = dom.window.document.getElementById('tapLockout');
    const message = dom.window.document.getElementById('tapLockoutMessage');

    for (let i = 0; i < 5; i += 1) tap(dom.window);
    expect(overlay.classList.contains('is-hidden')).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(message.textContent).toContain('15');
    expect(overlay.classList.contains('is-hidden')).toBe(false); // sigue bloqueado

    vi.advanceTimersByTime(15000); // total 20s
    expect(overlay.classList.contains('is-hidden')).toBe(true);
    expect(dom.window.document.documentElement.classList.contains('tap-lockout-open')).toBe(false);
  });

  it('pauses recognition while locked and resumes when the countdown ends', async () => {
    vi.useFakeTimers();
    const dom = createDom();
    await importTapLockout();

    let started = 0;
    let ended = 0;
    dom.window.document.addEventListener('tap-lockout:start', () => { started += 1; });
    dom.window.document.addEventListener('tap-lockout:end', () => { ended += 1; });

    for (let i = 0; i < 5; i += 1) tap(dom.window);
    expect(started).toBe(1);
    expect(ended).toBe(0);

    vi.advanceTimersByTime(20000);
    expect(ended).toBe(1);
  });

  it('blocks interaction while locked', async () => {
    vi.useFakeTimers();
    const dom = createDom();
    await importTapLockout();

    for (let i = 0; i < 5; i += 1) tap(dom.window);

    const blocked = new dom.window.Event('pointerdown', { bubbles: true, cancelable: true });
    let reachedBubble = false;
    dom.window.document.addEventListener('pointerdown', () => { reachedBubble = true; });
    dom.window.document.dispatchEvent(blocked);

    expect(reachedBubble).toBe(false); // el listener en captura detuvo la propagación
    expect(blocked.defaultPrevented).toBe(true);
  });
});
