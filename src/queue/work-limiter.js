export class WorkLimiter {
  constructor({ concurrency, maxWeight }) {
    this.concurrency = Math.max(1, Number(concurrency || 1));
    this.maxWeight = Math.max(1, Number(maxWeight || 1));
    this.activeCount = 0;
    this.activeWeight = 0;
    this.peakActiveCount = 0;
    this.queue = [];
  }

  run(task, { weight = 1, label = '' } = {}) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('WorkLimiter task must be a function.'));
    }

    const normalizedWeight = Math.min(this.maxWeight, Math.max(1, Number(weight || 1)));
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject, weight: normalizedWeight, label, queuedAt: Date.now() });
      this.drain();
    });
  }

  stats() {
    return {
      concurrency: this.concurrency,
      active: this.activeCount,
      queued: this.queue.length,
      peakActive: this.peakActiveCount,
      activeWeight: this.activeWeight,
      maxWeight: this.maxWeight
    };
  }

  drain() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const entryIndex = this.findRunnableIndex();
      if (entryIndex < 0) {
        return;
      }

      const [entry] = this.queue.splice(entryIndex, 1);
      this.activeCount += 1;
      this.activeWeight += entry.weight;
      this.peakActiveCount = Math.max(this.peakActiveCount, this.activeCount);

      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .then(() => {
          this.activeCount -= 1;
          this.activeWeight -= entry.weight;
          this.drain();
        });
    }
  }

  findRunnableIndex() {
    const remainingWeight = this.maxWeight - this.activeWeight;
    if (this.activeCount === 0) {
      return 0;
    }

    const oldest = this.queue[0];
    if (oldest.weight > remainingWeight && Date.now() - oldest.queuedAt >= 1500) {
      return -1;
    }

    return this.queue.findIndex((entry) => entry.weight <= remainingWeight);
  }
}
