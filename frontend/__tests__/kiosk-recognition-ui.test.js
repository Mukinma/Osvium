import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const activeWindows = new Set();

function responseJson(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function baseStatus(overrides = {}) {
  return {
    camera: 'online',
    model: 'loaded',
    gpio: 'ready',
    fps: 12,
    face_detected: false,
    face_bbox: null,
    primary_face_bbox: null,
    faces_count: 0,
    analysis_busy: false,
    last_result: 'INICIALIZANDO',
    last_user: '-',
    timestamp: Math.floor(Date.now() / 1000) - 20,
    support_phone: '+52 55 1234 5678',
    face_guidance: {
      state: 'searching',
      message: 'Buscando rostro',
      ready: false,
      faces_count: 0,
    },
    ...overrides,
  };
}

function createDom(getStatus) {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <head><meta name="csrf-token" content="csrf-token" /></head>
      <body>
        <div id="kioskShell">
          <span id="camState"></span>
          <span id="modelState"></span>
          <span id="gpioState"></span>
          <span id="fpsState"></span>
          <span id="systemStateBadge"></span>
          <span id="clockTime"></span>
          <span id="clockDate"></span>
          <div id="cameraShell">
            <div id="cameraStage">
              <img id="videoFeed" data-stream-src="/api/stream" />
              <div id="faceGuide" class="face-guide is-idle">
                <div id="faceArrowLeft"></div>
                <div id="faceArrowRight"></div>
                <div id="faceArrowUp"></div>
                <div id="faceArrowDown"></div>
              </div>
              <div id="faceBoxOverlay">
                <div id="primaryFaceBox" class="face-depth-field is-hidden"></div>
              </div>
              <div id="welcomeOverlay" class="welcome-overlay is-hidden">
                <svg id="welcomeCheckIcon" class="welcome-overlay__icon" aria-hidden="true">
                  <use href="/static/icons/lucide/lucide-sprite.svg#circle-check"></use>
                </svg>
                <span id="welcomeTitle"></span>
                <strong id="welcomeName"></strong>
              </div>
            </div>
          </div>
          <aside id="infoPanel">
            <svg id="accessReceiptIcon" class="kiosk-info__receipt-icon" aria-hidden="true">
              <use href="/static/icons/lucide/lucide-sprite.svg#circle-check"></use>
            </svg>
            <h1 id="infoTitle"></h1>
            <p id="infoDesc"></p>
            <p id="accessReceiptMeta"></p>
            <div id="authProgressBar"></div>
          </aside>
          <button id="supportHelpButton" class="is-hidden" type="button">¿Necesitas ayuda?</button>
          <div id="supportHelpDialog" class="is-hidden" aria-hidden="true">
            <p id="supportHelpMessage"></p>
            <span id="supportHelpPhone"></span>
            <button id="supportHelpClose" type="button"></button>
          </div>
        </div>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: 'https://example.test/',
      pretendToBeVisual: true,
    },
  );

  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.CameraPITheme = { initTheme: vi.fn(), bindToggleButtons: vi.fn() };
  window.CameraPIFaceAction = {
    create: vi.fn(() => ({
      localBusy: false,
      updateStatus: vi.fn(),
      isReady: vi.fn(() => false),
      handleAnalyzeClick: vi.fn(),
    })),
  };
  window.fetch = vi.fn(async (url) => {
    if (url === '/api/status') return responseJson(getStatus());
    return responseJson({}, 404);
  });
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.i18n = { t: (value) => value };

  global.window = window;
  global.document = window.document;
  global.fetch = window.fetch;
  global.requestAnimationFrame = window.requestAnimationFrame;
  global.cancelAnimationFrame = window.cancelAnimationFrame;

  activeWindows.add(window);
  return dom;
}

async function importKioskApp() {
  const url = `${pathToFileURL(resolve(process.cwd(), 'frontend/static/js/app.js')).href}?v=${Date.now()}-${Math.random()}`;
  await import(url);
  await flushAsync();
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  activeWindows.forEach((windowRef) => windowRef.close());
  activeWindows.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete global.window;
  delete global.document;
  delete global.fetch;
  delete global.requestAnimationFrame;
  delete global.cancelAnimationFrame;
});

describe('kiosk recognition UI', () => {
  it('shows configurable help after 10 seconds without a face and hides it when a face appears', async () => {
    vi.useFakeTimers();
    let status = baseStatus();
    const dom = createDom(() => status);

    await importKioskApp();

    const button = dom.window.document.getElementById('supportHelpButton');
    expect(button.classList.contains('is-hidden')).toBe(true);

    vi.advanceTimersByTime(10_000);
    await flushAsync();
    expect(button.classList.contains('is-hidden')).toBe(false);

    status = baseStatus({
      face_detected: true,
      primary_face_bbox: { x: 0.25, y: 0.2, w: 0.2, h: 0.3 },
      face_guidance: { state: 'ready', message: 'Rostro detectado', ready: true, faces_count: 1 },
    });
    vi.advanceTimersByTime(600);
    await flushAsync();

    expect(button.classList.contains('is-hidden')).toBe(true);
  });

  it('opens the help dialog with the configured support phone', async () => {
    vi.useFakeTimers();
    const dom = createDom(() => baseStatus());

    await importKioskApp();
    vi.advanceTimersByTime(10_000);
    await flushAsync();

    dom.window.document.getElementById('supportHelpButton').click();

    expect(dom.window.document.getElementById('supportHelpDialog').classList.contains('is-hidden')).toBe(false);
    expect(dom.window.document.getElementById('supportHelpMessage').textContent).toContain('no poder acceder');
    expect(dom.window.document.getElementById('supportHelpPhone').textContent).toContain('+52 55 1234 5678');
  });

  it('shows help immediately after an access failure instead of a blocked state', async () => {
    vi.useFakeTimers();
    const denied = baseStatus({
      last_result: 'DENEGADO',
      last_user: 'Desconocido',
      timestamp: Math.floor(Date.now() / 1000),
      face_detected: true,
      primary_face_bbox: { x: 0.3, y: 0.25, w: 0.22, h: 0.3 },
      faces_count: 1,
      failed_attempts_consecutive: 3,
      face_guidance: { state: 'ready', message: 'Rostro detectado', ready: true, faces_count: 1 },
    });
    const dom = createDom(() => denied);

    await importKioskApp();

    expect(dom.window.document.getElementById('infoTitle').textContent).toBe('No reconocido');
    expect(dom.window.document.getElementById('supportHelpButton').classList.contains('is-hidden')).toBe(false);
  });

  it('renders blue welcome overlay with the authorized user name', async () => {
    vi.useFakeTimers();
    const authorized = baseStatus({
      last_result: 'AUTORIZADO',
      last_user: 'Ana Torres',
      timestamp: Math.floor(Date.now() / 1000),
      face_detected: true,
      primary_face_bbox: { x: 0.15, y: 0.2, w: 0.25, h: 0.35 },
      face_guidance: { state: 'ready', message: 'Rostro detectado', ready: true, faces_count: 1 },
    });
    const dom = createDom(() => authorized);

    await importKioskApp();

    const overlay = dom.window.document.getElementById('welcomeOverlay');
    expect(overlay.classList.contains('is-hidden')).toBe(false);
    expect(dom.window.document.getElementById('welcomeTitle').textContent).toBe('Adelante');
    expect(dom.window.document.getElementById('welcomeName').textContent).toBe('Ana Torres');
    expect(overlay.classList.contains('welcome-overlay--blue')).toBe(true);
    expect(dom.window.document.getElementById('welcomeCheckIcon').classList.contains('is-hidden')).toBe(false);
    expect(
      dom.window.document.querySelector('#welcomeCheckIcon use')?.getAttribute('href'),
    ).toBe('/static/icons/lucide/lucide-sprite.svg#circle-check');
  });

  it('uses the lower panel as an access receipt without repeating the authorized name', async () => {
    vi.useFakeTimers();
    const authorized = baseStatus({
      last_result: 'AUTORIZADO',
      last_user: 'Ana Torres',
      timestamp: Math.floor(Date.now() / 1000),
      face_detected: true,
      primary_face_bbox: { x: 0.15, y: 0.2, w: 0.25, h: 0.35 },
      face_guidance: { state: 'ready', message: 'Rostro detectado', ready: true, faces_count: 1 },
    });
    const dom = createDom(() => authorized);

    await importKioskApp();

    expect(dom.window.document.getElementById('infoTitle').textContent).toBe('Acceso concedido');
    expect(dom.window.document.getElementById('infoDesc').textContent).toContain('Puerta desbloqueada');
    expect(dom.window.document.getElementById('infoTitle').textContent).not.toContain('Ana');
    expect(dom.window.document.getElementById('infoDesc').textContent).not.toContain('Ana');
    expect(dom.window.document.getElementById('accessReceiptMeta').textContent).toMatch(/\d{2}:\d{2}/);
    expect(dom.window.document.getElementById('accessReceiptIcon').classList.contains('is-hidden')).toBe(false);
  });

  it('renders a square blue depth field from primary_face_bbox instead of a rectangle', async () => {
    vi.useFakeTimers();
    const dom = createDom(() => baseStatus({
      face_detected: true,
      primary_face_bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      face_guidance: { state: 'ready', message: 'Rostro detectado', ready: true, faces_count: 1 },
    }));

    await importKioskApp();

    const box = dom.window.document.getElementById('primaryFaceBox');
    expect(box.classList.contains('is-hidden')).toBe(false);
    expect(box.classList.contains('face-depth-field')).toBe(true);
    expect(box.classList.contains('face-box')).toBe(false);
    expect(box.querySelector('.face-depth-field__sweep')).not.toBeNull();
    expect(box.querySelectorAll('.face-depth-field__line')).toHaveLength(6);
    expect(box.style.width).toBe(box.style.height);
    expect(box.style.top).toBe('7%');
    expect(box.style.width).toBe('53%');
  });
});
