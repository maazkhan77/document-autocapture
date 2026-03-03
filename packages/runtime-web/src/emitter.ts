export class TypedEmitter<T extends object> {
  private listeners = new Map<keyof T, Set<(payload: T[keyof T]) => void>>();

  on<K extends keyof T>(event: K, handler: (payload: T[K]) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: T[keyof T]) => void);
    this.listeners.set(event, set);
    return () => {
      set.delete(handler as (payload: T[keyof T]) => void);
    };
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        (handler as (value: T[K]) => void)(payload);
      } catch {
        // Never throw from event fanout.
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
