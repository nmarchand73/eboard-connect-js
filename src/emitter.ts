type Handler = (...args: any[]) => void;

/** Minimal typed pub/sub (no Node EventEmitter dependency). */
export class TinyEmitter<Events extends Record<string, (...args: any[]) => void>> {
  private readonly listeners = new Map<keyof Events, Set<Handler>>();

  on<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as Handler);
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: Events[K]): void {
    this.listeners.get(event)?.delete(handler as Handler);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      (handler as Events[K])(...args);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
