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
    total_steps: 3,
    step_name: 'cabello_recogido',
    step_label: 'Cabello recogido',
    step_icon: 'circle-dot',
    appearance_variant: 'cabello_recogido',
    samples_this_step: 2,
    samples_needed: 12,
    total_captured: 14,
    total_needed: 36,
    steps_summary: [
      { name: 'normal', label: 'Rostro normal', icon: 'circle-dot', appearance_variant: 'normal', status: 'complete', samples: 12, needed: 12 },
      { name: 'cabello_recogido', label: 'Cabello recogido', icon: 'circle-dot', appearance_variant: 'cabello_recogido', status: 'active', samples: 2, needed: 12 },
      { name: 'casco', label: 'Con casco', icon: 'circle-dot', appearance_variant: 'casco', status: 'pending', samples: 0, needed: 12 },
    ],
    guidance: {
      instruction: 'Cabello recogido',
      hint: 'Mantén el rostro visible y espera la captura',
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
    awaiting_continue: false,
    continue_title: 'Ahora con el cabello recogido',
    continue_hint: 'Colócate frente a la cámara',
    continue_action_label: 'Continuar',
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
    arc: vi.fn(),
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
                <article id="enrollStepGuide">
                  <div id="enrollStepGuideIcon"></div>
                  <strong id="enrollStepGuideTitle"></strong>
                </article>
                <button id="enrollContinueOverlay" class="is-hidden" type="button">
                  <span id="enrollContinueIcon"></span>
                  <strong id="enrollContinueTitle"></strong>
                  <span id="enrollContinueHint"></span>
                  <span id="enrollContinueAction"></span>
                </button>
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

  it('shows a visible guided step card for the hair-tied variant', async () => {
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

    expect(document.getElementById('enrollStepGuide').hidden).toBe(false);
    expect(document.getElementById('enrollStepGuideTitle').textContent).toBe('Cabello recogido');
    expect(document.getElementById('enrollStepGuide').textContent).not.toContain('foto');
    expect(document.getElementById('enrollStepGuide').textContent).not.toContain('Paso');
    expect(document.getElementById('enrollStepGuideIcon').querySelector('[data-step-icon="comb-inline"]')).not.toBeNull();
    expect(document.getElementById('enrollTotalLabel').textContent).toBe('14 de 36 fotos');
  });

  it('shows the first guided step as a normal face capture', async () => {
    const activeSnapshot = {
      ...buildActiveSnapshot(),
      current_step: 0,
      step_name: 'normal',
      step_label: 'Rostro normal',
      step_icon: 'circle-dot',
      appearance_variant: 'normal',
      samples_this_step: 0,
      total_captured: 0,
      steps_summary: [
        { name: 'normal', label: 'Rostro normal', icon: 'circle-dot', appearance_variant: 'normal', status: 'active', samples: 0, needed: 12 },
        { name: 'cabello_recogido', label: 'Cabello recogido', icon: 'circle-dot', appearance_variant: 'cabello_recogido', status: 'pending', samples: 0, needed: 12 },
        { name: 'casco', label: 'Con casco', icon: 'circle-dot', appearance_variant: 'casco', status: 'pending', samples: 0, needed: 12 },
      ],
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

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollStepGuideTitle').textContent).toBe('Rostro normal');
    expect(document.getElementById('enrollStepGuideIcon').querySelector('[data-step-icon="normal"]')).not.toBeNull();
  });

  it('uses a helmet step card for the hard-hat variant even when backend sends the generic icon', async () => {
    const activeSnapshot = {
      ...buildActiveSnapshot(),
      current_step: 2,
      step_name: 'casco',
      step_label: 'Con casco',
      step_icon: 'circle-dot',
      appearance_variant: 'casco',
      samples_this_step: 0,
      total_captured: 24,
      steps_summary: [
        { name: 'normal', label: 'Rostro normal', icon: 'circle-dot', appearance_variant: 'normal', status: 'complete', samples: 12, needed: 12 },
        { name: 'cabello_recogido', label: 'Cabello recogido', icon: 'circle-dot', appearance_variant: 'cabello_recogido', status: 'complete', samples: 12, needed: 12 },
        { name: 'casco', label: 'Con casco', icon: 'circle-dot', appearance_variant: 'casco', status: 'active', samples: 0, needed: 12 },
      ],
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

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollStepGuideTitle').textContent).toBe('Con casco');
    expect(document.getElementById('enrollStepGuideIcon').querySelector('[data-step-icon="helmet-inline"]')).not.toBeNull();
  });

  it('shows a large manual continue overlay before the normal capture starts', async () => {
    const pausedSnapshot = {
      ...buildActiveSnapshot(),
      current_step: 0,
      state: 'awaiting_continue',
      step_name: 'normal',
      step_label: 'Rostro normal',
      appearance_variant: 'normal',
      samples_this_step: 0,
      total_captured: 0,
      awaiting_continue: true,
      continue_title: 'Capturar rostro normal',
      continue_hint: 'Colócate frente a la cámara',
      continue_action_label: 'Continuar',
      steps_summary: [
        { name: 'normal', label: 'Rostro normal', icon: 'circle-dot', appearance_variant: 'normal', status: 'active', samples: 0, needed: 12 },
        { name: 'cabello_recogido', label: 'Cabello recogido', icon: 'circle-dot', appearance_variant: 'cabello_recogido', status: 'pending', samples: 0, needed: 12 },
        { name: 'casco', label: 'Con casco', icon: 'circle-dot', appearance_variant: 'casco', status: 'pending', samples: 0, needed: 12 },
      ],
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') {
        return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      }
      if (url === '/api/status') {
        return createResponse({ camera: 'online', model: 'loaded' });
      }
      if (url === '/api/enrollment/status') {
        return createResponse(pausedSnapshot);
      }
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollContinueOverlay').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('enrollContinueTitle').textContent).toBe('Capturar rostro normal');
    expect(document.getElementById('enrollContinueHint').textContent).toBe('Colócate frente a la cámara');
    expect(document.getElementById('enrollContinueAction').textContent).toBe('Continuar');
    expect(document.getElementById('enrollContinueIcon').querySelector('[data-step-icon="normal"]')).not.toBeNull();
  });

  it('continues the paused enrollment when the overlay is tapped', async () => {
    const pausedSnapshot = {
      ...buildActiveSnapshot(),
      state: 'awaiting_continue',
      awaiting_continue: true,
      continue_title: 'Ahora con el cabello recogido',
      continue_hint: 'Colócate frente a la cámara',
      continue_action_label: 'Continuar',
    };
    const resumedSnapshot = {
      ...buildActiveSnapshot(),
      state: 'step_active',
      awaiting_continue: false,
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      if (url === '/api/status') return createResponse({ camera: 'online', model: 'loaded' });
      if (url === '/api/enrollment/status') return createResponse(pausedSnapshot);
      if (url === '/api/enrollment/continue') return createResponse({ ...resumedSnapshot, ok: true });
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    document.getElementById('enrollContinueOverlay').click();
    await flushAsync();

    expect(fetchImpl).toHaveBeenCalledWith('/api/enrollment/continue', expect.objectContaining({ method: 'POST' }));
    expect(document.getElementById('enrollContinueOverlay').classList.contains('is-hidden')).toBe(true);
  });

  it('shows the hair-tied continue overlay when that step is paused', async () => {
    const pausedSnapshot = {
      ...buildActiveSnapshot(),
      state: 'awaiting_continue',
      awaiting_continue: true,
      continue_title: 'Ahora con el cabello recogido',
      continue_hint: 'Colócate frente a la cámara',
      continue_action_label: 'Continuar',
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === '/api/users') return createResponse([{ id: 7, nombre: 'Ada Lovelace' }]);
      if (url === '/api/status') return createResponse({ camera: 'online', model: 'loaded' });
      if (url === '/api/enrollment/status') return createResponse(pausedSnapshot);
      return createResponse({}, false, 404);
    });

    const { window, document } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();

    expect(document.getElementById('enrollContinueTitle').textContent).toBe('Ahora con el cabello recogido');
    expect(document.getElementById('enrollContinueIcon').querySelector('[data-step-icon="comb-inline"]')).not.toBeNull();
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
    const finishCall = fetchImpl.mock.invocationCallOrder[
      fetchImpl.mock.calls.findIndex(([url]) => url === '/api/enrollment/finish')
    ];
    const trainCall = fetchImpl.mock.invocationCallOrder[
      fetchImpl.mock.calls.findIndex(([url]) => url === '/api/train')
    ];
    expect(finishCall).toBeLessThan(trainCall);
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

  it('draws the blue depth field instead of a rectangular face box', async () => {
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

    const { window, document, canvasContext } = createDom({ fetchImpl });
    window.dispatchEvent(new window.CustomEvent('admin:viewchange', { detail: { viewId: 'enrolamiento' } }));
    await flushAsync();
    await flushAsync();

    expect(canvasContext.ellipse).not.toHaveBeenCalled();
    expect(canvasContext.strokeRect).not.toHaveBeenCalled();
    expect(canvasContext.arc).toHaveBeenCalled();
    expect(canvasContext.lineTo).toHaveBeenCalled();
    const overlay = document.getElementById('enrollOverlay');
    const faceWidth = 0.24 * overlay.width;
    const faceHeight = 0.34 * overlay.height;
    const oldRadius = Math.max(faceWidth, faceHeight) * 0.82;
    expect(canvasContext.arc.mock.calls[0][2]).toBeCloseTo((oldRadius + faceHeight / 2) / 2, 4);
  });
});
