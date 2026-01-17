export class Clock {
  private lastReal = 0;
  private acc = 0;
  private readonly step: number;
  private speed = 1;
  private paused = false;

  constructor(ticksPerSecond: number) { this.step = 1 / ticksPerSecond; }
  setSpeed(mult: number) { this.speed = mult; }
  setPaused(p: boolean) { this.paused = p; }
  togglePause() { this.paused = !this.paused; }
  get isPaused() { return this.paused; }

  advance(nowSec: number): number {
    if (!this.lastReal) this.lastReal = nowSec;
    const realDt = nowSec - this.lastReal;
    this.lastReal = nowSec;
    if (this.paused) return 0;

    this.acc += realDt * this.speed;
    let steps = 0;
    while (this.acc >= this.step) { this.acc -= this.step; steps++; }
    return steps;
  }

  stepOnce(): number { return 1; } // allow stepping while paused
}
