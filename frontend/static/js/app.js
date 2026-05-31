import { isWakeReadyStatus } from './wake-readiness.js';
import { isCurrentWakeAttempt } from './wake-attempt-guard.js';
import { bindDesktopReady, isDesktopLaunchPending } from './desktop-ready.js';
import { createFramePreviewController } from './frame-preview.js';

const shell = document.getElementById('kioskShell');
const accessToast = document.getElementById('accessToast');
const accessToastText = document.getElementById('accessToastText');
const accessToastSub = document.getElementById('accessToastSub');
const faceIndicator = document.getElementById('faceIndicator');
const userOverlay = document.getElementById('userOverlay');
const userPhoto = document.getElementById('userPhoto');
const recognizedName = document.getElementById('recognizedName');
const recognizedId = document.getElementById('recognizedId');
const recognizedArea = document.getElementById('recognizedArea');
const confidence = document.getElementById('confidence');
const camState = document.getElementById('camState');
const modelState = document.getElementById('modelState');
const gpioState = document.getElementById('gpioState');
const fpsState = document.getElementById('fpsState');
const systemStateBadge = document.getElementById('systemStateBadge');
const clockTime = document.getElementById('clockTime');
const clockDate = document.getElementById('clockDate');
const videoFeed = document.getElementById('videoFeed');
const cameraShell = document.getElementById('cameraShell');
const cameraStage = document.getElementById('cameraStage');
const cameraRingHost = cameraShell || cameraStage;

const faceGuide = document.getElementById('faceGuide');
const guidanceMessage = document.getElementById('guidanceMessage');
const faceArrowLeft = document.getElementById('faceArrowLeft');
const faceArrowRight = document.getElementById('faceArrowRight');
const faceArrowUp = document.getElementById('faceArrowUp');
const faceArrowDown = document.getElementById('faceArrowDown');
const cameraBadge = document.getElementById('cameraBadge');
const cameraBadgeText = document.getElementById('cameraBadgeText');
const primaryFaceBox = document.getElementById('primaryFaceBox');
const welcomeOverlay = document.getElementById('welcomeOverlay');
const welcomeCheckIcon = document.getElementById('welcomeCheckIcon');
const welcomeTitle = document.getElementById('welcomeTitle');
const welcomeName = document.getElementById('welcomeName');
const supportHelpButton = document.getElementById('supportHelpButton');
const supportHelpDialog = document.getElementById('supportHelpDialog');
const supportHelpMessage = document.getElementById('supportHelpMessage');
const supportHelpPhone = document.getElementById('supportHelpPhone');
const supportHelpClose = document.getElementById('supportHelpClose');
const infoPanel = document.getElementById('infoPanel');
const accessReceiptIcon = document.getElementById('accessReceiptIcon');
const accessReceiptMeta = document.getElementById('accessReceiptMeta');
const infoTitle = document.getElementById('infoTitle');
const infoDesc = document.getElementById('infoDesc');
const cameraTitle = document.getElementById('cameraTitle');
const lockscreenApi = window.CameraPILockscreen;
const lockscreenControllerApi = window.CameraPILockscreenController;
const LOCK_EVENTS = lockscreenControllerApi?.EVENTS || {};
const LOCK_STATES = lockscreenControllerApi?.STATES || {};
const desktopLaunchPending = isDesktopLaunchPending(window);
let desktopReadyReleased = !desktopLaunchPending;

const AUTO_TRIGGER_COOLDOWN_MS = 4000;
const MECHANISM_BUFFER_MS = 2000;
const SUPPORT_HELP_DELAY_MS = 10000;
let lastAutoTriggerMs = 0;
let postGrantedBlockUntilMs = 0;
let prevUiStateKey = '';
let toastTimer = null;
let supportHelpTimer = null;
let activeSupportPhone = '';
const AUTH_PROGRESS_STATE_CLASSES = ['is-idle', 'is-processing', 'is-success', 'is-error'];

/* i18n helper — devuelve el texto traducido al idioma actual.
   Si window.i18n aún no cargó o no tiene la clave, devuelve el original. */
function tr(text) {
  try {
    return window.i18n ? window.i18n.t(text) : text;
  } catch (_) {
    return text;
  }
}

const toastMap = {
  granted: { text: 'Acceso concedido', sub: 'Validación biométrica exitosa', cls: 'success', timeout: 2600 },
  denied: { text: 'Acceso denegado', sub: 'Identidad no válida para ingreso', cls: 'error', timeout: 2300 },
  blocked: { text: 'Acceso restringido', sub: 'Límite de intentos excedido', cls: 'warning', timeout: 3200 },
  multipleFaces: { text: 'Debe salir la otra persona', sub: 'Solo una persona frente a la cámara', cls: 'warning', timeout: 2600 },
  processing: { text: 'Procesando', sub: 'Analizando biometría facial', cls: 'processing', timeout: 1400 },
  initializing: { text: 'Sistema inicializando', sub: 'Cargando cámara y modelo', cls: 'processing', timeout: 2000 },
  noface: { text: 'Sin rostro detectado', sub: 'Esperando frente a cámara', cls: 'warning', timeout: 1600 },
  unrecognized: { text: 'Rostro no reconocido', sub: 'No coincide con usuarios activos', cls: 'warning', timeout: 2200 },
  cameraError: { text: 'Error de cámara', sub: 'Verifique conexión del dispositivo', cls: 'error', timeout: 2800 },
  busy: { text: 'Análisis en curso', sub: 'Espere a que finalice el proceso actual', cls: 'warning', timeout: 1600 },
};

const analysisEventToToast = {
  authorized: 'granted',
  denied: 'denied',
  blocked: 'blocked',
  no_face: 'noface',
  camera_error: 'cameraError',
  model_not_loaded: 'initializing',
  busy: 'busy',
  multiple_faces: 'multipleFaces',
};

let faceAction = null;
const prefersReducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
let statusIntervalId = null;
let idleTimeoutId = null;
let isPollingPaused = false;
let isScanPaused = false;
let wakeAbortController = null;
let sleepPromise = null;
let framePreview = null;
const IDLE_TIMEOUT_MS = 45000;

function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

function csrfHeaders() {
  const token = getCsrfToken();
  return token ? { 'x-csrf-token': token } : {};
}

function getDefaultStreamSrc() {
  return videoFeed?.dataset.streamSrc || '/api/stream';
}

function initializeVideoFeed() {
  if (!videoFeed) {
    return;
  }

  framePreview = createFramePreviewController({
    imageElement: videoFeed,
    streamUrl: getDefaultStreamSrc(),
    onError: (error) => {
      console.warn('[frame-preview:error]', { error: error?.message || String(error), ts: Date.now() });
    },
  });

  if (desktopLaunchPending) {
    framePreview.pause();
    return;
  }

  framePreview.resume('initial');
}

function setCameraStageActive(isActive) {
  if (!cameraRingHost) {
    return;
  }

  const active = Boolean(isActive);
  const allowPulse = active && !prefersReducedMotionQuery?.matches;

  cameraRingHost.classList.toggle('camera-active', active);
  cameraRingHost.classList.toggle('camera-pulse', allowPulse);
}

function showToast(type) {
  if (!accessToast || !accessToastText || !accessToastSub) {
    return;
  }

  const config = toastMap[type] || toastMap.processing;

  accessToastText.textContent = tr(config.text);
  accessToastSub.textContent = tr(config.sub);
  accessToast.classList.remove('is-hidden', 'success', 'error', 'warning', 'processing');
  accessToast.classList.add(config.cls, 'is-visible');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toastTimer = setTimeout(() => {
    accessToast.classList.remove('is-visible');
    setTimeout(() => accessToast.classList.add('is-hidden'), 180);
  }, config.timeout);
}

function setGrantedUiState(isGranted) {
  const active = Boolean(isGranted);
  shell?.classList.toggle('is-granted-state', active);
  cameraStage?.classList.toggle('is-granted', active);
  infoPanel?.classList.toggle('is-granted', active);
}

function getRecognizedUserName(rawName) {
  const value = String(rawName || '').trim();
  if (!value || value === '-') {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'desconocido') {
    return null;
  }

  return value;
}

function setElementHidden(element, hidden) {
  element?.classList.toggle('is-hidden', Boolean(hidden));
}

function resetSupportHelp({ closeDialog = true } = {}) {
  if (supportHelpTimer) {
    clearTimeout(supportHelpTimer);
    supportHelpTimer = null;
  }
  setElementHidden(supportHelpButton, true);
  if (closeDialog) {
    setElementHidden(supportHelpDialog, true);
    supportHelpDialog?.setAttribute('aria-hidden', 'true');
  }
}

function updateSupportHelp(data) {
  activeSupportPhone = String(data?.support_phone || '').trim();
  const hasPhone = activeSupportPhone.length > 0;
  const noFace = !data?.face_detected && Number(data?.faces_count || 0) === 0;
  const result = String(data?.last_result || '');
  const recent = Math.max(0, Math.floor(Date.now() / 1000) - Number(data?.timestamp || 0)) <= 6;
  const accessIssue = recent && (
    result === 'MULTIPLE_FACES' ||
    result === 'DENEGADO_BLOQUEO' ||
    result.startsWith('DENEGADO')
  );

  if (!hasPhone || (!noFace && !accessIssue)) {
    resetSupportHelp({ closeDialog: !hasPhone || (!noFace && !accessIssue) });
    return;
  }

  if (supportHelpMessage) {
    supportHelpMessage.textContent = tr('En caso de no poder acceder debido a problemas de reconocimiento, llama al departamento encargado.');
  }

  if (supportHelpPhone) {
    supportHelpPhone.textContent = activeSupportPhone;
  }

  if (accessIssue) {
    if (supportHelpTimer) {
      clearTimeout(supportHelpTimer);
      supportHelpTimer = null;
    }
    setElementHidden(supportHelpButton, false);
    return;
  }

  if (!supportHelpTimer && supportHelpButton?.classList.contains('is-hidden')) {
    supportHelpTimer = setTimeout(() => {
      supportHelpTimer = null;
      if (activeSupportPhone) {
        setElementHidden(supportHelpButton, false);
      }
    }, SUPPORT_HELP_DELAY_MS);
  }
}

function openSupportHelp() {
  if (!activeSupportPhone || !supportHelpDialog) return;
  if (supportHelpMessage) {
    supportHelpMessage.textContent = tr('En caso de no poder acceder debido a problemas de reconocimiento, llama al departamento encargado.');
  }
  if (supportHelpPhone) supportHelpPhone.textContent = activeSupportPhone;
  supportHelpDialog.classList.remove('is-hidden');
  supportHelpDialog.setAttribute('aria-hidden', 'false');
}

function closeSupportHelp() {
  supportHelpDialog?.classList.add('is-hidden');
  supportHelpDialog?.setAttribute('aria-hidden', 'true');
}

function ensureFaceDepthField() {
  if (!primaryFaceBox || primaryFaceBox.querySelector('.face-depth-field__sweep')) return;
  primaryFaceBox.classList.remove('face-box');
  primaryFaceBox.classList.add('face-depth-field');
  primaryFaceBox.innerHTML = `
    <span class="face-depth-field__shell"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__line"></span>
    <span class="face-depth-field__sweep"></span>
  `;
}

function updatePrimaryFaceBox(data, uiStateKey) {
  if (!primaryFaceBox) return;
  ensureFaceDepthField();
  const bbox = data?.primary_face_bbox || data?.face_bbox;
  const reportedFacesCount = Number(data?.faces_count || 0);
  const facesCount = reportedFacesCount > 0 ? reportedFacesCount : (data?.face_detected ? 1 : 0);
  const visible = Boolean(data?.face_detected && bbox && facesCount > 0);

  if (!visible) {
    primaryFaceBox.classList.add('is-hidden');
    primaryFaceBox.removeAttribute('style');
    return;
  }

  const x = Number(bbox.x || 0);
  const y = Number(bbox.y || 0);
  const w = Number(bbox.w || 0);
  const h = Number(bbox.h || 0);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const previousSize = Math.max(w, h) * 1.65;
  const top = cy - previousSize / 2;
  const bottom = y + h;
  const size = Math.max(0, bottom - top);

  primaryFaceBox.style.left = `${Math.round((cx - size / 2) * 10000) / 100}%`;
  primaryFaceBox.style.top = `${Math.round(top * 10000) / 100}%`;
  primaryFaceBox.style.width = `${Math.round(size * 10000) / 100}%`;
  primaryFaceBox.style.height = `${Math.round(size * 10000) / 100}%`;
  primaryFaceBox.classList.remove('is-hidden', 'is-granted', 'is-warning', 'is-denied');
  if (facesCount > 1) {
    primaryFaceBox.classList.add('is-warning');
  } else if (uiStateKey === 'granted') {
    primaryFaceBox.classList.add('is-granted');
  } else if (['denied', 'blocked', 'unrecognized'].includes(uiStateKey)) {
    primaryFaceBox.classList.add('is-denied');
  }
}

/* Cambia el símbolo del sprite usado por el ícono del overlay (check / x). */
function setWelcomeIcon(symbolId) {
  const useEl = welcomeCheckIcon?.querySelector('use');
  if (useEl) {
    useEl.setAttribute('href', `/static/icons/lucide/lucide-sprite.svg#${symbolId}`);
  }
}

function hideWelcomeOverlay() {
  welcomeOverlay.classList.add('is-hidden');
  welcomeOverlay.classList.remove('welcome-overlay--blue', 'welcome-overlay--red');
  welcomeCheckIcon?.classList.add('is-hidden');
}

function updateWelcomeOverlay(stateKey, data) {
  if (!welcomeOverlay || !welcomeTitle || !welcomeName) return;

  /* Acceso autorizado → overlay azul con el nombre del usuario reconocido. */
  if (stateKey === 'granted') {
    const userName = getRecognizedUserName(data?.last_user);
    if (!userName) {
      hideWelcomeOverlay();
      return;
    }
    welcomeTitle.textContent = tr('Adelante');
    welcomeName.textContent = userName;
    setWelcomeIcon('circle-check');
    welcomeCheckIcon?.classList.remove('is-hidden');
    welcomeOverlay.classList.remove('is-hidden', 'welcome-overlay--red');
    welcomeOverlay.classList.add('welcome-overlay--blue');
    return;
  }

  /* Acceso no autorizado (rostro no registrado o denegado) → overlay rojo,
     contraparte exacta del azul: misma estructura, transparencia y tonos. */
  if (stateKey === 'unrecognized' || stateKey === 'denied') {
    welcomeTitle.textContent = tr('No autorizado');
    welcomeName.textContent = stateKey === 'denied'
      ? tr('Acceso denegado')
      : tr('Persona no registrada');
    setWelcomeIcon('circle-x');
    welcomeCheckIcon?.classList.remove('is-hidden');
    welcomeOverlay.classList.remove('is-hidden', 'welcome-overlay--blue');
    welcomeOverlay.classList.add('welcome-overlay--red');
    return;
  }

  hideWelcomeOverlay();
}

function formatAccessReceiptTime() {
  return new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function updateFaceIndicator(stateKey) {
  setGrantedUiState(stateKey === 'granted');

  if (faceIndicator) {
    faceIndicator.classList.remove('idle', 'tracking', 'granted', 'denied', 'blocked');
    if (stateKey === 'granted') faceIndicator.classList.add('granted');
    else if (stateKey === 'denied' || stateKey === 'unrecognized') faceIndicator.classList.add('denied');
    else if (stateKey === 'blocked') faceIndicator.classList.add('blocked');
    else if (stateKey === 'processing') faceIndicator.classList.add('tracking');
    else faceIndicator.classList.add('idle');
  }

  if (faceGuide) {
    /* Face guide silhouette states are now driven by updateFaceGuidance() */
    /* Keep post-recognition override states */
    if (stateKey === 'granted') {
      setFaceGuideState('is-granted');
    } else if (stateKey === 'denied' || stateKey === 'unrecognized' || stateKey === 'blocked') {
      setFaceGuideState('is-denied');
    }
    /* Other states are handled by updateFaceGuidance with face_guidance data */
  }

  if (cameraBadge && cameraBadgeText) {
    cameraBadge.classList.remove('is-idle', 'is-tracking', 'is-granted', 'is-denied', 'is-blocked');
    const badgeCfg = {
      granted:      { text: 'Acceso concedido',    cls: 'is-granted'  },
      denied:       { text: 'Acceso denegado',     cls: 'is-denied'   },
      blocked:      { text: 'Acceso restringido',  cls: 'is-blocked'  },
      multipleFaces:{ text: 'Debe salir la otra persona', cls: 'is-blocked' },
      unrecognized: { text: 'No reconocido',       cls: 'is-denied'   },
      processing:   { text: 'Rostro detectado',    cls: 'is-tracking' },
      noface:       { text: 'Esperando detección', cls: 'is-idle'     },
      cameraError:  { text: 'Error de cámara',     cls: 'is-denied'   },
      initializing: { text: 'Cargando modelo',     cls: 'is-idle'     },
      nomodel:      { text: 'Sin modelo',          cls: 'is-idle'     },
    };
    const cfg = badgeCfg[stateKey] || badgeCfg.initializing;
    cameraBadgeText.textContent = tr(cfg.text);
    cameraBadge.classList.add(cfg.cls);
  }

  if (infoTitle) {
    const titleMap = {
      granted:      'Acceso concedido',
      denied:       'Acceso<br>denegado',
      blocked:      'Acceso denegado',
      multipleFaces:'Debe salir<br>la otra persona',
      unrecognized: 'No reconocido',
      processing:   'Validando<br>identidad',
      noface:       'Esperando<br>detección',
      cameraError:  'Error de<br>cámara',
      initializing: 'Cargando<br>modelo',
      nomodel:      'Sin<br>modelo',
    };
    infoTitle.innerHTML = tr(titleMap[stateKey] || titleMap.processing);
  }

  if (infoDesc) {
    const descMap = {
      granted:      'Puerta desbloqueada<br><strong>Ingreso autorizado</strong>',
      denied:       'Identidad no autorizada<br><strong>acceso denegado</strong>',
      blocked:      'No se pudo validar la identidad<br><strong>intenta nuevamente</strong>',
      multipleFaces:'La cámara detecta más de una persona<br><strong>esperando despeje</strong>',
      unrecognized: 'Rostro no registrado<br><strong>en el sistema</strong>',
      processing:   'Espera un momento mientras<br><strong>verificamos tu acceso</strong>',
      noface:       'Coloca tu rostro frente<br><strong>a la cámara</strong>',
      cameraError:  'Verifique la conexión<br><strong>del dispositivo</strong>',
      initializing: 'Cargando modelo<br><strong>de reconocimiento</strong>',
      nomodel:      'Entrena un modelo desde<br><strong>el panel de administración</strong>',
    };
    infoDesc.innerHTML = tr(descMap[stateKey] || descMap.processing);
  }

  if (accessReceiptIcon) {
    accessReceiptIcon.classList.toggle('is-hidden', stateKey !== 'granted');
  }

  if (accessReceiptMeta) {
    if (stateKey === 'granted') {
      accessReceiptMeta.textContent = `${tr('Registro de acceso')} · ${formatAccessReceiptTime()}`;
    } else {
      accessReceiptMeta.textContent = '';
    }
  }

  if (cameraTitle) {
    const ctMap = {
      granted:      'Acceso concedido',
      denied:       'Acceso denegado',
      blocked:      'Acceso restringido',
      multipleFaces:'Debe salir la otra persona',
      unrecognized: 'No reconocido',
      processing:   'Validando identidad',
      noface:       'Esperando detección',
      cameraError:  'Error de cámara',
      initializing: 'Cargando modelo',
      nomodel:      'Sin modelo',
    };
    cameraTitle.textContent = tr(ctMap[stateKey] || ctMap.processing);
  }

  const authProgressBar = document.getElementById('authProgressBar');
  if (authProgressBar) {
    authProgressBar.classList.remove(...AUTH_PROGRESS_STATE_CLASSES);

    if (stateKey === 'granted') {
      authProgressBar.classList.add('is-success');
    } else if (['denied', 'unrecognized', 'blocked'].includes(stateKey)) {
      authProgressBar.classList.add('is-error');
    } else if (stateKey === 'processing') {
      authProgressBar.classList.add('is-processing');
    } else {
      authProgressBar.classList.add('is-idle');
    }
  }
}

/* ── Face guidance state classes ── */

const GUIDANCE_ALL_CLASSES = [
  'is-idle', 'is-searching', 'is-misaligned', 'is-aligned',
  'is-hold', 'is-ready', 'is-capturing', 'is-lost', 'is-error',
  'is-granted', 'is-denied', 'is-tracking',
];

const GUIDANCE_STATE_TO_CLASS = {
  idle: 'is-idle',
  searching: 'is-searching',
  detected_misaligned: 'is-misaligned',
  aligned: 'is-aligned',
  hold_steady: 'is-hold',
  ready: 'is-ready',
  capture_in_progress: 'is-capturing',
  lost: 'is-lost',
  error: 'is-error',
};

function setFaceGuideState(cls) {
  if (!faceGuide) return;
  faceGuide.classList.remove(...GUIDANCE_ALL_CLASSES);
  faceGuide.classList.add(cls);
}

function setFaceArrows(left, right, up, down) {
  faceArrowLeft?.classList.toggle('is-visible', left);
  faceArrowRight?.classList.toggle('is-visible', right);
  faceArrowUp?.classList.toggle('is-visible', up);
  faceArrowDown?.classList.toggle('is-visible', down);
}

function hideAllFaceArrows() {
  setFaceArrows(false, false, false, false);
}

const ARROW_OX_THRESHOLD = 0.06;
const ARROW_OY_THRESHOLD = 0.06;
const ARROW_SCALE_CLOSE = 1.35;
const ARROW_SCALE_FAR = 0.70;

function updateFaceGuidance(guidance, uiStateKey) {
  if (!faceGuide) return;

  // Post-recognition overrides are handled by updateFaceIndicator
  if (['granted', 'denied', 'unrecognized', 'blocked'].includes(uiStateKey)) {
    hideAllFaceArrows();
    return;
  }

  if (!guidance || !guidance.state) {
    setFaceGuideState('is-idle');
    hideAllFaceArrows();
    if (guidanceMessage) {
      guidanceMessage.textContent = tr('Buscando rostro');
    }
    return;
  }

  const cls = GUIDANCE_STATE_TO_CLASS[guidance.state] || 'is-idle';
  setFaceGuideState(cls);

  if (guidanceMessage && guidance.message) {
    guidanceMessage.textContent = tr(guidance.message);
  }

  // Flechas direccionales — solo en estado misaligned o lost
  if (guidance.state === 'detected_misaligned' || guidance.state === 'lost') {
    const ox = guidance.offset_x || 0;
    const oy = guidance.offset_y || 0;
    const sr = guidance.scale_ratio || 0;

    // Prioridad: escala > horizontal > vertical
    const tooClose = sr > ARROW_SCALE_CLOSE;
    const tooFar = sr < ARROW_SCALE_FAR && sr > 0;

    if (tooClose || tooFar) {
      // No mostrar flechas laterales cuando el problema es distancia
      hideAllFaceArrows();
    } else {
      const showLeft = ox > ARROW_OX_THRESHOLD;   // cara a la derecha → flecha izquierda
      const showRight = ox < -ARROW_OX_THRESHOLD;  // cara a la izquierda → flecha derecha
      const showUp = oy > ARROW_OY_THRESHOLD;      // cara abajo → flecha arriba
      const showDown = oy < -ARROW_OY_THRESHOLD;   // cara arriba → flecha abajo
      setFaceArrows(showLeft, showRight, showUp, showDown);
    }
  } else {
    hideAllFaceArrows();
  }
}

function showUserOverlay(data) {
  if (!userOverlay || !recognizedName || !recognizedId || !recognizedArea || !confidence || !userPhoto) {
    return;
  }

  const userName = data.last_user || '-';
  const hasKnownUser = userName !== '-' && userName.toLowerCase() !== 'desconocido';

  if (!hasKnownUser) {
    userOverlay.classList.remove('is-visible');
    userOverlay.classList.add('is-hidden');
    return;
  }

  const nameForCard = String(userName).trim().toUpperCase();
  const parts = nameForCard.split(/\s+/);
  if (parts.length >= 2) {
    recognizedName.textContent = `${parts[0]}\n${parts.slice(1).join(' ')}`;
  } else {
    recognizedName.textContent = nameForCard;
  }
  recognizedId.textContent = data.last_user_id || userName.replace(/\D+/g, '') || '-';
  recognizedArea.textContent = data.last_area || tr('Acceso principal');
  confidence.textContent = data.last_confidence == null ? '-' : Number(data.last_confidence).toFixed(2);

  if (typeof data.last_user_photo === 'string' && data.last_user_photo.trim().length > 0) {
    userPhoto.src = data.last_user_photo;
  } else {
    userPhoto.src = '/static/images/user-placeholder.svg';
  }

  userOverlay.classList.remove('is-hidden');
  requestAnimationFrame(() => userOverlay.classList.add('is-visible'));
}

function updateClock() {
  if (!clockTime || !clockDate) {
    return;
  }

  const now = new Date();
  const formattedTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  clockTime.textContent = formattedTime.replace(/\./g, '').toUpperCase();

  const clockLocale = window.i18n?.getLang() === 'en' ? 'en-US' : 'es-MX';
  const dateParts = new Intl.DateTimeFormat(clockLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatToParts(now);
  const day = dateParts.find((part) => part.type === 'day')?.value ?? '--';
  const month = dateParts.find((part) => part.type === 'month')?.value ?? '---';
  const year = dateParts.find((part) => part.type === 'year')?.value ?? '----';
  clockDate.textContent = `${day} ${month} ${year}`;
}

function setSystemBadge(text, variant) {
  systemStateBadge.textContent = tr(text);
  /* Guardar original para retraducir cuando cambie idioma */
  systemStateBadge.dataset.i18nKey = text;
  systemStateBadge.classList.remove('state-success', 'state-error', 'state-processing', 'state-warning', 'state-neutral');
  systemStateBadge.classList.add(variant);
}

function classifyState(data) {
  const result = String(data.last_result || 'INICIALIZANDO');
  const statusAge = Math.max(0, Math.floor(Date.now() / 1000) - Number(data.timestamp || 0));
  const faceDetected = Boolean(data.face_detected);
  const analysisBusy = Boolean(data.analysis_busy);
  const modelLoaded = data.model === 'loaded';

  if (data.camera === 'error' || data.camera === 'offline' || data.camera === 'degraded') {
    return { key: 'cameraError', badge: ['Error de cámara', 'state-error'] };
  }

  if (analysisBusy) {
    return { key: 'processing', badge: ['Analizando', 'state-processing'] };
  }

  if (statusAge <= 3 && result.startsWith('AUTORIZADO')) {
    return { key: 'granted', badge: ['Acceso concedido', 'state-success'] };
  }

  if (result === 'MULTIPLE_FACES' || Number(data.faces_count || 0) > 1) {
    return { key: 'multipleFaces', badge: ['Debe salir la otra persona', 'state-warning'] };
  }

  if (statusAge <= 3 && result.startsWith('DENEGADO')) {
    const userName = String(data.last_user || '').toLowerCase();
    if (userName && userName !== 'desconocido') {
      return { key: 'denied', badge: ['Acceso denegado', 'state-error'] };
    }
    return { key: 'unrecognized', badge: ['Rostro no reconocido', 'state-warning'] };
  }

  if (!modelLoaded) {
    return { key: 'nomodel', badge: ['Sin modelo', 'state-warning'] };
  }

  if (!faceDetected) {
    return { key: 'noface', badge: ['Esperando detección', 'state-neutral'] };
  }

  return { key: 'processing', badge: ['Rostro detectado', 'state-processing'] };
}

async function loadStatus() {
  if (isPollingPaused) {
    return;
  }

  try {
    const response = await fetch('/api/status');
    if (!response.ok) {
      throw new Error(`status_http_${response.status}`);
    }

    const data = await response.json();

    camState.textContent = data.camera || '-';
    modelState.textContent = data.model || '-';
    gpioState.textContent = data.gpio || '-';
    fpsState.textContent = data.fps ?? 0;
    setCameraStageActive(data.camera === 'online');
    if (data.camera === 'online') {
      framePreview?.ensureRunning();
    }

    const uiState = classifyState(data);
    setSystemBadge(uiState.badge[0], uiState.badge[1]);

    if (uiState.key === 'granted' && prevUiStateKey !== 'granted') {
      const openSeconds = Number(data.door_open_seconds || 3);
      postGrantedBlockUntilMs = Date.now() + openSeconds * 1000 + MECHANISM_BUFFER_MS;
    }
    prevUiStateKey = uiState.key;

    updateFaceIndicator(uiState.key);
    updateWelcomeOverlay(uiState.key, data);
    updatePrimaryFaceBox(data, uiState.key);
    updateSupportHelp(data);
    updateFaceGuidance(data.face_guidance, uiState.key);
    showUserOverlay(data);
    faceAction?.updateStatus(data);

    const guidanceReady = data.face_guidance && data.face_guidance.ready;
    if (guidanceReady && !isScanPaused && !data.analysis_busy && faceAction && !faceAction.localBusy && faceAction.isReady(data)) {
      const now = Date.now();
      if (now - lastAutoTriggerMs >= AUTO_TRIGGER_COOLDOWN_MS && now >= postGrantedBlockUntilMs) {
        lastAutoTriggerMs = now;
        faceAction.handleAnalyzeClick();
      }
    }

    const lockSnapshot = lockscreenController?.getSnapshot?.();
    if (lockscreenController && LOCK_STATES.WAKING && lockSnapshot?.state === LOCK_STATES.WAKING) {
      const wakeReady = isWakeReadyStatus(data, { isPollingPaused, isScanPaused });
      if (wakeReady) {
        lockscreenController.dispatch({
          type: LOCK_EVENTS.WAKE_READY,
          wakeAttemptId: lockSnapshot.wakeAttemptId,
        });
      }
    }
  } catch (error) {
    console.error(error);
    setSystemBadge('Error de conexión', 'state-error');
    setCameraStageActive(false);
    showToast('cameraError');
    updateFaceIndicator('cameraError');
    if (userOverlay) {
      userOverlay.classList.remove('is-visible');
      userOverlay.classList.add('is-hidden');
    }

    const lockSnapshot = lockscreenController?.getSnapshot?.();
    if (lockscreenController && LOCK_STATES.WAKING && lockSnapshot?.state === LOCK_STATES.WAKING) {
      lockscreenController.dispatch({
        type: LOCK_EVENTS.RESUME_FAIL,
        wakeAttemptId: lockSnapshot.wakeAttemptId,
        errorCode: 'status_poll_error',
      });
    }
  }
}

function handleAnalysisResult(payload, statusCode) {
  const event = payload?.event || (statusCode === 409 ? 'busy' : 'camera_error');
  const toastKey = analysisEventToToast[event] || 'cameraError';
  showToast(toastKey);
}

faceAction = window.CameraPIFaceAction?.create({
  stageElement: cameraStage,
  videoElement: videoFeed,
  onResult: async (payload, statusCode) => {
    handleAnalysisResult(payload, statusCode);
    await loadStatus();
  },
});

function stopStatusPolling() {
  if (statusIntervalId !== null) {
    clearInterval(statusIntervalId);
    statusIntervalId = null;
  }
}

function startStatusPolling() {
  if (statusIntervalId === null && !isPollingPaused) {
    statusIntervalId = setInterval(loadStatus, 600);
  }
}

function pauseCamera() {
  if (!videoFeed) return true;
  framePreview?.pause();
  setCameraStageActive(false);
  return true;
}

function resumeCamera(cacheKey = 'wake') {
  if (!videoFeed) return true;
  framePreview?.resume(cacheKey);
  return true;
}

function pauseScan() {
  isScanPaused = true;
  return true;
}

function resumeScan() {
  isScanPaused = false;
  return true;
}

function pausePolling() {
  if (wakeAbortController) {
    wakeAbortController.abort();
    wakeAbortController = null;
  }
  isPollingPaused = true;
  stopStatusPolling();
  const p = fetch('/api/kiosk/sleep', {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrfHeaders(),
  })
    .then((r) => r.ok)
    .catch(() => false);
  sleepPromise = p;
  p.finally(() => { if (sleepPromise === p) sleepPromise = null; });
  return true;
}

async function resumePolling(wakeAttemptId) {
  if (sleepPromise) {
    await sleepPromise;
  }
  if (wakeAbortController) {
    wakeAbortController.abort();
  }
  const ac = new AbortController();
  wakeAbortController = ac;

  try {
    const response = await fetch('/api/kiosk/wake', {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrfHeaders(),
      signal: ac.signal,
    });
    if (!response.ok) {
      throw new Error(`wake_http_${response.status}`);
    }
    const payload = await response.json().catch(() => ({ ok: true }));
    if (payload && payload.ok === false) {
      throw new Error('wake_failed');
    }
    const snapshot = lockscreenController?.getSnapshot?.();
    if (!isCurrentWakeAttempt(snapshot, wakeAttemptId, LOCK_STATES.WAKING)) {
      return false;
    }
    resumeCamera();
    resumeScan();
    isPollingPaused = false;
    startStatusPolling();
    loadStatus();
    return true;
  } catch (error) {
    if (error?.name === 'AbortError') {
      return false;
    }
    const snapshot = lockscreenController?.getSnapshot?.();
    if (!isCurrentWakeAttempt(snapshot, wakeAttemptId, LOCK_STATES.WAKING)) {
      return false;
    }
    isPollingPaused = true;
    stopStatusPolling();
    lockscreenController?.dispatch({
      type: LOCK_EVENTS.RESUME_FAIL,
      wakeAttemptId,
      errorCode: error?.message || 'unknown',
    });
    return false;
  } finally {
    if (wakeAbortController === ac) {
      wakeAbortController = null;
    }
  }
}

function resetIdleDeadline() {
  if (idleTimeoutId !== null) {
    clearTimeout(idleTimeoutId);
  }
  idleTimeoutId = setTimeout(() => {
    lockscreenController?.dispatch({ type: LOCK_EVENTS.IDLE_TIMEOUT_45S });
  }, IDLE_TIMEOUT_MS);
}

const lockscreenController = lockscreenControllerApi?.create(
  {
    showLockscreen: () => {
      lockscreenApi?.setHint('Toca para continuar');
      lockscreenApi?.show();
    },
    hideLockscreen: () => {
      lockscreenApi?.setHint('Toca para continuar');
      lockscreenApi?.hide();
    },
    pauseCamera,
    resumeCamera,
    pauseScan,
    resumeScan,
    pausePolling,
    resumePolling,
    onResetIdleDeadline: resetIdleDeadline,
    onCameraError: () => {
      resumeCamera('camera_error');
      resumeScan();
      isPollingPaused = false;
      startStatusPolling();
      loadStatus();
      resetIdleDeadline();
    },
    logTransition: (entry) => {
      console.info('[lockscreen-fsm]', { ...entry, ts: Date.now() });
    },
    onIgnoredEvent: ({ state, wakeAttemptId, ignoredEvent }) => {
      console.debug('[lockscreen-fsm:ignored-event]', {
        state,
        ignoredEvent,
        wakeAttemptId,
        ts: Date.now(),
      });
    },
  },
  {
    lockEnterAnimMs: prefersReducedMotionQuery?.matches ? 0 : 260,
  },
);

function dispatchUserActivity() {
  lockscreenController?.dispatch({ type: LOCK_EVENTS.USER_ACTIVITY });
}

function releaseDesktopReady() {
  if (desktopReadyReleased) {
    return;
  }

  desktopReadyReleased = true;
  window.__VIREOM_DESKTOP_PENDING__ = false;
  document.documentElement.classList.remove('desktop-launch-pending');
  resumeCamera('desktop_ready');
}

initializeVideoFeed();
bindDesktopReady({
  windowObject: window,
  enabled: desktopLaunchPending,
  onReady: releaseDesktopReady,
});

document.addEventListener('pointerdown', () => {
  dispatchUserActivity();
}, { passive: true });

document.addEventListener('keydown', (event) => {
  if (lockscreenControllerApi?.shouldTriggerDebugShortcut?.(event)) {
    event.preventDefault();
    event.stopPropagation();
    lockscreenController?.dispatch({ type: LOCK_EVENTS.DEBUG_SHORTCUT });
    return;
  }
  dispatchUserActivity();
});

supportHelpButton?.addEventListener('click', openSupportHelp);
supportHelpClose?.addEventListener('click', closeSupportHelp);

/* Bloqueo por exceso de taps: pausa el reconocimiento mientras el pop-up
   está activo para que el sistema no reconozca de fondo, y lo reanuda al
   terminar la cuenta regresiva. */
document.addEventListener('tap-lockout:start', () => {
  pauseScan();
});
document.addEventListener('tap-lockout:end', () => {
  resumeScan();
  lastAutoTriggerMs = Date.now();
  loadStatus();
});

lockscreenApi?.bindTap(() => {
  lockscreenController?.dispatch({ type: LOCK_EVENTS.USER_TAP_OR_CLICK });
});

window.CameraPITheme?.initTheme();
window.CameraPITheme?.bindToggleButtons();
updateClock();
setInterval(updateClock, 1000);
startStatusPolling();
loadStatus();

/* Al cambiar idioma, re-aplicar inmediatamente:
   - systemStateBadge guarda su clave original en dataset.i18nKey
   - el resto se regenera en la siguiente llamada a loadStatus() */
document.addEventListener('i18n:change', () => {
  const badgeKey = systemStateBadge?.dataset?.i18nKey;
  if (badgeKey) {
    systemStateBadge.textContent = tr(badgeKey);
  }
  updateClock();
  loadStatus();
});
