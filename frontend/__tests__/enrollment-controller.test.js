import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const CONTROLLER_SOURCE = readFileSync(
  resolve(process.cwd(), 'frontend/static/js/enrollment-controller.js'),
  'utf8',
);

const activeWindows = new Set();

function buildActiveSnapshot() {
  return {
    phase: 'active',
    state: 'step_active',
    user_id: 7,
    user_name: 'Ada Lovelace',
    current_step: 1,
    total_steps: 7,
    step_name: 'tilt_left',
    step_label: 'Inclina hacia la izquierda',
    step_icon: 'arrow-left',
    samples_this_step: 2,
    samples_needed: 5,
    total_captured: 7,
    total_needed: 35,
    steps_summary: [
      { name: 'center', label: 'Mira de frente', icon: 'circle-dot', status: 'complete', samples: 5, needed: 5 },
      { name: 'tilt_left', label: 'Inclina hacia la izquierda', icon: 'arrow-left', status: 'active', samples: 2, needed: 5 },
      { name: 'tilt_right', label: 'Inclina hacia la derecha', icon: 'arrow-right', status: 'pending', samples: 0, needed: 5 },
    ],
    guidance: {
      instruction: 'Inclina hacia la izquierda',
      hint: 'Sigue la guia en pantalla',
      arrow: 'left',
      hold_progress: 0.2,
      pose_matched: false,
      face_detected: true,
      brightness_ok: true,
      multiple_faces: false,
    },
    actions: {
      can_retry: true,
      can_abort: true,
      can_finish: false,
      can_train: false,
    },
    started_at: 100,
    updated_at: 200,
  };
}

function buildCompletedSnapshot() {
  return {
    ...buildActiveSnapshot(),
    phase: 'completed_review',
    state: 'completed',
    current_step: 6,
    samples_this_step: 5,
    total_captured: 35,
    steps_summary: Array.from({ length: 7 }, (_, index) => ({
      name: `step-${index}`,
      label: `Paso ${index + 1}`,
      icon: 'circle-dot',
      status: 'complete',
      samples: 5,
      needed: 5,
    })),
    guidance: {
      instruction: 'Enrolamiento completado',
      hint: '35 muestras listas para entrenar',
      arrow: null,
      hold_progress: 0,
      pose_matched: true,
      face_detected: true,
      brightness_ok: true,
      multiple_faces: false,
    },
    actions: {
      can_retry: false,
      can_abort: false,
      can_finish: true,
      can_train: true,
    },
  };
}

function createResponse(data, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
  };
}

function createDom({ initialView = 'personas', fetchImpl, confirmImpl = () => true } = {}) {
  const canvasContext = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    ellipse: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    setLineDash: vi.fn(),
  };
  const dom = new JSDOM(
    `<!doctype html>
    <html lang="es">
      <body>
        <div id="view-enrolamiento">
          <div class="enrollment-layout">
            <section class="enrollment-camera-card">
              <div class="enrollment-camera-status">
                <div class="enrollment-camera-status__group">
                  <span id="enrollPhasePill"></span>
                  <span id="enrollCurrentSamples"></span>
                </div>
                <span id="enrollUserMeta"></span>
              </div>
              <div class="enrollment-viewport" id="enrollViewport">
                <img id="enrollStream" src="/api/stream" />
                <canvas id="enrollOverlay"></canvas>
                <div id="enrollHud">
                  <span id="enrollStepBadge"></span>
                  <span id="enrollStepCounter"></span>
                  <p id="enrollInstruction"></p>
                  <p id="enrollMessage"></p>
                </div>
                <div id="enrollFaceWarning" class="is-hidden"><span id="enrollFaceWarningText"></span></div>
                <div id="enrollLightWarning" class="is-hidden"></div>
                <div id="enrollMultiFaceWarning" class="is-hidden"></div>
                <div id="enrollFlash"></div>
                <div id="enrollCompletion" class="is-hidden">
                  <p id="enrollCompletionSub"></p>
                  <button id="enrollTrainBtn" type="button">Entrenar ahora</button>
                  <button id="enrollFinishBtn" type="button">Volver sin entrenar</button>
                </div>
              </div>
              <div id="enrollDots"></div>
              <div class="enrollment-controls">
                <button id="enrollAbortBtn" type="button">Cancelar</button>
                <button id="enrollRetryBtn" type="button" hidden>Repetir</button>
              </div>
            </section>

            <aside class="enrollment-panel-card">
              <div id="enrollInstructionsPanel">
                <button id="enrollBackBtn" type="button">Volver</button>
                <p id="enrollReadinessMeta"></p>
                <div id="enrollCameraReadyItem">
                  <strong id="enrollCameraReadyText"></strong>
                  <span id="enrollCameraReadyBadge"></span>
                </div>
                <div id="enrollModelReadyItem">
                  <strong id="enrollModelReadyText"></strong>
                  <span id="enrollModelReadyBadge"></span>
                </div>
                <select id="enrollUserSelect"></select>
                <p id="enrollStartNote"></p>
                <button id="enrollStartBtn" type="button">Iniciar</button>
              </div>

              <div id="enrollStepsPanel" hidden>
                <strong id="enrollSummaryUser"></strong>
                <strong id="enrollSummaryPhase"></strong>
                <strong id="enrollSummaryTotal"></strong>
                <div id="enrollStepFocus">
                  <strong id="enrollActiveStepLabel"></strong>
                  <p id="enrollActiveStepHint"></p>
                  <span id="enrollActiveStepSamples"></span>
                  <span id="enrollActiveTotalSamples"></span>
                </div>
                <div id="enrollErrorBanner" class="is-hidden">
                  <strong id="enrollErrorTitle"></strong>
                  <p id="enrollErrorText"></p>
                </div>
                <ul id="enrollStepsList"></ul>
                <div id="enrollTotalProgress">
                  <div id="enrollTotalFill"></div>
                  <span id="enrollTotalLabel"></span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: 'https://example.test/admin#personas',
    },
  );

  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => canvasContext;
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.showAdminToast = vi.fn();
  window.showPersonasListMode = vi.fn();
  window.CameraPIAdminLayout = {
    getCurrentView: () => initialView,
  };
  window.confirm = vi.fn(confirmImpl);
  window.fetch = vi.fn(fetchImpl);

  window.eval(CONTROLLER_SOURCE);
  activeWindows.add(window);

  return {
    dom,
    window,
    document: window.document,
    canvasContext,
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  activeWindows.forEach((windowRef) => windowRef.close());
  activeWindows.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('enrollment controller', () => {
  it('rehydrates an active session when the view becomes active', async () => {
    const activeSnapshot = buildActiveSnapshot();
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(activeSnapshot);
      }
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollInstructionsPanel').hidden).toBe(true);
    expect(document.getElementById('enrollStepsPanel').hidden).toBe(false);
    expect(document.getElementById('enrollSummaryUser').textContent).toContain('Ada Lovelace');
    expect(document.getElementById('enrollPhasePill').textContent).toBe('Guiado');
    expect(document.getElementById('enrollRetryBtn').hidden).toBe(false);
    expect(fetchImpl).toHaveBeenCalledWith('/api/enrollment/status', expect.any(Object));
  });

  it('refetches the session snapshot when leaving and returning to the view', async () => {
    const activeSnapshot = buildActiveSnapshot();
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(activeSnapshot);
      }
      return createResponse({}, false, 404);
    });

    const { window } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    const firstStatusCalls = fetchImpl.mock.calls.filter(([url]) => url === '/api/enrollment/status').length;

    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'personas' } }));
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    const secondStatusCalls = fetchImpl.mock.calls.filter(([url]) => url === '/api/enrollment/status').length;
    expect(secondStatusCalls).toBeGreaterThan(firstStatusCalls);
  });

  it('auto-trains and finishes the session in completed review', async () => {
    const completedSnapshot = buildCompletedSnapshot();
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(completedSnapshot);
      }
      if (url === '/api/train') {
        return createResponse({ samples_used: 35, unique_users: 1 });
      }
      if (url === '/api/enrollment/finish') {
        return createResponse({ ok: true, finished: true, phase: 'preflight', state: 'idle' });
      }
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl, confirmImpl: () => true });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollCompletion').classList.contains('is-hidden')).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1510));
    await flushAsync();

    expect(window.confirm).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledWith('/api/train', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(fetchImpl).toHaveBeenCalledWith('/api/enrollment/finish', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(window.showPersonasListMode).toHaveBeenCalled();
  });

  it('starts enrollment programmatically after a person is preselected', async () => {
    const activeSnapshot = { ...buildActiveSnapshot(), ok: true };
    let started = false;
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(started ? activeSnapshot : { ...activeSnapshot, phase: 'preflight', state: 'idle', user_id: null });
      }
      if (url === '/api/enrollment/start') {
        started = true;
        return createResponse(activeSnapshot);
      }
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl });
    await window.CameraPIEnrollment.startForUser(7);
    await flushAsync();

    expect(fetchImpl).toHaveBeenCalledWith('/api/enrollment/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ user_id: 7 }),
    }));
    expect(document.getElementById('enrollInstructionsPanel').hidden).toBe(true);
    expect(document.getElementById('enrollSummaryUser').textContent).toContain('Ada Lovelace');
  });

  it('draws a dynamic face box instead of the fixed centered oval', async () => {
    const activeSnapshot = {
      ...buildActiveSnapshot(),
      guidance: {
        ...buildActiveSnapshot().guidance,
        face_bbox: { x: 0.18, y: 0.22, w: 0.24, h: 0.34 },
      },
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(activeSnapshot);
      }
      return createResponse({}, false, 404);
    });

    const { window, canvasContext } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();
    await flushAsync();

    expect(canvasContext.ellipse).not.toHaveBeenCalled();
    expect(canvasContext.strokeRect).toHaveBeenCalled();
  });
});
