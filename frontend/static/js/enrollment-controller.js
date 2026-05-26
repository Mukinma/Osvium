/**
 * enrollment-controller.js
 *
 * Backend-driven enrollment UI. The server is the only source of truth for
 * session state; the frontend only rehydrates, renders and performs actions.
 */

(function () {
  const STEP_PREVIEW = [
    { name: 'center', label: 'Mira de frente', icon: 'circle-dot' },
  ];

  const POLL_MS = 350;

  function tr(text) {
    try { return (window.i18n && typeof window.i18n.t === 'function') ? window.i18n.t(text) : text; }
    catch (_) { return text; }
  }

  const viewport = document.getElementById('enrollViewport');
  const stream = document.getElementById('enrollStream');
  const overlay = document.getElementById('enrollOverlay');
  const hud = document.getElementById('enrollHud');
  const stepBadge = document.getElementById('enrollStepBadge');
  const stepCounter = document.getElementById('enrollStepCounter');
  const instruction = document.getElementById('enrollInstruction');
  const message = document.getElementById('enrollMessage');
  const phasePill = document.getElementById('enrollPhasePill');
  const currentSamplesPill = document.getElementById('enrollCurrentSamples');
  const userMeta = document.getElementById('enrollUserMeta');
  const dotsContainer = document.getElementById('enrollDots');
  const faceWarning = document.getElementById('enrollFaceWarning');
  const faceWarningText = document.getElementById('enrollFaceWarningText');
  const lightWarning = document.getElementById('enrollLightWarning');
  const multiFaceWarning = document.getElementById('enrollMultiFaceWarning');
  const glassesWarning = document.getElementById('enrollGlassesWarning');
  const flash = document.getElementById('enrollFlash');
  const completion = document.getElementById('enrollCompletion');
  const completionSub = document.getElementById('enrollCompletionSub');
  const abortBtn = document.getElementById('enrollAbortBtn');
  const retryBtn = document.getElementById('enrollRetryBtn');
  const startBtn = document.getElementById('enrollStartBtn');
  const trainBtn = document.getElementById('enrollTrainBtn');
  const finishBtn = document.getElementById('enrollFinishBtn');
  const userSelect = document.getElementById('enrollUserSelect');
  const instructionsPanel = document.getElementById('enrollInstructionsPanel');
  const stepsPanel = document.getElementById('enrollStepsPanel');
  const stepsList = document.getElementById('enrollStepsList');
  const totalFill = document.getElementById('enrollTotalFill');
  const totalLabel = document.getElementById('enrollTotalLabel');
  const totalProgress = document.getElementById('enrollTotalProgress');
  const backBtn = document.getElementById('enrollBackBtn');
  const startNote = document.getElementById('enrollStartNote');
  const summaryUser = document.getElementById('enrollSummaryUser');
  const summaryPhase = document.getElementById('enrollSummaryPhase');
  const summaryTotal = document.getElementById('enrollSummaryTotal');
  const activeStepLabel = document.getElementById('enrollActiveStepLabel');
  const activeStepHint = document.getElementById('enrollActiveStepHint');
  const activeStepSamples = document.getElementById('enrollActiveStepSamples');
  const activeTotalSamples = document.getElementById('enrollActiveTotalSamples');
  const stepFocus = document.getElementById('enrollStepFocus');
  const errorBanner = document.getElementById('enrollErrorBanner');
  const errorTitle = document.getElementById('enrollErrorTitle');
  const errorText = document.getElementById('enrollErrorText');
  const readinessMeta = document.getElementById('enrollReadinessMeta');
  const cameraReadyItem = document.getElementById('enrollCameraReadyItem');
  const cameraReadyText = document.getElementById('enrollCameraReadyText');
  const cameraReadyBadge = document.getElementById('enrollCameraReadyBadge');
  const modelReadyItem = document.getElementById('enrollModelReadyItem');
  const modelReadyText = document.getElementById('enrollModelReadyText');
  const modelReadyBadge = document.getElementById('enrollModelReadyBadge');

  if (!viewport || !overlay || !userSelect) return;

  const doc = viewport.ownerDocument || document;
  const canvasCtx = typeof overlay.getContext === 'function' ? overlay.getContext('2d') : null;

  let enrollmentStatus = buildFallbackIdleStatus();
  let systemStatus = null;
  let pollTimerId = null;
  let pollInFlight = false;
  let isViewActive = false;
  let isStarting = false;
  let isTraining = false;
  let isAutoFinishing = false;
  let pendingUserId = null;
  let enterViewPromise = null;
  let animFrame = null;

  function buildFallbackIdleStatus() {
    return {
      phase: 'preflight',
      state: 'idle',
      user_id: null,
      user_name: null,
      current_step: null,
      total_steps: STEP_PREVIEW.length,
      step_name: null,
      step_label: null,
      step_icon: null,
      samples_this_step: 0,
      samples_needed: 20,
      total_captured: 0,
      total_needed: STEP_PREVIEW.length * 20,
      steps_summary: STEP_PREVIEW.map((step) => ({
        ...step,
        status: 'pending',
        samples: 0,
        needed: 5,
      })),
      guidance: {
        instruction: 'Selecciona una persona para iniciar',
        hint: 'Prepara la iluminacion y centra el rostro antes de comenzar.',
        arrow: null,
        hold_progress: 0,
        pose_matched: false,
        face_detected: false,
        brightness_ok: true,
        multiple_faces: false,
        glasses_detected: false,
      },
      actions: {
        can_retry: false,
        can_abort: false,
        can_finish: false,
        can_train: false,
      },
      started_at: null,
      updated_at: null,
    };
  }

  function isActivePhase(status = enrollmentStatus) {
    return status?.phase === 'active';
  }

  function isCompletedPhase(status = enrollmentStatus) {
    return status?.phase === 'completed_review';
  }

  function isRecoverableError(status = enrollmentStatus) {
    return status?.phase === 'recoverable_error';
  }

  function getCurrentSelectedUserId() {
    return String(userSelect?.value || pendingUserId || '').trim();
  }

  function resizeCanvas() {
    const rect = viewport.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
  }

  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  }

  function withSecurityHeaders(options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const token = getCsrfToken();
    if (token && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['x-csrf-token'] = token;
    }
    return headers;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: withSecurityHeaders(options),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  async function api(url, options = {}) {
    const result = await requestJson(url, options);
    if (!result.ok) {
      throw new Error(result.data?.detail || result.data?.error || `HTTP ${result.status}`);
    }
    return result.data;
  }

  async function loadUsers() {
    try {
      const users = await api('/api/users');
      const current = getCurrentSelectedUserId();
      userSelect.innerHTML = `<option value="">${tr('Seleccionar persona...')}</option>`;
      users.forEach((user) => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.nombre} (ID: ${user.id})`;
        userSelect.appendChild(option);
      });
      if (current) userSelect.value = current;
      pendingUserId = userSelect.value || pendingUserId;
    } catch (error) {
      showAdminToastSafe({
        text: 'No se pudieron cargar las personas',
        sub: error.message,
        cls: 'error',
      });
    }
  }

  async function loadSystemStatus() {
    try {
      systemStatus = await api('/api/status');
      renderSystemReadiness();
      return systemStatus;
    } catch (error) {
      systemStatus = null;
      renderSystemReadiness();
      showAdminToastSafe({
        text: 'No se pudo verificar el sistema',
        sub: error.message,
        cls: 'warning',
      });
      return null;
    }
  }

  async function fetchEnrollmentStatus() {
    const status = await api('/api/enrollment/status');
    applySnapshot(status);
    return status;
  }

  function stopPolling() {
    if (pollTimerId) {
      clearTimeout(pollTimerId);
      pollTimerId = null;
    }
  }

  function scheduleNextPoll(delay = POLL_MS) {
    if (!isViewActive || !isActivePhase()) {
      stopPolling();
      return;
    }

    stopPolling();
    pollTimerId = window.setTimeout(runPoll, delay);
  }

  async function runPoll() {
    if (!isViewActive || !isActivePhase() || pollInFlight) return;
    pollInFlight = true;

    try {
      const status = await fetchEnrollmentStatus();
      if (isActivePhase(status)) {
        scheduleNextPoll(POLL_MS);
      } else {
        stopPolling();
      }
    } catch (error) {
      stopPolling();
      showAdminToastSafe({
        text: 'Se perdio la sesion de enrolamiento',
        sub: error.message,
        cls: 'error',
        timeout: 3400,
      });
    } finally {
      pollInFlight = false;
    }
  }

  function clearCanvas() {
    if (!canvasCtx) return;
    resizeCanvas();
    canvasCtx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function scheduleOverlayDraw() {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(drawOverlay);
  }

  function drawArrow(ctx, cx, cy, r, _unused, direction) {
    const time = Date.now();
    const bounce = Math.sin(time / 200) * 6;
    const arrowSize = 18;
    let ax;
    let ay;
    let angle;

    switch (direction) {
      case 'left':
        ax = cx - r - 30 + bounce;
        ay = cy;
        angle = Math.PI;
        break;
      case 'right':
        ax = cx + r + 30 - bounce;
        ay = cy;
        angle = 0;
        break;
      case 'up':
        ax = cx;
        ay = cy - r - 30 + bounce;
        angle = -Math.PI / 2;
        break;
      case 'down':
        ax = cx;
        ay = cy + r + 30 - bounce;
        angle = Math.PI / 2;
        break;
      default:
        return;
    }

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(arrowSize, 0);
    ctx.lineTo(-arrowSize * 0.4, -arrowSize * 0.6);
    ctx.lineTo(-arrowSize * 0.4, arrowSize * 0.6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.82)';
    ctx.shadowColor = 'rgba(245, 158, 11, 0.42)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }

  function drawOverlay() {
    if (!canvasCtx) return;
    resizeCanvas();
    const width = overlay.width;
    const height = overlay.height;
    const guidance = enrollmentStatus.guidance || {};
    const ctx = canvasCtx;

    ctx.clearRect(0, 0, width, height);

    if (!isActivePhase() || !guidance) return;

    const cx = width * 0.5;
    const cy = height * 0.42;
    const r = Math.min(width, height) * 0.28;

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r, 0, 0, Math.PI * 2);

    if (guidance.multiple_faces) {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.78)';
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(239, 68, 68, 0.36)';
      ctx.shadowBlur = 14;
    } else if (!guidance.face_detected) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.42)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
    } else if (!guidance.brightness_ok) {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.78)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.32)';
      ctx.shadowBlur = 10;
    } else if (guidance.pose_matched) {
      if (enrollmentStatus.state === 'holding' || enrollmentStatus.state === 'capturing') {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.82)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(34, 197, 94, 0.4)';
        ctx.shadowBlur = 16;
      } else {
        ctx.strokeStyle = 'rgba(91, 140, 255, 0.72)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(91, 140, 255, 0.3)';
        ctx.shadowBlur = 12;
      }
    } else {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.72)';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.22)';
      ctx.shadowBlur = 10;
    }

    ctx.stroke();
    ctx.restore();

    if (enrollmentStatus.state === 'holding' && guidance.hold_progress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r + 6, r + 6, 0, -Math.PI / 2, -Math.PI / 2 + (guidance.hold_progress * Math.PI * 2));
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.92)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(34, 197, 94, 0.5)';
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    }

    if (guidance.arrow && !guidance.pose_matched && guidance.face_detected && !guidance.multiple_faces) {
      drawArrow(ctx, cx, cy, r, r, guidance.arrow);
    }
  }

  function triggerFlash() {
    if (!flash) return;
    flash.classList.remove('is-active');
    void flash.offsetWidth;
    flash.classList.add('is-active');
    setTimeout(() => flash.classList.remove('is-active'), 250);
  }

  function showAdminToastSafe(options) {
    if (typeof window.showAdminToast === 'function') {
      window.showAdminToast(options);
    }
  }

  async function confirmAction(options) {
    if (window.CameraPIConfirm?.open) {
      return window.CameraPIConfirm.open(options);
    }

    const fallbackText = typeof options === 'string'
      ? options
      : options?.text || options?.title || 'Esta accion requiere confirmacion.';
    return window.confirm(fallbackText);
  }

  function setPillTone(element, tone) {
    if (!element) return;
    element.classList.remove(
      'enrollment-status-pill--muted',
      'enrollment-status-pill--success',
      'enrollment-status-pill--warning',
      'enrollment-status-pill--danger',
    );
    if (tone) element.classList.add(tone);
  }

  function phaseLabel(status = enrollmentStatus) {
    switch (status.phase) {
      case 'completed_review':
        return tr('Revision final');
      case 'recoverable_error':
        return tr('Atencion');
      case 'active':
        if (status.state === 'holding') return tr('Estable');
        if (status.state === 'capturing') return tr('Capturando');
        return tr('Guiado');
      default:
        return tr('Preparacion');
    }
  }

  function phaseTone(status = enrollmentStatus) {
    if (status.phase === 'completed_review') return 'enrollment-status-pill--success';
    if (status.phase === 'recoverable_error') return 'enrollment-status-pill--danger';
    if (status.state === 'holding' || status.state === 'capturing') return 'enrollment-status-pill--success';
    if (status.state === 'low_light' || status.state === 'face_lost') return 'enrollment-status-pill--warning';
    return '';
  }

  function stepBadgeText(status = enrollmentStatus) {
    if (status.phase === 'completed_review') return 'Revision final';
    if (status.phase === 'recoverable_error') return 'Sesion detenida';
    if (status.current_step == null) return 'Preparacion';
    return tr('Capturando de frente');
  }

  function currentSamplesText(status = enrollmentStatus) {
    const needed = status.samples_needed || 20;
    return `${status.samples_this_step || 0} ${tr('de')} ${needed} ${tr(needed === 1 ? 'foto' : 'fotos')}`;
  }

  function totalSamplesText(status = enrollmentStatus) {
    const total = status.total_needed || 20;
    return `${status.total_captured || 0} ${tr('de')} ${total} ${tr(total === 1 ? 'foto' : 'fotos')}`;
  }

  function renderDots(steps) {
    if (!dotsContainer) return;
    dotsContainer.innerHTML = '';

    steps.forEach((step, index) => {
      if (index > 0) {
        const line = doc.createElement('span');
        line.className = 'enrollment-dot-line';
        const prev = steps[index - 1];
        if (step.status === 'complete' || prev?.status === 'complete') {
          line.classList.add('is-complete');
        }
        dotsContainer.appendChild(line);
      }

      const dot = doc.createElement('span');
      dot.className = 'enrollment-dot';
      if (step.status === 'complete') dot.classList.add('is-complete');
      if (step.status === 'active') dot.classList.add('is-active');
      dotsContainer.appendChild(dot);
    });
  }

  function renderStepsList(steps) {
    if (!stepsList) return;
    stepsList.innerHTML = '';

    steps.forEach((step, index) => {
      const item = doc.createElement('li');
      item.className = 'enrollment-step-item';
      if (step.status === 'active') item.classList.add('is-active');
      if (step.status === 'complete') item.classList.add('is-complete');

      const indicator = doc.createElement('span');
      indicator.className = 'enrollment-step-item__indicator';
      indicator.textContent = step.status === 'complete' ? '\u2713' : String(index + 1);

      const label = doc.createElement('span');
      label.className = 'enrollment-step-item__label';
      label.textContent = tr(step.label);

      const samples = doc.createElement('span');
      samples.className = 'enrollment-step-item__samples';
      samples.textContent = `${step.samples}/${step.needed || 5}`;

      item.appendChild(indicator);
      item.appendChild(label);
      item.appendChild(samples);
      stepsList.appendChild(item);
    });
  }

  function setReadinessState(item, valueEl, badgeEl, options) {
    if (!item || !valueEl || !badgeEl) return;
    item.classList.remove('is-ready', 'is-warning', 'is-danger');
    if (options.itemClass) item.classList.add(options.itemClass);
    valueEl.textContent = options.value;
    badgeEl.textContent = options.badge;
    badgeEl.className = 'enrollment-readiness__badge';
    if (options.badgeClass) badgeEl.classList.add(options.badgeClass);
  }

  function getCameraReadiness() {
    if (!systemStatus) {
      return {
        ready: false,
        note: 'No se pudo verificar el estado de la camara.',
      };
    }

    const cameraState = String(systemStatus.camera || '').toLowerCase();
    const ready = cameraState === 'online' || cameraState === 'degraded';

    if (ready) {
      return {
        ready: true,
        note: cameraState === 'degraded'
          ? 'La camara esta disponible, aunque con estado degradado.'
          : 'La camara esta lista para iniciar la captura.',
      };
    }

    if (cameraState === 'sleep') {
      return {
        ready: false,
        note: 'La camara esta en reposo. Reactiva el sistema antes de iniciar.',
      };
    }

    return {
      ready: false,
      note: 'La camara no esta lista. Revisa la conexion antes de iniciar.',
    };
  }

  function renderSystemReadiness() {
    const cameraState = String(systemStatus?.camera || 'desconocido').toLowerCase();
    const modelState = String(systemStatus?.model || 'desconocido').toLowerCase();
    const readiness = getCameraReadiness();

    setReadinessState(cameraReadyItem, cameraReadyText, cameraReadyBadge, {
      itemClass: readiness.ready ? 'is-ready' : 'is-danger',
      value:
        cameraState === 'online' ? tr('En linea')
          : cameraState === 'degraded' ? tr('Disponible con alerta')
            : cameraState === 'sleep' ? tr('En reposo')
              : cameraState === 'offline' ? tr('Fuera de linea')
                : cameraState === 'error' ? tr('Con error')
                  : tr('Sin verificar'),
      badge: readiness.ready ? tr('Lista') : tr('Bloquea inicio'),
      badgeClass: readiness.ready ? '' : 'enrollment-readiness__badge--danger',
    });

    const modelValue =
      modelState === 'loaded' ? tr('Cargado')
        : modelState === 'not_loaded' ? tr('No cargado')
          : modelState === 'error' ? tr('Con error')
            : tr('Sin verificar');
    const modelTone =
      modelState === 'loaded' ? ''
        : modelState === 'error' ? 'enrollment-readiness__badge--warning'
          : 'enrollment-readiness__badge--info';

    setReadinessState(modelReadyItem, modelReadyText, modelReadyBadge, {
      itemClass: modelState === 'error' ? 'is-warning' : '',
      value: modelValue,
      badge: modelState === 'loaded' ? tr('Disponible') : tr('Informativo'),
      badgeClass: modelTone,
    });

    if (readinessMeta) {
      readinessMeta.textContent = readiness.ready
        ? tr('Sistema listo para capturar')
        : tr('Hace falta revisar la camara');
    }

    updateStartState();
  }

  function updateStartState() {
    if (!startBtn || !startNote) return;

    const selectedUserId = getCurrentSelectedUserId();
    const readiness = getCameraReadiness();

    let note = 'Selecciona una persona para comenzar.';
    let disableStart = isStarting;
    let dangerNote = false;

    if (isStarting) {
      note = 'Preparando la sesion de enrolamiento...';
    } else if (!selectedUserId) {
      disableStart = true;
      note = 'Selecciona una persona para habilitar el inicio.';
    } else if (!readiness.ready) {
      disableStart = true;
      note = readiness.note;
      dangerNote = true;
    }

    startBtn.disabled = disableStart;
    startNote.textContent = note;
    startNote.classList.toggle('is-danger', dangerNote);
  }

  function applySnapshot(nextStatus) {
    const previousTotalCaptured = enrollmentStatus?.total_captured || 0;

    enrollmentStatus = nextStatus && typeof nextStatus === 'object'
      ? nextStatus
      : buildFallbackIdleStatus();

    if (enrollmentStatus.user_id) {
      pendingUserId = String(enrollmentStatus.user_id);
      userSelect.value = pendingUserId;
    }

    if (phasePill) {
      phasePill.textContent = phaseLabel(enrollmentStatus);
      setPillTone(phasePill, phaseTone(enrollmentStatus));
    }

    if (currentSamplesPill) {
      currentSamplesPill.textContent = currentSamplesText(enrollmentStatus);
      setPillTone(currentSamplesPill, 'enrollment-status-pill--muted');
    }

    if (userMeta) {
      userMeta.textContent = enrollmentStatus.user_name
        ? enrollmentStatus.user_name
        : tr('Sin sesion activa');
    }

    if (stepBadge) stepBadge.textContent = stepBadgeText(enrollmentStatus);
    if (stepCounter) stepCounter.textContent = totalSamplesText(enrollmentStatus);
    if (instruction) instruction.textContent = tr(enrollmentStatus.guidance?.instruction || 'Selecciona una persona para iniciar');
    if (message) message.textContent = tr(enrollmentStatus.guidance?.hint || '');

    const steps = enrollmentStatus.steps_summary || buildFallbackIdleStatus().steps_summary;
    renderDots(steps);
    renderStepsList(steps);

    const progressPercent = enrollmentStatus.total_needed > 0
      ? Math.round((enrollmentStatus.total_captured / enrollmentStatus.total_needed) * 100)
      : 0;
    if (totalFill) totalFill.style.width = `${progressPercent}%`;
    if (totalLabel) totalLabel.textContent = totalSamplesText(enrollmentStatus);
    if (summaryUser) summaryUser.textContent = enrollmentStatus.user_name || tr('Sin seleccionar');
    if (summaryPhase) summaryPhase.textContent = phaseLabel(enrollmentStatus);
    if (summaryTotal) summaryTotal.textContent = totalSamplesText(enrollmentStatus);
    if (activeStepLabel) activeStepLabel.textContent = tr(enrollmentStatus.guidance?.instruction || 'Preparacion');
    if (activeStepHint) activeStepHint.textContent = tr(enrollmentStatus.guidance?.hint || '');
    if (activeStepSamples) activeStepSamples.textContent = currentSamplesText(enrollmentStatus);
    if (activeTotalSamples) activeTotalSamples.textContent = totalSamplesText(enrollmentStatus);

    if (errorBanner) errorBanner.classList.toggle('is-hidden', !isRecoverableError(enrollmentStatus));
    if (errorTitle) errorTitle.textContent = tr('Se detuvo el enrolamiento');
    if (errorText) errorText.textContent = tr(enrollmentStatus.guidance?.hint || 'Revisa la sesion y vuelve a intentarlo.');

    if (instructionsPanel) instructionsPanel.hidden = enrollmentStatus.phase !== 'preflight';
    if (stepsPanel) stepsPanel.hidden = enrollmentStatus.phase === 'preflight';
    if (stepFocus) stepFocus.hidden = isRecoverableError(enrollmentStatus);
    if (totalProgress) totalProgress.hidden = enrollmentStatus.phase === 'preflight';
    if (hud) hud.hidden = false;

    const shouldShowCompletion = isCompletedPhase(enrollmentStatus);
    if (completion) completion.classList.toggle('is-hidden', !shouldShowCompletion);
    if (completionSub) {
      completionSub.textContent = shouldShowCompletion
        ? tr('Entrenando modelo...')
        : `${enrollmentStatus.total_captured} ${tr('muestras capturadas')}`;
    }

    if (abortBtn) abortBtn.hidden = !enrollmentStatus.actions?.can_abort || isCompletedPhase(enrollmentStatus);
    if (retryBtn) retryBtn.hidden = !enrollmentStatus.actions?.can_retry;
    if (trainBtn) trainBtn.disabled = isTraining;
    if (finishBtn) finishBtn.disabled = isTraining;

    if (shouldShowCompletion && !isAutoFinishing) {
      void autoFinishEnrollment();
    }

    if (enrollmentStatus.total_captured > previousTotalCaptured) {
      triggerFlash();
    }

    renderWarnings();
    updateStartState();
    scheduleOverlayDraw();
  }

  function renderWarnings() {
    const guidance = enrollmentStatus.guidance || {};
    const showMulti = isActivePhase() && guidance.multiple_faces;
    const showGlasses = isActivePhase() && !showMulti && guidance.glasses_detected;
    const showLight = isActivePhase() && !showMulti && !showGlasses && guidance.brightness_ok === false;
    const showFace = isActivePhase() && !showMulti && !showGlasses && !showLight && enrollmentStatus.state === 'face_lost';

    if (faceWarningText) {
      faceWarningText.textContent = enrollmentStatus.state === 'face_lost'
        ? 'Centra tu rostro en la guia'
        : 'Mantente dentro de la guia para continuar';
    }

    faceWarning?.classList.toggle('is-hidden', !showFace);
    lightWarning?.classList.toggle('is-hidden', !showLight);
    multiFaceWarning?.classList.toggle('is-hidden', !showMulti);
    glassesWarning?.classList.toggle('is-hidden', !showGlasses);
  }

  async function autoFinishEnrollment() {
    if (isAutoFinishing) return;
    isAutoFinishing = true;
    stopPolling();

    // Brief pause so the user sees "Listo"
    await new Promise((r) => setTimeout(r, 1500));

    // Auto-train
    try {
      const trainResult = await requestJson('/api/train', { method: 'POST' });
      if (trainResult.ok) {
        showAdminToastSafe({
          text: tr('Modelo actualizado'),
          sub: `${trainResult.data.samples_used} ${tr('muestras de')} ${trainResult.data.unique_users} ${tr('personas')}`,
          cls: 'success',
        });
      } else {
        showAdminToastSafe({
          text: tr('Las muestras se guardaron'),
          sub: tr('El modelo se puede entrenar despues desde Sistema'),
          cls: 'warning',
          timeout: 3400,
        });
      }
    } catch (_) {
      showAdminToastSafe({
        text: tr('Las muestras se guardaron'),
        sub: tr('El modelo se puede entrenar despues desde Sistema'),
        cls: 'warning',
        timeout: 3400,
      });
    }

    // Finish session
    try {
      await requestJson('/api/enrollment/finish', { method: 'POST' });
    } catch (_) {
      // Best effort
    }

    isAutoFinishing = false;
    resetUI();

    // Navigate back to Personas and refresh user list
    if (typeof window.showPersonasListMode === 'function') {
      window.showPersonasListMode();
    }
    // Force-refresh the personas data so photo count is current
    if (typeof window.CameraPIAdminRefreshUsers === 'function') {
      window.CameraPIAdminRefreshUsers();
    }
  }

  async function enterEnrollmentView() {
    isViewActive = true;
    resizeCanvas();

    const work = (async () => {
      await Promise.all([loadUsers(), loadSystemStatus()]);

      try {
        const status = await fetchEnrollmentStatus();
        if (isActivePhase(status)) {
          scheduleNextPoll(0);
        } else {
          stopPolling();
        }
      } catch (error) {
        applySnapshot(buildFallbackIdleStatus());
        showAdminToastSafe({
          text: 'No se pudo recuperar la sesion',
          sub: error.message,
          cls: 'warning',
        });
      }
    })();

    enterViewPromise = work;
    try {
      await work;
    } finally {
      if (enterViewPromise === work) enterViewPromise = null;
    }
  }

  function leaveEnrollmentView() {
    isViewActive = false;
    stopPolling();
  }

  function resetUI() {
    stopPolling();
    enrollmentStatus = buildFallbackIdleStatus();
    pendingUserId = userSelect.value || pendingUserId;
    applySnapshot(enrollmentStatus);
    clearCanvas();
    faceWarning?.classList.add('is-hidden');
    lightWarning?.classList.add('is-hidden');
    multiFaceWarning?.classList.add('is-hidden');
    glassesWarning?.classList.add('is-hidden');
  }

  async function startEnrollment() {
    const selectedUserId = getCurrentSelectedUserId();
    if (!selectedUserId) {
      showAdminToastSafe({ text: 'Selecciona una persona', cls: 'warning' });
      updateStartState();
      return;
    }

    await loadSystemStatus();
    if (!getCameraReadiness().ready) {
      showAdminToastSafe({ text: 'La camara no esta lista', sub: getCameraReadiness().note, cls: 'warning' });
      updateStartState();
      return;
    }

    isStarting = true;
    updateStartState();

    try {
      const result = await requestJson('/api/enrollment/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: Number.parseInt(selectedUserId, 10) }),
      });

      if (!result.ok) {
        if (result.data?.phase) applySnapshot(result.data);
        showAdminToastSafe({
          text: 'No se pudo iniciar',
          sub: result.data?.error || 'Sesión no disponible',
          cls: 'warning',
        });
        if (isActivePhase(result.data)) scheduleNextPoll(0);
        return;
      }

      applySnapshot(result.data);
      scheduleNextPoll(0);
    } catch (error) {
      showAdminToastSafe({
        text: 'Error al iniciar',
        sub: error.message,
        cls: 'error',
      });
    } finally {
      isStarting = false;
      updateStartState();
    }
  }

  async function retryCurrentStep() {
    try {
      const result = await requestJson('/api/enrollment/retry-step', { method: 'POST' });
      if (!result.ok) {
        if (result.data?.phase) applySnapshot(result.data);
        showAdminToastSafe({
          text: 'No se pudo reiniciar el paso',
          sub: result.data?.error || 'Intenta de nuevo',
          cls: 'warning',
        });
        return;
      }

      applySnapshot(result.data);
      if (isActivePhase(result.data)) scheduleNextPoll(0);
    } catch (error) {
      showAdminToastSafe({
        text: 'Error al repetir el paso',
        sub: error.message,
        cls: 'error',
      });
    }
  }

  async function abortEnrollment() {
    const hasProgress = enrollmentStatus.total_captured > 0;
    if (hasProgress && !(await confirmAction({
      eyebrow: 'Cancelar captura',
      title: 'Cancelar enrolamiento',
      text: 'Se perdera el progreso capturado en esta sesion y tendras que comenzar de nuevo.',
      confirmLabel: 'Cancelar sesion',
      tone: 'danger',
    }))) {
      return;
    }

    try {
      await requestJson('/api/enrollment/abort', { method: 'POST' });
    } catch (_) {
      // Best effort. We still reset local UI and return to personas.
    }

    resetUI();
    if (typeof window.showPersonasListMode === 'function') {
      window.showPersonasListMode();
    }
  }

  async function goBackFromPreflight() {
    if (enrollmentStatus.total_captured > 0 && !(await confirmAction({
      eyebrow: 'Sesion en curso',
      title: 'Salir del enrolamiento',
      text: 'La sesion seguira disponible para retomarla despues, pero la captura se pausara al volver a Personas.',
      confirmLabel: 'Volver a Personas',
      tone: 'warning',
    }))) {
      return;
    }

    resetUI();
    if (typeof window.showPersonasListMode === 'function') {
      window.showPersonasListMode();
    }
  }

  async function finishSession(options = {}) {
    const { trainFirst = false } = options;

    if (trainFirst && !(await confirmAction({
      eyebrow: 'Entrenamiento final',
      title: 'Reentrenar modelo facial',
      text: 'Se usaran las muestras nuevas para generar un modelo actualizado y reemplazar el modelo activo.',
      confirmLabel: 'Entrenar ahora',
      tone: 'primary',
    }))) {
      return;
    }

    isTraining = Boolean(trainFirst);
    if (trainBtn) trainBtn.disabled = true;
    if (finishBtn) finishBtn.disabled = true;

    try {
      if (trainFirst) {
        const trainResult = await requestJson('/api/train', { method: 'POST' });
        if (trainResult.ok) {
          showAdminToastSafe({
            text: 'Modelo actualizado',
            sub: `${trainResult.data.samples_used} muestras de ${trainResult.data.unique_users} personas`,
            cls: 'success',
          });
        } else {
          showAdminToastSafe({
            text: 'No se pudo entrenar ahora',
            sub: 'Las muestras quedaron guardadas para entrenar despues desde Sistema.',
            cls: 'warning',
            timeout: 3400,
          });
        }
      }

      const finishResult = await requestJson('/api/enrollment/finish', { method: 'POST' });
      if (!finishResult.ok) {
        if (finishResult.data?.phase) applySnapshot(finishResult.data);
        showAdminToastSafe({
          text: 'No se pudo cerrar la sesion',
          sub: finishResult.data?.error || 'Intenta nuevamente',
          cls: 'error',
        });
        return;
      }

      resetUI();
      if (typeof window.showPersonasListMode === 'function') {
        window.showPersonasListMode();
      }
    } catch (error) {
      showAdminToastSafe({
        text: trainFirst ? 'No se pudo completar el entrenamiento' : 'No se pudo cerrar la sesion',
        sub: error.message,
        cls: 'error',
      });
    } finally {
      isTraining = false;
      if (trainBtn) trainBtn.disabled = false;
      if (finishBtn) finishBtn.disabled = false;
    }
  }

  function prefillUser(userId) {
    pendingUserId = userId == null ? null : String(userId);
    if (userSelect && pendingUserId != null) userSelect.value = pendingUserId;
    updateStartState();
  }

  async function startForUser(userId) {
    prefillUser(userId);
    if (!isViewActive) {
      await enterEnrollmentView();
    } else if (enterViewPromise) {
      await enterViewPromise;
    }
    if (userSelect && pendingUserId != null) userSelect.value = pendingUserId;
    await startEnrollment();
  }

  function onViewChange(event) {
    const nextView = event.detail?.viewId;
    if (nextView === 'enrolamiento') {
      void enterEnrollmentView();
      return;
    }
    leaveEnrollmentView();
  }

  startBtn?.addEventListener('click', () => {
    void startEnrollment();
  });

  retryBtn?.addEventListener('click', () => {
    void retryCurrentStep();
  });

  abortBtn?.addEventListener('click', () => {
    void abortEnrollment();
  });

  backBtn?.addEventListener('click', () => {
    void goBackFromPreflight();
  });

  // trainBtn and finishBtn listeners removed — enrollment auto-trains on completion

  userSelect?.addEventListener('change', () => {
    pendingUserId = userSelect.value || null;
    updateStartState();
  });

  window.addEventListener('admin:viewchange', onViewChange);
  window.addEventListener('resize', resizeCanvas);

  window.CameraPIEnrollment = {
    reset: resetUI,
    prefillUser,
    startForUser,
    refresh: enterEnrollmentView,
  };

  const initialView = window.CameraPIAdminLayout?.getCurrentView?.() || ((window.location.hash || '').replace('#', '').split('?')[0]);
  if (initialView === 'enrolamiento') {
    void enterEnrollmentView();
  } else {
    applySnapshot(buildFallbackIdleStatus());
  }

  /* ── i18n live re-render ── */
  document.addEventListener('i18n:change', () => {
    try {
      // Re-render labels that depend on tr()
      if (enrollmentStatus) applySnapshot(enrollmentStatus);
      renderSystemReadiness();
      // Re-translate the empty-select option without losing selection
      if (userSelect && userSelect.options.length > 0) {
        const first = userSelect.options[0];
        if (first && first.value === '') first.textContent = tr('Seleccionar persona...');
      }
    } catch (_) { /* silent */ }
  });
})();
