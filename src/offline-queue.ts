// Persistent offline queue for fire-and-forget SDK calls (events, tags,
// receipts, subscriptions). Without this, anything tracked while the device is
// offline was silently lost — a real problem for a product whose value is
// behavioral data.
//
// Storage is pluggable: pass an AsyncStorage-compatible adapter via
// `PayghaamConfig.storage` to persist the queue across app launches. Without
// one, the queue still buffers in memory for the lifetime of the process
// (covers tunnels/airplane-mode within a session).

export interface QueueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface QueuedOp {
  method: string;
  path: string;
  body?: unknown;
  queuedAt: number;
}

const STORAGE_KEY = "payghaam.queue.v1";
const MAX_QUEUE = 200; // oldest dropped beyond this — bound memory/storage
const MAX_AGE_MS = 7 * 24 * 3600_000;

export type SendFn = (op: QueuedOp) => Promise<void>;

// Thrown (or detected) transport-level failures are retryable; HTTP 4xx
// responses (except 408/429) are not — the payload will never be accepted.
export function isRetryable(err: unknown): boolean {
  const status = (err as { statusCode?: number }).statusCode;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return true; // network error / timeout / abort
}

export class OfflineQueue {
  private ops: QueuedOp[] = [];
  private loaded = false;
  private flushing = false;

  constructor(
    private readonly send: SendFn,
    private readonly storage?: QueueStorage,
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storage) return;
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const cutoff = Date.now() - MAX_AGE_MS;
        this.ops = (JSON.parse(raw) as QueuedOp[]).filter((o) => o.queuedAt > cutoff);
      }
    } catch {
      // Corrupt queue: start fresh rather than wedge the SDK.
      this.ops = [];
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.setItem(STORAGE_KEY, JSON.stringify(this.ops));
    } catch {
      // Best-effort; in-memory copy still works.
    }
  }

  async enqueue(op: Omit<QueuedOp, "queuedAt">): Promise<void> {
    await this.load();
    this.ops.push({ ...op, queuedAt: Date.now() });
    if (this.ops.length > MAX_QUEUE) this.ops.splice(0, this.ops.length - MAX_QUEUE);
    await this.persist();
  }

  /** Drain in FIFO order. Stops at the first retryable failure (still offline);
   *  drops ops the server rejects outright. Safe to call often. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      await this.load();
      while (this.ops.length > 0) {
        const op = this.ops[0];
        try {
          await this.send(op);
          this.ops.shift();
        } catch (err) {
          if (isRetryable(err)) break; // still offline — try again later
          this.ops.shift(); // permanently rejected — don't wedge the queue
        }
      }
      await this.persist();
    } finally {
      this.flushing = false;
    }
  }

  get size(): number {
    return this.ops.length;
  }
}
