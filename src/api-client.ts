export type SubscriptionType =
  | "ANDROID_PUSH"
  | "IOS_PUSH"
  | "WEB_PUSH"
  | "EMAIL"
  | "SMS";

import { OfflineQueue, QueueStorage, QueuedOp, isRetryable } from "./offline-queue";

export interface EngageKaroConfig {
  appId: string;
  apiKey: string;
  baseUrl: string;
  requireConsent?: boolean;
  timeoutMs?: number;
  /** AsyncStorage-compatible adapter; enables the offline queue to persist
   *  across app launches (e.g. pass AsyncStorage from
   *  \@react-native-async-storage/async-storage). */
  storage?: QueueStorage;
}

export class EngageKaroApiError extends Error {
  constructor(
    public statusCode: number,
    public body: string,
  ) {
    super(`EngageKaroApiError(${statusCode}): ${body}`);
  }
}

function apiRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/sdk`;
}

export class ApiClient {
  identityHash?: string;
  readonly queue: OfflineQueue;

  constructor(private readonly config: EngageKaroConfig) {
    this.queue = new OfflineQueue(
      (op: QueuedOp) => this.request(op.method, op.path, op.body),
      config.storage,
    );
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "X-Api-Key": this.config.apiKey,
    };
    if (this.identityHash) h["X-Engagekaro-Identity-Hash"] = this.identityHash;
    return h;
  }

  private async request(method: string, path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${apiRoot(this.config.baseUrl)}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new EngageKaroApiError(res.status, await res.text());
  }

  // Fire-and-forget path: try to send immediately; on a retryable failure
  // (offline, timeout, 5xx) park the call in the offline queue. After any
  // success, opportunistically drain whatever the queue accumulated.
  private async sendOrQueue(method: string, path: string, body?: unknown): Promise<void> {
    try {
      await this.request(method, path, body);
      void this.queue.flush();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      await this.queue.enqueue({ method, path, body });
    }
  }

  /** Drain the offline queue (called on init / app-foreground / login). */
  flushQueue(): Promise<void> {
    return this.queue.flush();
  }

  identify(externalId: string, deviceContext?: Record<string, unknown>): Promise<void> {
    return this.sendOrQueue("POST", "/users", {
      externalId,
      ...(deviceContext ?? {}),
    });
  }

  addSubscription(
    externalId: string,
    type: SubscriptionType,
    token: string,
  ): Promise<void> {
    return this.sendOrQueue("POST", `/users/${externalId}/subscriptions`, { type, token });
  }

  updateTags(externalId: string, tags: Record<string, unknown>): Promise<void> {
    return this.sendOrQueue("PUT", `/users/${externalId}/tags`, { tags });
  }

  track(name: string, externalId?: string, properties?: Record<string, unknown>): Promise<void> {
    return this.sendOrQueue("POST", "/events", {
      name,
      ...(externalId ? { externalId } : {}),
      ...(properties ? { properties } : {}),
    });
  }

  reportReceipt(
    messageId: string,
    event: string,
    externalId?: string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    return this.sendOrQueue("POST", "/receipts", {
      messageId,
      event,
      ...(externalId ? { externalId } : {}),
      ...(properties ? { properties } : {}),
    });
  }
}
