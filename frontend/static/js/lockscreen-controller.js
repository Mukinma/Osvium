import { createInitialContext, transition, EVENTS, STATES, EFFECTS } from './lockscreen-fsm.js';

const DEFAULTS = {
  lockEnterAnimMs: 260,
  resumeTimeoutMs: 8000,
};

function noop() {}

export function shouldTriggerDebugShortcut(event) {
  const key = String(event?.key || '').toLowerCase();
  const hasModifier = Boolean(event?.ctrlKey || event?.metaKey);
  return hasModifier && Boolean(event?.shiftKey) && key === 'l';
}

export function createLockscreenController(deps = {}, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const api = {
    showLockscreen: deps.showLockscreen || noop,
    hideLockscreen: deps.hideLockscreen || noop,
    pauseCamera: deps.pauseCamera || (() => true),
    resumeCamera: deps.resumeCamera || (() => true),
    pauseScan: deps.pauseScan || (() => true),
    resumeScan: deps.resumeScan || (() => true),
    pausePolling: deps.pausePolling || (() => true),
    resumePolling: deps.resumePolling || (() => true),
    onResetIdleDeadline: deps.onResetIdleDeadline || noop,
    onCameraError: deps.onCameraError || noop,
    setTimeoutFn: deps.setTimeoutFn || ((fn, ms) => setTimeout(fn, ms)),
    clearTimeoutFn: deps.clearTimeoutFn || ((id) => clearTimeout(id)),
    logTransition: deps.logTransition || noop,
    onIgnoredEvent: deps.onIgnoredEvent || noop,
  };

  let ctx = createInitialContext();
  let enterSleepTimer = null;
  let wakeTimeoutTimer = null;

  function clearEnterSleepTimer() {
    if (enterSleepTimer != null) {
      api.clearTimeoutFn(enterSleepTimer);
      enterSleepTimer = null;
    }
  }

  function clearWakeTimeoutTimer() {
    if (wakeTimeoutTimer != null) {
      api.clearTimeoutFn(wakeTimeoutTimer);
      wakeTimeoutTimer = null;
    }
  }

  function applyEffects(nextCtx, sourceEvent) {
    for (const effect of nextCtx.effects) {
      if (effect === EFFECTS.SHOW_LOCKSCREEN) api.showLockscreen();
      if (effect === EFFECTS.HIDE_LOCKSCREEN) api.hideLockscreen();
      if (effect === EFFECTS.PAUSE_CAMERA) api.pauseCamera();
      if (effect === EFFECTS.PAUSE_SCAN) api.pauseScan();
      if (effect === EFFECTS.PAUSE_POLLING) api.pausePolling();
      if (effect === EFFECTS.RESUME_POLLING) api.resumePolling(nextCtx.wakeAttemptId);
      if (effect === EFFECTS.RESET_IDLE_DEADLINE) api.onResetIdleDeadline();
      if (effect === EFFECTS.LOG_IGNORED_EVENT) {
        api.onIgnoredEvent({
          state: nextCtx.state,
          wakeAttemptId: nextCtx.wakeAttemptId,
          ignoredEvent: sourceEvent?.type || 'UNKNOWN',
        });
      }

      if (effect === EFFECTS.SCHEDULE_ENTER_SLEEP) {
        clearEnterSleepTimer();
        enterSleepTimer = api.setTimeoutFn(() => {
          enterSleepTimer = null;
          dispatch({ type: EVENTS.ENTER_SLEEP });
        }, config.lockEnterAnimMs);
      }

      if (effect === EFFECTS.START_WAKE_TIMEOUT) {
        clearWakeTimeoutTimer();
        const wakeAttemptId = nextCtx.wakeAttemptId;
        wakeTimeoutTimer = api.setTimeoutFn(() => {
          wakeTimeoutTimer = null;
          dispatch({ type: EVENTS.RESUME_FAIL, wakeAttemptId });
        }, config.resumeTimeoutMs);
      }

      if (effect === EFFECTS.CLEAR_WAKE_TIMEOUT) {
        clearWakeTimeoutTimer();
      }

      if (effect === EFFECTS.FORCE_UNLOCK_CAMERA_ERROR) {
        api.hideLockscreen();
        api.onCameraError();
      }
    }
  }

  function dispatch(event) {
    const prevCtx = ctx;
    const nextCtx = transition(prevCtx, event);
    ctx = nextCtx;

    const stateChanged = prevCtx.state !== nextCtx.state;
    const durationMs = stateChanged && prevCtx.stateEnteredAt
      ? Date.now() - prevCtx.stateEnteredAt
      : 0;

    let resumeContext;
    if (prevCtx.state === STATES.WAKING && stateChanged) {
      if (nextCtx.state !== STATES.ACTIVE_UNLOCKED) {
        resumeContext = 'resume_fail';
      } else if (nextCtx.effects.some((e) => e === EFFECTS.FORCE_UNLOCK_CAMERA_ERROR)) {
        resumeContext = 'forced_unlock';
      } else {
        resumeContext = 'ok';
      }
    }

    api.logTransition({
      fromState: prevCtx.state,
      toState: nextCtx.state,
      event: event?.type || 'UNKNOWN',
      wakeAttemptId: nextCtx.wakeAttemptId,
      sleepReason: nextCtx.sleepReason,
      durationMs,
      ...(resumeContext !== undefined && { resumeContext }),
      ...(event?.errorCode != null && { errorCode: event.errorCode }),
    });
    applyEffects(nextCtx, event);
    return nextCtx;
  }

  function getSnapshot() {
    return { ...ctx, effects: [...ctx.effects] };
  }

  function destroy() {
    clearEnterSleepTimer();
    clearWakeTimeoutTimer();
  }

  if (ctx.effects.length > 0) {
    applyEffects(ctx, null);
    ctx = { ...ctx, effects: [] };
  }

  return {
    dispatch,
    getSnapshot,
    destroy,
  };
}

export { EVENTS, STATES, EFFECTS };

if (typeof window !== 'undefined') {
  window.CameraPILockscreenController = {
    create: createLockscreenController,
    EVENTS,
    STATES,
    shouldTriggerDebugShortcut,
  };
}
