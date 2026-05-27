import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const ADMIN_SOURCE = readFileSync(
  resolve(process.cwd(), 'frontend/static/js/admin.js'),
  'utf8',
);

const activeWindows = new Set();

function createResponse(data, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    async json() {
      return data;
    },
    async text() {
      return typeof data === 'string' ? data : JSON.stringify(data);
    },
  };
}

function createAdminDom({ users = [], config = {} } = {}) {
  const dom = new JSDOM(
    `<!doctype html>
    <html lang="es">
      <head>
        <meta name="csrf-token" content="csrf-token" />
        <meta name="admin-user" content="admin" />
      </head>
      <body>
        <main>
          <input id="newUserName" />
          <button id="createUserBtn" type="button">Crear</button>
          <p id="createResult" hidden></p>
          <p id="personasListSummary"></p>
          <input id="userSearch" />
          <div id="usersList"></div>
          <aside id="personDetailPanel" hidden></aside>
          <div id="logsList"></div>

          <span id="statToday"></span><span id="statGranted"></span><span id="statDenied"></span><span id="statManual"></span>
          <section id="resumenHero"><div class="resumen-layout"></div></section>
          <span id="resumenStatusChip"></span><span id="resumenStatusLabel"></span><span id="resumenStatusTitle"></span>
          <span id="resumenStatusMeta"></span><span id="resumenStatusCaption"></span>
          <div id="resumenInlineAlert" hidden><span id="resumenInlineAlertBadge"></span><span id="resumenInlineAlertText"></span></div>
          <span id="resumenMetricActiveUsers"></span><span id="resumenMetricToday"></span><span id="resumenMetricSuccess"></span><span id="resumenMetricManual"></span>
          <span id="resumenActionHint"></span>
          <div id="resumenActionStack">
            <button id="resumenActionAccesos" data-quick="accesos" type="button"></button>
            <button id="resumenActionPersonas" data-quick="personas" type="button"></button>
          </div>

          <select id="logFilterResult"></select>
          <button id="logAdvancedToggle" type="button"></button>
          <div id="logAdvancedPanel" hidden></div>
          <button id="logAdvancedReset" type="button"></button>
          <input id="logSearch" /><input id="logDateFrom" /><input id="logDateTo" />
          <input id="logConfidenceMin" /><input id="logConfidenceMax" />

          <input id="cfgThreshold" />
          <div id="recogSegment"></div>
          <span id="recogPresetSummary"></span><span id="recogCustomValue"></span>
          <span id="maxAttemptsValue"></span><span id="openSecValue"></span><span id="doorTimeSummary"></span>
          <input id="supportPhoneInput" />
          <span id="supportPhoneSummary"></span>
          <button id="supportPhoneApplyBtn" type="button"></button>
          <span id="diagnosticsSummary"></span><span id="diagnosticsRootIcon"></span><div id="diagnosticsDetailList"></div>
          <span id="accountDisplayName"></span><span id="accountUsernameSummary"></span>
          <button id="manualOpenAdminBtn" type="button"></button>
          <button id="purgeLegacySamplesBtn" type="button"></button>

          <div id="adminToast" class="is-hidden"><span id="adminToastText"></span><span id="adminToastSub"></span></div>
          <div id="adminDialog" class="is-hidden" aria-hidden="true">
            <button id="adminDialogBackdrop" type="button"></button>
            <section id="adminDialogPanel" tabindex="-1">
              <p id="adminDialogEyebrow"></p><h2 id="adminDialogTitle"></h2><p id="adminDialogText"></p>
              <button id="adminDialogCancel" type="button"></button><button id="adminDialogConfirm" type="button"></button>
            </section>
          </div>
        </main>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: 'https://example.test/admin#personas',
    },
  );

  const { window } = dom;
  const savedConfig = {
    umbral_confianza: 70,
    tiempo_apertura_seg: 5,
    max_intentos: 3,
    support_phone: '',
    ...config,
  };

  window.i18n = { t: (value) => value };
  window.CameraPITheme = { initTheme: vi.fn(), bindToggleButtons: vi.fn() };
  window.CameraPIAdminLayout = { navigateToView: vi.fn() };
  window.CameraPIEnrollment = { reset: vi.fn(), startForUser: vi.fn(async () => {}) };
  window.requestAnimationFrame = (callback) => window.setTimeout(callback, 0);
  window.setInterval = vi.fn();
  window.fetch = vi.fn(async (url, options = {}) => {
    if (url === '/api/users' && options.method === 'POST') return createResponse({ id: 12 });
    if (url === '/api/users') return createResponse(users);
    if (typeof url === 'string' && url.startsWith('/api/users/')) {
      const userId = Number(url.split('/')[3]);
      const user = users.find((candidate) => Number(candidate.id) === userId);
      if (user) return createResponse({ user, samples_count: user.samples_count || 0, recent_logs: [] });
    }
    if (url === '/api/access-logs?limit=200') return createResponse([]);
    if (url === '/api/status') return createResponse({ camera: 'online', model: 'loaded', door: 'ready' });
    if (url === '/api/config' && options.method === 'PUT') {
      Object.assign(savedConfig, JSON.parse(options.body || '{}'));
      return createResponse(savedConfig);
    }
    if (url === '/api/config') return createResponse(savedConfig);
    if (url === '/api/face-samples/purge-legacy' && options.method === 'POST') {
      return createResponse({ ok: true, deleted_files: 4, deleted_samples: 4, model_removed: true });
    }
    if (url === '/api/system/diagnostics') return createResponse({ summary: 'Todo en orden', all_ok: true, checks: {} });
    return createResponse({}, false, 404);
  });

  window.eval(ADMIN_SOURCE);
  activeWindows.add(window);
  return { window, document: window.document };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  activeWindows.forEach((windowRef) => windowRef.close());
  activeWindows.clear();
  vi.restoreAllMocks();
});

describe('admin personas redesigned UX', () => {
  it('renders visual person cards with thumbnail and primary action instead of a table', async () => {
    const { document } = createAdminDom({
      users: [
        {
          id: 7,
          nombre: 'Ada Lovelace',
          activo: true,
          samples_count: 35,
          needs_training: false,
          thumbnail_url: '/api/users/7/thumbnail',
          last_access_result: 'AUTORIZADO',
        },
      ],
    });

    await flushAsync();

    expect(document.querySelector('#usersList table')).toBeNull();
    const card = document.querySelector('[data-person-card="7"]');
    expect(card).not.toBeNull();
    expect(card.querySelector('img').getAttribute('src')).toBe('/api/users/7/thumbnail');
    expect(card.querySelector('.person-card__name').textContent).toContain('Ada Lovelace');
    expect(card.querySelector('.person-card__primary').textContent).toContain('Ver');
  });

  it('creates a person and immediately starts guided enrollment', async () => {
    const { document, window } = createAdminDom();
    await flushAsync();

    document.getElementById('newUserName').value = 'Grace Hopper';
    document.getElementById('createUserBtn').click();
    await flushAsync();
    await flushAsync();

    expect(window.fetch).toHaveBeenCalledWith('/api/users', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ nombre: 'Grace Hopper' }),
    }));
    expect(window.CameraPIAdminLayout.navigateToView).toHaveBeenCalledWith('enrolamiento');
    expect(window.CameraPIEnrollment.startForUser).toHaveBeenCalledWith(12);
  });

  it('keeps the person detail primary action aligned with inactive state', async () => {
    const { document, window } = createAdminDom({
      users: [
        {
          id: 4,
          nombre: 'Mario Ruiz',
          activo: false,
          samples_count: 0,
          needs_training: true,
          thumbnail_url: null,
        },
      ],
    });

    await flushAsync();
    await window.openPersonDetail(4);
    await flushAsync();

    const detailActions = document.querySelector('.person-detail-actions');
    expect(detailActions.querySelector('.btn-primary').textContent).toContain('Activar');
    expect(detailActions.textContent).not.toContain('Registrar rostro');
    expect(detailActions.textContent).not.toContain('Entrenar');
    expect([...document.querySelectorAll('#personDetailPanel button')]
      .filter((button) => button.textContent.includes('Activar'))).toHaveLength(1);
  });

  it('loads and saves the configurable support phone', async () => {
    const { document, window } = createAdminDom({
      config: { support_phone: '+52 55 1111 2222' },
    });
    await flushAsync();

    expect(document.getElementById('supportPhoneInput').value).toBe('+52 55 1111 2222');
    expect(document.getElementById('supportPhoneSummary').textContent).toBe('+52 55 1111 2222');

    document.getElementById('supportPhoneInput').value = '+52 55 3333 4444';
    document.getElementById('supportPhoneApplyBtn').click();
    await new Promise((resolve) => setTimeout(resolve, 410));
    await flushAsync();

    expect(window.fetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({
        umbral_confianza: 70,
        tiempo_apertura_seg: 5,
        max_intentos: 3,
        support_phone: '+52 55 3333 4444',
      }),
    }));
    expect(document.getElementById('supportPhoneSummary').textContent).toBe('+52 55 3333 4444');
  });

  it('confirms and purges legacy face samples from maintenance', async () => {
    const { document, window } = createAdminDom();
    await flushAsync();

    document.getElementById('purgeLegacySamplesBtn').click();
    await flushAsync();

    expect(document.getElementById('adminDialog').classList.contains('is-hidden')).toBe(false);
    expect(document.getElementById('adminDialogTitle').textContent).toContain('Borrar muestras');
    expect(window.fetch).not.toHaveBeenCalledWith('/api/face-samples/purge-legacy', expect.anything());

    document.getElementById('adminDialogConfirm').click();
    await flushAsync();
    await flushAsync();

    expect(window.fetch).toHaveBeenCalledWith('/api/face-samples/purge-legacy', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'x-csrf-token': 'csrf-token' }),
    }));
    expect(window.fetch).toHaveBeenCalledWith('/api/users', expect.any(Object));
    expect(window.fetch).toHaveBeenCalledWith('/api/status', expect.any(Object));
    expect(document.getElementById('adminToastText').textContent).toBe('Muestras borradas');
  });
});
