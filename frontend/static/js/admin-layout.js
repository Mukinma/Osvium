(function () {
  const shell = document.getElementById('adminShell');
  if (!shell) return;

  const sidebar = document.getElementById('adminSidebar');
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebarBackdrop = document.getElementById('adminSidebarBackdrop');
  const sidebarHeader = sidebar?.querySelector('.admin-sidebar__header');
  const sidebarNav = sidebar?.querySelector('.admin-sidebar-nav');
  const sidebarUtilityDock = sidebar?.querySelector('.admin-utility-dock');
  const logoutButtons = Array.from(shell.querySelectorAll('[data-logout-action]'));
  const logoutFallbackForm = document.getElementById('logoutFallbackForm');

  const viewTitle = document.getElementById('viewTitle');
  const adminClockTime = document.getElementById('adminClockTime');
  const adminClockDate = document.getElementById('adminClockDate');

  const viewButtons = Array.from(shell.querySelectorAll('[data-view]'));
  const viewSections = Array.from(document.querySelectorAll('.admin-view'));

  const drawerMedia = window.matchMedia('(max-width: 1180px)');
  const mobileMedia = window.matchMedia('(max-width: 900px)');

  const VIEW_META = {
    resumen: {
      title: 'Centro de control',
    },
    personas: {
      title: 'Personas',
    },
    enrolamiento: {
      title: 'Registrar rostro',
    },
    accesos: {
      title: 'Accesos',
    },
    sistema: {
      title: 'Sistema',
    },
    'sistema-diagnostico': {
      title: 'Diagnóstico',
    },
    'sistema-reconocimiento': {
      title: 'Reconocimiento',
    },
    'sistema-puerta': {
      title: 'Puerta',
    },
    'sistema-soporte': {
      title: 'Soporte',
    },
    'sistema-mantenimiento': {
      title: 'Mantenimiento',
    },
    'sistema-cuenta': {
      title: 'Cuenta',
    },
    'sistema-acerca': {
      title: 'Acerca de',
    },
    'sistema-avanzado': {
      title: 'Avanzado',
    },
  };

  const VALID_VIEWS = Object.keys(VIEW_META);
  const DEFAULT_VIEW = 'resumen';

  let currentView = DEFAULT_VIEW;
  let desktopExpanded = true;
  let chromeState = {
    scopeViewId: null,
    title: '',
  };
  let clockTimeoutId = null;
  let lastClockSignature = '';

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function csrfHeaders() {
    const token = getCsrfToken();
    return token ? { 'x-csrf-token': token } : {};
  }

  function isDrawerMode() {
    return drawerMedia.matches && !isBottomNavMode();
  }

  function isBottomNavMode() {
    return mobileMedia.matches;
  }

  function getHashView() {
    const raw = (window.location.hash || '').replace('#', '').split('?')[0].toLowerCase();
    return VALID_VIEWS.includes(raw) ? raw : DEFAULT_VIEW;
  }

  function navigateToView(viewId) {
    if (!VALID_VIEWS.includes(viewId)) viewId = DEFAULT_VIEW;
    window.location.hash = viewId;
  }

  function getViewMeta(viewId = currentView) {
    return VIEW_META[viewId] || VIEW_META[DEFAULT_VIEW];
  }

  function renderChrome() {
    const meta = getViewMeta(currentView);
    const title = chromeState.scopeViewId === currentView && chromeState.title
      ? chromeState.title
      : meta.title;

    shell.dataset.view = currentView;
    if (viewTitle) viewTitle.textContent = title;
  }

  function updateClock() {
    if (!adminClockTime || !adminClockDate) return;

    const now = new Date();
    const formattedTime = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const nextTimeLabel = formattedTime.replace(/\./g, '').toUpperCase();

    const dateParts = new Intl.DateTimeFormat('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).formatToParts(now);
    const day = dateParts.find((part) => part.type === 'day')?.value ?? '--';
    const month = dateParts.find((part) => part.type === 'month')?.value ?? '---';
    const year = dateParts.find((part) => part.type === 'year')?.value ?? '----';
    const nextDateLabel = `${day} ${month} ${year}`;
    const nextSignature = `${nextTimeLabel}|${nextDateLabel}`;

    if (nextSignature === lastClockSignature) return;

    adminClockTime.textContent = nextTimeLabel;
    adminClockDate.textContent = nextDateLabel;
    lastClockSignature = nextSignature;
  }

  function scheduleNextClockTick() {
    if (clockTimeoutId) window.clearTimeout(clockTimeoutId);

    const now = new Date();
    const msUntilNextMinute = ((59 - now.getSeconds()) * 1000) + (1000 - now.getMilliseconds()) + 20;
    clockTimeoutId = window.setTimeout(() => {
      updateClock();
      scheduleNextClockTick();
    }, msUntilNextMinute);
  }

  function startClock() {
    updateClock();
    scheduleNextClockTick();
  }

  function activateView(viewId) {
    currentView = VALID_VIEWS.includes(viewId) ? viewId : DEFAULT_VIEW;

    viewSections.forEach((section) => {
      const id = section.id.replace('view-', '');
      if (id === currentView) {
        section.hidden = false;
        section.classList.add('is-active');
        section.removeAttribute('aria-hidden');
      } else {
        section.hidden = true;
        section.classList.remove('is-active');
        section.setAttribute('aria-hidden', 'true');
      }
    });

    syncActiveViewButtons();

    renderChrome();
    window.dispatchEvent(new CustomEvent('admin:viewchange', { detail: { viewId: currentView } }));
  }

  function getActiveNavView(viewId = currentView) {
    if (shell.classList.contains('is-bottom-nav-mode') && viewId === 'enrolamiento') return 'personas';
    if (viewId.startsWith('sistema-')) return 'sistema';
    return viewId;
  }

  function syncActiveViewButtons() {
    const activeNavView = getActiveNavView();

    viewButtons.forEach((btn) => {
      const isActive = btn.getAttribute('data-view') === activeNavView;
      btn.classList.toggle('is-active', isActive);
      if (isActive) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
  }

  function setRegionState(region, hidden) {
    if (!region) return;
    region.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if ('inert' in region) region.inert = hidden;
  }

  function setSidebarInteractiveState() {
    if (!sidebar) return;
    const hiddenForDrawer = isDrawerMode() && !shell.classList.contains('admin-drawer-open');
    const bottomNavMode = shell.classList.contains('is-bottom-nav-mode');
    sidebar.setAttribute('aria-hidden', 'false');
    if ('inert' in sidebar) sidebar.inert = false;

    setRegionState(sidebarHeader, bottomNavMode);
    setRegionState(sidebarNav, hiddenForDrawer);
    setRegionState(sidebarUtilityDock, hiddenForDrawer || bottomNavMode);
  }

  function updateToggleState() {
    if (!sidebarToggle) return;
    const expanded = isBottomNavMode()
      ? false
      : isDrawerMode()
      ? shell.classList.contains('admin-drawer-open')
      : desktopExpanded;
    sidebarToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }

  function showBackdrop() {
    sidebarBackdrop?.classList.remove('is-hidden');
  }

  function hideBackdrop() {
    sidebarBackdrop?.classList.add('is-hidden');
  }

  function openDrawer() {
    if (!isDrawerMode()) return;
    shell.classList.add('admin-drawer-open');
    document.body.classList.add('admin-drawer-open');
    showBackdrop();
    updateToggleState();
    setSidebarInteractiveState();
  }

  function closeDrawer() {
    shell.classList.remove('admin-drawer-open');
    document.body.classList.remove('admin-drawer-open');
    hideBackdrop();
    updateToggleState();
    setSidebarInteractiveState();
  }

  function setCollapsed(collapsed) {
    shell.classList.toggle('admin-sidebar-collapsed', collapsed);
    updateToggleState();
  }

  function applyResponsiveLayout() {
    const bottomNavMode = isBottomNavMode();
    const drawerMode = isDrawerMode();

    shell.classList.toggle('is-drawer-mode', drawerMode);
    shell.classList.toggle('is-bottom-nav-mode', bottomNavMode);
    shell.classList.toggle('is-mobile', bottomNavMode);

    if (bottomNavMode) {
      closeDrawer();
      setCollapsed(false);
    } else if (drawerMode) {
      setCollapsed(true);
      closeDrawer();
    } else {
      closeDrawer();
      setCollapsed(!desktopExpanded);
    }

    setSidebarInteractiveState();
    syncActiveViewButtons();
    updateToggleState();
  }

  function toggleSidebar() {
    if (isBottomNavMode()) return;

    if (isDrawerMode()) {
      if (shell.classList.contains('admin-drawer-open')) closeDrawer();
      else openDrawer();
      return;
    }

    desktopExpanded = !desktopExpanded;
    setCollapsed(!desktopExpanded);
  }

  function clearStoredAuthState() {
    const themeStorageKey = window.CameraPITheme?.STORAGE_KEY || 'camerapi_theme';
    const authKeyPattern = /(token|auth|session|admin_user|current_user|jwt|bearer)/i;
    try {
      Object.keys(localStorage).forEach((key) => {
        if (key !== themeStorageKey && authKeyPattern.test(key)) localStorage.removeItem(key);
      });
    } catch (_) {}
    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (authKeyPattern.test(key)) sessionStorage.removeItem(key);
      });
    } catch (_) {}
  }

  async function logout() {
    clearStoredAuthState();
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error(`logout_http_${response.status}`);
      window.location.assign('/admin');
    } catch (_) {
      if (logoutFallbackForm) {
        logoutFallbackForm.submit();
        return;
      }
      window.location.assign('/admin');
    }
  }

  function updateChrome(payload = {}) {
    chromeState = {
      ...chromeState,
      ...payload,
      scopeViewId: payload.viewId || currentView,
    };
    renderChrome();
  }

  const attachMediaListener = (mq, handler) => {
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
  };

  function isEnrollmentCapturing() {
    const panel = document.getElementById('enrollStepsPanel');
    return currentView === 'enrolamiento' && panel !== null && !panel.hidden;
  }

  async function guardedNavigate(targetView) {
    if (isEnrollmentCapturing()) {
      const confirmFn = window.CameraPIConfirm?.open ?? ((opts) => Promise.resolve(window.confirm(opts.text)));
      const confirmed = await confirmFn({
        eyebrow: 'Registro en curso',
        title: '¿Salir del registro?',
        text: 'Las fotos capturadas hasta ahora se perderán. Tendrás que empezar de nuevo.',
        confirmLabel: 'Sí, salir',
        cancelLabel: 'Seguir registrando',
        tone: 'warning',
      });
      if (!confirmed) return;
    }
    navigateToView(targetView);
    if (isDrawerMode()) closeDrawer();
  }

  viewButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      guardedNavigate(btn.getAttribute('data-view'));
    });
  });

  shell.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      guardedNavigate(btn.getAttribute('data-quick'));
    });
  });

  logoutButtons.forEach((btn) => {
    btn.addEventListener('click', logout);
  });

  sidebarToggle?.addEventListener('click', toggleSidebar);
  sidebarBackdrop?.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && shell.classList.contains('admin-drawer-open')) closeDrawer();
  });

  attachMediaListener(drawerMedia, applyResponsiveLayout);
  attachMediaListener(mobileMedia, applyResponsiveLayout);
  document.addEventListener('visibilitychange', updateClock);
  window.addEventListener('focus', updateClock);
  window.addEventListener('hashchange', () => {
    activateView(getHashView());
  });

  window.logout = logout;
  window.CameraPIAdminLayout = {
    navigateToView,
    openDrawer,
    closeDrawer,
    toggleSidebar,
    logout,
    updateChrome,
    getCurrentView: () => currentView,
  };

  applyResponsiveLayout();
  activateView(getHashView());
  startClock();
})();
