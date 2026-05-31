export const STATES = {
  ACTIVE_UNLOCKED: 'ACTIVE_UNLOCKED',
  LOCKSCREEN_VISIBLE: 'LOCKSCREEN_VISIBLE',
  SLEEP_FORCED: 'SLEEP_FORCED',
  WAKING: 'WAKING',
};

export const EVENTS = {
  IDLE_TIMEOUT_45S: 'IDLE_TIMEOUT_45S',
  DEBUG_SHORTCUT: 'DEBUG_SHORTCUT',
  ENTER_SLEEP: 'ENTER_SLEEP',
  USER_ACTIVITY: 'USER_ACTIVITY',
  USER_TAP_OR_CLICK: 'USER_TAP_OR_CLICK',
  WAKE_READY: 'WAKE_READY',
  RESUME_FAIL: 'RESUME_FAIL',
};

export const EFFECTS = {
  RESET_IDLE_DEADLINE: 'RESET_IDLE_DEADLINE',
  SHOW_LOCKSCREEN: 'SHOW_LOCKSCREEN',
  HIDE_LOCKSCREEN: 'HIDE_LOCKSCREEN',
  SCHEDULE_ENTER_SLEEP: 'SCHEDULE_ENTER_SLEEP',
  PAUSE_CAMERA: 'PAUSE_CAMERA',
  PAUSE_SCAN: 'PAUSE_SCAN',
  PAUSE_POLLING: 'PAUSE_POLLING',
  RESUME_POLLING: 'RESUME_POLLING',
  START_WAKE_TIMEOUT: 'START_WAKE_TIMEOUT',
  CLEAR_WAKE_TIMEOUT: 'CLEAR_WAKE_TIMEOUT',
  CONSUME_LOCKSCREEN_INPUT: 'CONSUME_LOCKSCREEN_INPUT',
  LOG_IGNORED_EVENT: 'LOG_IGNORED_EVENT',
  FORCE_UNLOCK_CAMERA_ERROR: 'FORCE_UNLOCK_CAMERA_ERROR',
};

export function createInitialContext() {
  return {
    state: STATES.LOCKSCREEN_VISIBLE,
    sleepReason: 'boot',
    wakeAttemptId: 0,
    consecutiveResumeFails: 0,
    stateEnteredAt: Date.now(),
    effects: [EFFECTS.SCHEDULE_ENTER_SLEEP],
  };
}

function withEffects(ctx, effects) {
  return { ...ctx, effects };
}

function ignored(ctx) {
  return withEffects(ctx, [EFFECTS.LOG_IGNORED_EVENT]);
}

export function transition(context, event) {
  const ctx = { ...context, effects: [] };
  const type = event?.type;
  const now = Date.now();

  if (!type) {
    return ignored(ctx);
  }

  if (ctx.state === STATES.ACTIVE_UNLOCKED) {
    if (type === EVENTS.IDLE_TIMEOUT_45S) {
      return withEffects(
        { ...ctx, state: STATES.LOCKSCREEN_VISIBLE, sleepReason: 'idle', consecutiveResumeFails: 0, stateEnteredAt: now },
        [EFFECTS.SHOW_LOCKSCREEN, EFFECTS.SCHEDULE_ENTER_SLEEP],
      );
    }
    if (type === EVENTS.DEBUG_SHORTCUT) {
      return withEffects(
        { ...ctx, state: STATES.LOCKSCREEN_VISIBLE, sleepReason: 'debug', consecutiveResumeFails: 0, stateEnteredAt: now },
        [EFFECTS.SHOW_LOCKSCREEN, EFFECTS.SCHEDULE_ENTER_SLEEP],
      );
    }
    if (type === EVENTS.USER_ACTIVITY) {
      return withEffects(ctx, [EFFECTS.RESET_IDLE_DEADLINE]);
    }
    return ignored(ctx);
  }

  if (ctx.state === STATES.LOCKSCREEN_VISIBLE) {
    if (type === EVENTS.ENTER_SLEEP) {
      return withEffects(
        { ...ctx, state: STATES.SLEEP_FORCED, stateEnteredAt: now },
        [EFFECTS.PAUSE_CAMERA, EFFECTS.PAUSE_SCAN, EFFECTS.PAUSE_POLLING],
      );
    }
    if (type === EVENTS.USER_TAP_OR_CLICK) {
      return withEffects(ctx, [EFFECTS.CONSUME_LOCKSCREEN_INPUT]);
    }
    return ignored(ctx);
  }

  if (ctx.state === STATES.SLEEP_FORCED) {
    if (type === EVENTS.USER_TAP_OR_CLICK) {
      return withEffects(
        { ...ctx, state: STATES.WAKING, wakeAttemptId: ctx.wakeAttemptId + 1, stateEnteredAt: now },
        [EFFECTS.RESUME_POLLING, EFFECTS.START_WAKE_TIMEOUT],
      );
    }
    if (type === EVENTS.ENTER_SLEEP) {
      return withEffects(ctx, [EFFECTS.LOG_IGNORED_EVENT]);
    }
    return ignored(ctx);
  }

  if (ctx.state === STATES.WAKING) {
    const sameAttempt = event.wakeAttemptId === ctx.wakeAttemptId;
    if (type === EVENTS.WAKE_READY && sameAttempt) {
      return withEffects(
        { ...ctx, state: STATES.ACTIVE_UNLOCKED, consecutiveResumeFails: 0, stateEnteredAt: now },
        [EFFECTS.CLEAR_WAKE_TIMEOUT, EFFECTS.HIDE_LOCKSCREEN, EFFECTS.RESET_IDLE_DEADLINE],
      );
    }
    if (type === EVENTS.RESUME_FAIL && sameAttempt) {
      const fails = ctx.consecutiveResumeFails + 1;
      if (fails >= 2) {
        return withEffects(
          { ...ctx, state: STATES.ACTIVE_UNLOCKED, consecutiveResumeFails: 0, stateEnteredAt: now },
          [EFFECTS.CLEAR_WAKE_TIMEOUT, EFFECTS.FORCE_UNLOCK_CAMERA_ERROR, EFFECTS.RESET_IDLE_DEADLINE],
        );
      }
      return withEffects(
        { ...ctx, state: STATES.SLEEP_FORCED, consecutiveResumeFails: fails, stateEnteredAt: now },
        [EFFECTS.CLEAR_WAKE_TIMEOUT, EFFECTS.SHOW_LOCKSCREEN, EFFECTS.PAUSE_CAMERA, EFFECTS.PAUSE_SCAN, EFFECTS.PAUSE_POLLING],
      );
    }
    return ignored(ctx);
  }

  return ignored(ctx);
}

if (typeof window !== 'undefined') {
  window.CameraPILockscreenFSM = {
    STATES,
    EVENTS,
    EFFECTS,
    createInitialContext,
    transition,
  };
}
