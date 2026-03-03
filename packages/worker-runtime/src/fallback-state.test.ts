import { describe, expect, it } from 'vitest';
import { FallbackStateMachine } from './fallback-state';

const hybridConfig = {
  mode: 'hybrid' as const,
  mlFallbackEnabled: true,
  triggerMisses: 8,
  lowConfidenceThreshold: 0.35,
  lowConfidenceFrames: 5,
  exitRecoveries: 3,
  reentryCooldownFrames: 10,
  recoveryConfidence: 0.45,
};

describe('FallbackStateMachine', () => {
  it('enters active fallback after consecutive misses', () => {
    const machine = new FallbackStateMachine();
    let state = 'inactive';
    for (let i = 0; i < 8; i += 1) {
      const out = machine.step({ cvFound: false, cvScore: 0 }, hybridConfig);
      state = out.state;
    }
    expect(state).toBe('active');
  });

  it('exits active fallback after consecutive CV recoveries and arms cooldown', () => {
    const machine = new FallbackStateMachine();
    for (let i = 0; i < 8; i += 1) {
      machine.step({ cvFound: false, cvScore: 0 }, hybridConfig);
    }
    const recovery1 = machine.step({ cvFound: true, cvScore: 0.52 }, hybridConfig);
    const recovery2 = machine.step({ cvFound: true, cvScore: 0.55 }, hybridConfig);
    const recovery3 = machine.step({ cvFound: true, cvScore: 0.58 }, hybridConfig);
    expect(recovery1.state).toBe('active');
    expect(recovery2.state).toBe('active');
    expect(recovery3.state).toBe('armed');
    expect(recovery3.exited).toBe(true);
  });

  it('does not re-enter fallback during cooldown', () => {
    const machine = new FallbackStateMachine();
    for (let i = 0; i < 8; i += 1) {
      machine.step({ cvFound: false, cvScore: 0 }, hybridConfig);
    }
    for (let i = 0; i < 3; i += 1) {
      machine.step({ cvFound: true, cvScore: 0.6 }, hybridConfig);
    }

    let inCooldownArmed = false;
    for (let i = 0; i < 5; i += 1) {
      const out = machine.step({ cvFound: false, cvScore: 0 }, hybridConfig);
      if (out.state === 'armed') {
        inCooldownArmed = true;
      }
      expect(out.state).not.toBe('active');
    }
    expect(inCooldownArmed).toBe(true);
  });

  it('forces active fallback in ml mode', () => {
    const machine = new FallbackStateMachine();
    const out = machine.step(
      { cvFound: true, cvScore: 0.9 },
      {
        ...hybridConfig,
        mode: 'ml',
      },
    );
    expect(out.state).toBe('active');
    expect(out.active).toBe(true);
  });

  it('stays inactive in cv mode', () => {
    const machine = new FallbackStateMachine();
    const out = machine.step(
      { cvFound: false, cvScore: 0 },
      {
        ...hybridConfig,
        mode: 'cv',
      },
    );
    expect(out.state).toBe('inactive');
    expect(out.active).toBe(false);
  });
});
