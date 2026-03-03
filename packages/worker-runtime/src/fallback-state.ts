export type WorkerDetectorMode = 'cv' | 'hybrid' | 'ml';
export type WorkerFallbackState = 'inactive' | 'armed' | 'active';

export interface FallbackStepInput {
  cvFound: boolean;
  cvScore: number;
}

export interface FallbackStepConfig {
  mode: WorkerDetectorMode;
  mlFallbackEnabled: boolean;
  triggerMisses: number;
  lowConfidenceThreshold: number;
  lowConfidenceFrames: number;
  exitRecoveries: number;
  reentryCooldownFrames: number;
  recoveryConfidence: number;
}

export interface FallbackStepOutput {
  state: WorkerFallbackState;
  active: boolean;
  entered: boolean;
  exited: boolean;
  activeFrameCounter: number;
}

export class FallbackStateMachine {
  private active = false;

  private misses = 0;

  private lowConfidence = 0;

  private recoveries = 0;

  private cooldown = 0;

  private activeFrameCounter = 0;

  private state: WorkerFallbackState = 'inactive';

  reset(): void {
    this.active = false;
    this.misses = 0;
    this.lowConfidence = 0;
    this.recoveries = 0;
    this.cooldown = 0;
    this.activeFrameCounter = 0;
    this.state = 'inactive';
  }

  step(input: FallbackStepInput, config: FallbackStepConfig): FallbackStepOutput {
    const triggerMisses = Math.max(1, config.triggerMisses);
    const lowConfidenceFrames = Math.max(1, config.lowConfidenceFrames);
    const exitRecoveries = Math.max(1, config.exitRecoveries);
    const reentryCooldownFrames = Math.max(0, config.reentryCooldownFrames);
    const lowConfidenceThreshold = Math.max(0, Math.min(1, config.lowConfidenceThreshold));
    const recoveryConfidence = Math.max(0, Math.min(1, config.recoveryConfidence));

    if (config.mode === 'cv' || (config.mode === 'hybrid' && !config.mlFallbackEnabled)) {
      this.reset();
      return {
        state: 'inactive',
        active: false,
        entered: false,
        exited: false,
        activeFrameCounter: 0,
      };
    }

    const cvConfident = input.cvFound && input.cvScore >= lowConfidenceThreshold;
    if (!cvConfident) {
      this.misses += 1;
    } else {
      this.misses = 0;
    }

    if (input.cvScore < lowConfidenceThreshold) {
      this.lowConfidence += 1;
    } else {
      this.lowConfidence = 0;
    }

    if (input.cvFound && input.cvScore >= recoveryConfidence) {
      this.recoveries += 1;
    } else {
      this.recoveries = 0;
    }

    if (this.cooldown > 0) {
      this.cooldown -= 1;
    }

    let entered = false;
    let exited = false;

    if (config.mode === 'ml') {
      if (!this.active) {
        entered = true;
      }
      this.active = true;
    } else {
      if (this.active && this.recoveries >= exitRecoveries) {
        this.active = false;
        exited = true;
        this.cooldown = reentryCooldownFrames;
        this.misses = 0;
        this.lowConfidence = 0;
        this.recoveries = 0;
        this.activeFrameCounter = 0;
      }

      if (
        !this.active &&
        this.cooldown === 0 &&
        (this.misses >= triggerMisses || this.lowConfidence >= lowConfidenceFrames)
      ) {
        this.active = true;
        entered = true;
        this.activeFrameCounter = 0;
      }
    }

    if (this.active) {
      this.state = 'active';
      this.activeFrameCounter += 1;
    } else if (this.misses > 0 || this.lowConfidence > 0 || this.cooldown > 0) {
      this.state = 'armed';
      this.activeFrameCounter = 0;
    } else {
      this.state = 'inactive';
      this.activeFrameCounter = 0;
    }

    return {
      state: this.state,
      active: this.active,
      entered,
      exited,
      activeFrameCounter: this.activeFrameCounter,
    };
  }
}
