import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const LOGIN_SOURCE = readFileSync(
  resolve(process.cwd(), 'frontend/static/js/login.js'),
  'utf8',
);

const activeWindows = new Set();

function createLoginDom({ recoveryPhone = '+52 314 616 1661' } = {}) {
  const dom = new JSDOM(
    `<!doctype html>
    <html>
      <body>
        <form class="login-card" action="/auth/login" method="post" data-recovery-phone="${recoveryPhone}">
          <div class="login-head">
            <h1 id="loginTitle">Inicio de sesión</h1>
            <p class="login-sub" id="loginSubtitle">Ingresa tu contraseña para continuar.</p>
          </div>
          <div class="login-error" role="alert">Credenciales invalidas.</div>
          <input type="hidden" name="username" value="admin" />
          <div class="field-group">
            <label for="password">Contraseña</label>
            <input id="password" type="password" name="password" required />
          </div>
          <div class="login-actions">
            <button type="submit" class="login-submit">Entrar</button>
          </div>
          <button class="login-recover-link" type="button">¿Olvidaste tu contraseña?</button>
          <section class="login-recovery-view is-hidden" id="loginRecoveryPanel" hidden>
            <h2>Recuperar acceso</h2>
            <p id="loginRecoveryText"></p>
            <strong id="loginRecoveryPhone"></strong>
            <button id="loginRecoveryBack" type="button">Volver a iniciar sesión</button>
          </section>
        </form>
        <div class="login-access-overlay"></div>
      </body>
    </html>`,
    {
      runScripts: 'outside-only',
      url: 'https://example.test/admin',
      pretendToBeVisual: true,
    },
  );

  const { window } = dom;
  window.matchMedia = () => ({ matches: false });
  window.fetch = vi.fn();
  window.i18n = { t: (value) => value };

  global.window = window;
  global.document = window.document;
  global.fetch = window.fetch;
  activeWindows.add(window);

  window.eval(LOGIN_SOURCE);

  return dom;
}

afterEach(() => {
  activeWindows.forEach((windowRef) => windowRef.close());
  activeWindows.clear();
  vi.restoreAllMocks();
  delete global.window;
  delete global.document;
  delete global.fetch;
});

describe('login password recovery', () => {
  it('switches the login card to recovery information with the manufacturer phone', () => {
    const dom = createLoginDom();
    const document = dom.window.document;

    document.querySelector('.login-recover-link').click();

    expect(document.querySelector('.login-head').hidden).toBe(true);
    expect(document.querySelector('.field-group').hidden).toBe(true);
    expect(document.querySelector('.login-actions').hidden).toBe(true);
    expect(document.querySelector('.login-error').hidden).toBe(true);
    expect(document.getElementById('loginRecoveryPanel').hidden).toBe(false);
    expect(document.getElementById('loginRecoveryPanel').classList.contains('login-recovery-panel')).toBe(false);
    expect(document.getElementById('loginRecoveryPanel').classList.contains('login-recovery-view')).toBe(true);
    expect(document.getElementById('loginRecoveryText').textContent).toContain('centro encargado');
    expect(document.getElementById('loginRecoveryPhone').textContent).toBe('+52 314 616 1661');
    expect(document.getElementById('loginRecoveryPhone').getAttribute('href')).toBe('tel:+523146161661');
  });

  it('restores the password form from recovery mode', () => {
    const dom = createLoginDom();
    const document = dom.window.document;

    document.querySelector('.login-recover-link').click();
    document.getElementById('loginRecoveryBack').click();

    expect(document.querySelector('.login-head').hidden).toBe(false);
    expect(document.querySelector('.field-group').hidden).toBe(false);
    expect(document.querySelector('.login-actions').hidden).toBe(false);
    expect(document.getElementById('loginRecoveryPanel').hidden).toBe(true);
  });
});
