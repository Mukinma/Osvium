import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

const ADMIN_LAYOUT_SOURCE = readFileSync(
  resolve(process.cwd(), 'frontend/static/js/admin-layout.js'),
  'utf8',
);

const DRAWER_QUERY = '(max-width: 1180px)';
const MOBILE_QUERY = '(max-width: 900px)';

const activeWindows = new Set();

function createMatchMediaController(window, initialMatches = {}) {
  const registry = new Map();

  function ensureQuery(query) {
    if (registry.has(query)) return registry.get(query);

    const listeners = new Set();
    const legacyListeners = new Set();
    const state = {
      matches: Boolean(initialMatches[query]),
      media: query,
      onchange: null,
    };

    const mql = {
      get matches() {
        return state.matches;
      },
      media: query,
      get onchange() {
        return state.onchange;
      },
      set onchange(handler) {
        state.onchange = handler;
      },
      addEventListener(eventName, handler) {
        if (eventName === 'change') listeners.add(handler);
      },
      removeEventListener(eventName, handler) {
        if (eventName === 'change') listeners.delete(handler);
      },
      addListener(handler) {
        legacyListeners.add(handler);
      },
      removeListener(handler) {
        legacyListeners.delete(handler);
      },
      dispatchEvent(event) {
        listeners.forEach((handler) => handler(event));
        legacyListeners.forEach((handler) => handler(event));
        if (typeof state.onchange === 'function') state.onchange(event);
        return true;
      },
    };

    const entry = { state, mql };
    registry.set(query, entry);
    return entry;
  }

  window.matchMedia = (query) => ensureQuery(query).mql;

  return {
    set(query, matches) {
      const entry = ensureQuery(query);
      entry.state.matches = matches;
      entry.mql.dispatchEvent({ matches, media: query });
    },
  };
}

function createAdminDom({
  hash = '',
  drawerMatches = false,
  mobileMatches = false,
} = {}) {
  const dom = new JSDOM(
    `<!doctype html>
    <html lang="es">
      <body class="admin-body">
        <div class="admin-layout-shell" id="adminShell">
          <aside class="admin-sidebar" id="adminSidebar" aria-label="Navegación principal">
            <div class="admin-rail">
              <div class="admin-sidebar__header">
                <button id="sidebarToggle" class="admin-sidebar__toggle" type="button"></button>
              </div>

              <nav class="admin-sidebar-nav" aria-label="Secciones principales">
                <div class="admin-nav-group">
                  <button class="admin-nav-btn" data-view="resumen" type="button">Resumen</button>
                  <button class="admin-nav-btn" data-view="personas" type="button">Personas</button>
                  <button class="admin-nav-btn" data-view="accesos" type="button">Accesos</button>
                </div>
                <div class="admin-nav-group admin-nav-group--secondary">
                  <button class="admin-nav-btn" data-view="sistema" type="button">Sistema</button>
                </div>
              </nav>

              <div class="admin-utility-dock" role="group" aria-label="Utilidades">
                <button type="button" data-logout-action>Salir</button>
              </div>
            </div>
          </aside>

          <header class="admin-topbar" aria-label="Barra superior">
            <div class="admin-topbar__left">
              <strong id="viewTitle" class="admin-topbar__view">Centro de control</strong>
            </div>
            <div class="admin-topbar__right">
              <div class="admin-topbar__actions" role="group" aria-label="Acciones rápidas">
                <button type="button" data-theme-toggle>Tema</button>
                <button type="button" data-logout-action>Salir</button>
              </div>
              <div class="admin-topbar__clock" aria-label="Hora actual">
                <strong id="adminClockTime">--:--</strong>
                <span id="adminClockDate">-- --- ----</span>
              </div>
            </div>
          </header>

          <button
            id="adminSidebarBackdrop"
            class="admin-sidebar-backdrop is-hidden"
            type="button"
            aria-label="Cerrar navegación lateral"
          ></button>

          <main class="admin-main" id="adminMain" aria-label="Área principal">
            <section class="admin-view" id="view-resumen"></section>
            <section class="admin-view" id="view-personas" hidden></section>
            <section class="admin-view" id="view-enrolamiento" hidden></section>
            <section class="admin-view" id="view-accesos" hidden></section>
            <section class="admin-view" id="view-sistema" hidden></section>
            <section class="admin-view" id="view-sistema-soporte" hidden></section>
          </main>
        </div>

        <form id="logoutFallbackForm" action="/auth/logout" method="post"></form>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: `https://example.test/admin${hash}`,
    },
  );

  const media = createMatchMediaController(dom.window, {
    [DRAWER_QUERY]: drawerMatches,
    [MOBILE_QUERY]: mobileMatches,
  });

  dom.window.eval(ADMIN_LAYOUT_SOURCE);
  activeWindows.add(dom.window);

  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    media,
  };
}

afterEach(() => {
  activeWindows.forEach((windowRef) => {
    windowRef.close();
  });
  activeWindows.clear();
});

describe('admin layout responsive shell', () => {
  it('uses drawer mode between 901px and 1180px', () => {
    const { document } = createAdminDom({
      drawerMatches: true,
      mobileMatches: false,
    });

    const shell = document.getElementById('adminShell');

    expect(shell.classList.contains('is-drawer-mode')).toBe(true);
    expect(shell.classList.contains('is-bottom-nav-mode')).toBe(false);
    expect(shell.classList.contains('admin-sidebar-collapsed')).toBe(true);
  });

  it('uses bottom nav mode at 900px and below', () => {
    const { document } = createAdminDom({
      drawerMatches: true,
      mobileMatches: true,
    });

    const shell = document.getElementById('adminShell');
    const sidebarToggle = document.getElementById('sidebarToggle');

    expect(shell.classList.contains('is-bottom-nav-mode')).toBe(true);
    expect(shell.classList.contains('is-drawer-mode')).toBe(false);
    expect(shell.classList.contains('admin-sidebar-collapsed')).toBe(false);
    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the drawer when switching into bottom nav mode', () => {
    const { window, document, media } = createAdminDom({
      drawerMatches: true,
      mobileMatches: false,
    });

    const shell = document.getElementById('adminShell');
    const backdrop = document.getElementById('adminSidebarBackdrop');

    window.CameraPIAdminLayout.openDrawer();
    expect(shell.classList.contains('admin-drawer-open')).toBe(true);
    expect(backdrop.classList.contains('is-hidden')).toBe(false);

    media.set(MOBILE_QUERY, true);

    expect(shell.classList.contains('admin-drawer-open')).toBe(false);
    expect(shell.classList.contains('is-bottom-nav-mode')).toBe(true);
    expect(backdrop.classList.contains('is-hidden')).toBe(true);
    expect(window.document.body.classList.contains('admin-drawer-open')).toBe(false);
  });

  it('marks personas active for enrolamiento in bottom nav mode', () => {
    const { document, window } = createAdminDom({
      hash: '#enrolamiento',
      drawerMatches: true,
      mobileMatches: true,
    });

    const personasButton = document.querySelector('[data-view="personas"]');
    const resumenButton = document.querySelector('[data-view="resumen"]');

    expect(window.CameraPIAdminLayout.getCurrentView()).toBe('enrolamiento');
    expect(personasButton.classList.contains('is-active')).toBe(true);
    expect(personasButton.getAttribute('aria-current')).toBe('page');
    expect(resumenButton.classList.contains('is-active')).toBe(false);
    expect(resumenButton.hasAttribute('aria-current')).toBe(false);
  });

  it('opens the soporte system subview from the hash', () => {
    const { document, window } = createAdminDom({
      hash: '#sistema-soporte',
      drawerMatches: true,
      mobileMatches: true,
    });

    const soporteSection = document.getElementById('view-sistema-soporte');
    const resumenSection = document.getElementById('view-resumen');
    const sistemaButton = document.querySelector('[data-view="sistema"]');

    expect(window.CameraPIAdminLayout.getCurrentView()).toBe('sistema-soporte');
    expect(soporteSection.hidden).toBe(false);
    expect(soporteSection.classList.contains('is-active')).toBe(true);
    expect(resumenSection.hidden).toBe(true);
    expect(sistemaButton.classList.contains('is-active')).toBe(true);
    expect(sistemaButton.getAttribute('aria-current')).toBe('page');
  });
});
