/**
 * Sim-clock scheduler.
 *
 * `setTimeout` is unusable for gameplay and presentation choreography here:
 * under software GL a single frame can block the main thread for many seconds,
 * so timeouts fire very late and then bunch together (a 500 ms and a 1120 ms
 * delay both land in the same tick). Every deferred lamp show, DMD beat, ball
 * release and mode timer therefore runs off this queue instead, which is
 * drained inside the fixed-step update with the simulation's own dt.
 *
 * Tasks may optionally carry a `key`, in which case scheduling a new task with
 * that key cancels the pending one — handy for "restart the flourish" cases.
 */
export class Scheduler {
  constructor() {
    this.tasks = [];
    this.t = 0;
  }

  /** Run `fn` after `delay` seconds of simulation time. */
  after(delay, fn, key = null) {
    if (key) this.cancel(key);
    const task = { at: this.t + Math.max(0, delay), fn, key, every: 0 };
    this.tasks.push(task);
    return task;
  }

  /** Run `fn` every `period` seconds, starting after `delay`. */
  every(period, fn, delay = period, key = null) {
    if (key) this.cancel(key);
    const task = { at: this.t + Math.max(0, delay), fn, key, every: Math.max(0.001, period) };
    this.tasks.push(task);
    return task;
  }

  cancel(key) {
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      if (this.tasks[i].key === key) this.tasks.splice(i, 1);
    }
  }

  clear() {
    this.tasks.length = 0;
  }

  update(dt) {
    this.t += dt;
    if (!this.tasks.length) return;
    // Repeating tasks are re-armed relative to *now*, never to their nominal
    // schedule: catching up on twelve missed beats after a 15 s shader compile
    // would fire a dozen solenoids in one frame.
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i];
      if (this.t < task.at) continue;
      if (task.every > 0) task.at = this.t + task.every;
      else this.tasks.splice(i, 1);
      try {
        task.fn();
      } catch (e) {
        console.error('scheduler task failed', e);
      }
    }
  }
}
