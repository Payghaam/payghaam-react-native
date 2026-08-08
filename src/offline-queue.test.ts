import { describe, expect, it } from "vitest";
import { OfflineQueue, QueuedOp, isRetryable } from "./offline-queue";
import { PayghaamApiError } from "./api-client";

class MemoryStorage {
  private data = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

describe("OfflineQueue", () => {
  it("drains FIFO once the network is back", async () => {
    const sent: QueuedOp[] = [];
    let online = false;
    const q = new OfflineQueue(async (op) => {
      if (!online) throw new TypeError("network request failed");
      sent.push(op);
    }, new MemoryStorage());

    await q.enqueue({ method: "POST", path: "/events", body: { name: "a" } });
    await q.enqueue({ method: "POST", path: "/events", body: { name: "b" } });
    await q.flush(); // offline: nothing drains
    expect(sent).toHaveLength(0);
    expect(q.size).toBe(2);

    online = true;
    await q.flush();
    expect(sent.map((o) => (o.body as { name: string }).name)).toEqual(["a", "b"]);
    expect(q.size).toBe(0);
  });

  it("drops ops the server permanently rejects instead of wedging", async () => {
    const sent: QueuedOp[] = [];
    const q = new OfflineQueue(async (op) => {
      if ((op.body as { name: string }).name === "bad") {
        throw new PayghaamApiError(400, "invalid");
      }
      sent.push(op);
    }, new MemoryStorage());

    await q.enqueue({ method: "POST", path: "/events", body: { name: "bad" } });
    await q.enqueue({ method: "POST", path: "/events", body: { name: "good" } });
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(q.size).toBe(0);
  });

  it("persists across instances via storage", async () => {
    const storage = new MemoryStorage();
    const q1 = new OfflineQueue(async () => {
      throw new TypeError("offline");
    }, storage);
    await q1.enqueue({ method: "POST", path: "/events", body: { name: "x" } });

    const sent: QueuedOp[] = [];
    const q2 = new OfflineQueue(async (op) => {
      sent.push(op);
    }, storage);
    await q2.flush();
    expect(sent).toHaveLength(1);
  });

  it("classifies retryability by status code", () => {
    expect(isRetryable(new PayghaamApiError(500, ""))).toBe(true);
    expect(isRetryable(new PayghaamApiError(429, ""))).toBe(true);
    expect(isRetryable(new PayghaamApiError(408, ""))).toBe(true);
    expect(isRetryable(new PayghaamApiError(400, ""))).toBe(false);
    expect(isRetryable(new PayghaamApiError(401, ""))).toBe(false);
    expect(isRetryable(new TypeError("network request failed"))).toBe(true);
  });

  it("bounds the queue at 200 ops, dropping oldest", async () => {
    const q = new OfflineQueue(async () => {
      throw new TypeError("offline");
    }, new MemoryStorage());
    for (let i = 0; i < 210; i++) {
      await q.enqueue({ method: "POST", path: "/events", body: { i } });
    }
    expect(q.size).toBe(200);
  });
});
