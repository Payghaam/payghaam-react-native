export type SubscriptionType =
  | "ANDROID_PUSH"
  | "IOS_PUSH"
  | "WEB_PUSH"
  | "EMAIL"
  | "SMS";

import { OfflineQueue, QueueStorage, QueuedOp, isRetryable } from "./offline-queue";

export interface PayghaamConfig {
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

export class PayghaamApiError extends Error {
  constructor(
    public statusCode: number,
    public body: string,
  ) {
    super(`PayghaamApiError(${statusCode}): ${body}`);
  }
}

function apiRoot(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/sdk`;
}

export class ApiClient {
  identityHash?: string;
  readonly queue: OfflineQueue;

  constructor(private readonly config: PayghaamConfig) {
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
    if (this.identityHash) h["X-Payghaam-Identity-Hash"] = this.identityHash;
    return h;
  }

  private async request(method: string, path: string, body?: unknown): Promise<void> {
    const res = await fetch(`${apiRoot(this.config.baseUrl)}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new PayghaamApiError(res.status, await res.text());
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

  identify(
    target:
      | string
      | {
          externalId?: string;
          anonymousId?: string;
          language?: string;
          aliases?: Array<{ label: string; value: string }>;
          deviceContext?: Record<string, unknown>;
        },
    deviceContext?: Record<string, unknown>,
  ): Promise<void> {
    if (typeof target === "string") {
      return this.sendOrQueue("POST", "/users", {
        externalId: target,
        ...(deviceContext ?? {}),
      });
    }
    const { externalId, anonymousId, language, aliases, deviceContext: ctx } = target;
    return this.sendOrQueue("POST", "/users", {
      ...(externalId ? { externalId } : {}),
      ...(anonymousId ? { anonymousId } : {}),
      ...(language ? { language } : {}),
      ...(aliases ? { aliases } : {}),
      ...(ctx ?? {}),
    });
  }

  addSubscription(
    target:
      | string
      | {
          externalId?: string;
          anonymousId?: string;
          type: SubscriptionType;
          token: string;
        },
    type?: SubscriptionType,
    token?: string,
  ): Promise<void> {
    if (typeof target === "string") {
      return this.sendOrQueue("POST", "/subscriptions", { externalId: target, type, token });
    }
    return this.sendOrQueue("POST", "/subscriptions", {
      ...(target.externalId ? { externalId: target.externalId } : {}),
      ...(target.anonymousId ? { anonymousId: target.anonymousId } : {}),
      type: target.type,
      token: target.token,
    });
  }

  removeSubscription(
    target:
      | string
      | {
          externalId?: string;
          anonymousId?: string;
          type: SubscriptionType;
          token: string;
        },
    type?: SubscriptionType,
    token?: string,
  ): Promise<void> {
    if (typeof target === "string") {
      return this.sendOrQueue("POST", "/subscriptions/remove", { externalId: target, type, token });
    }
    return this.sendOrQueue("POST", "/subscriptions/remove", {
      ...(target.externalId ? { externalId: target.externalId } : {}),
      ...(target.anonymousId ? { anonymousId: target.anonymousId } : {}),
      type: target.type,
      token: target.token,
    });
  }

  updateTags(
    target:
      | string
      | {
          externalId?: string;
          anonymousId?: string;
          tags: Record<string, unknown>;
        },
    tags?: Record<string, unknown>,
  ): Promise<void> {
    if (typeof target === "string") {
      return this.sendOrQueue("PUT", "/tags", { externalId: target, tags });
    }
    return this.sendOrQueue("PUT", "/tags", {
      ...(target.externalId ? { externalId: target.externalId } : {}),
      ...(target.anonymousId ? { anonymousId: target.anonymousId } : {}),
      tags: target.tags,
    });
  }

  addAliases(
    aliases: Record<string, string>,
    target?: { externalId?: string; anonymousId?: string },
  ): Promise<void> {
    const list = Object.entries(aliases).map(([label, value]) => ({ label, value }));
    return this.sendOrQueue("POST", "/users", {
      ...(target?.externalId ? { externalId: target.externalId } : {}),
      ...(target?.anonymousId ? { anonymousId: target.anonymousId } : {}),
      aliases: list,
    });
  }

  track(
    name: string,
    target?: { externalId?: string; anonymousId?: string } | string,
    properties?: Record<string, unknown>,
  ): Promise<void> {
    const extId = typeof target === "string" ? target : target?.externalId;
    const anonId = typeof target === "object" ? target.anonymousId : undefined;
    return this.sendOrQueue("POST", "/events", {
      name,
      ...(extId ? { externalId: extId } : {}),
      ...(anonId ? { anonymousId: anonId } : {}),
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
