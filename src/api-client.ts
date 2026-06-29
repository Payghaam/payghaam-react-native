export type SubscriptionType =
  | "ANDROID_PUSH"
  | "IOS_PUSH"
  | "WEB_PUSH"
  | "EMAIL"
  | "SMS";

export interface EngageKaroConfig {
  appId: string;
  apiKey: string;
  baseUrl: string;
  requireConsent?: boolean;
  timeoutMs?: number;
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

  constructor(private readonly config: EngageKaroConfig) {}

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

  identify(externalId: string, deviceContext?: Record<string, unknown>): Promise<void> {
    return this.request("POST", "/users", {
      externalId,
      ...(deviceContext ?? {}),
    });
  }

  addSubscription(
    externalId: string,
    type: SubscriptionType,
    token: string,
  ): Promise<void> {
    return this.request("POST", `/users/${externalId}/subscriptions`, { type, token });
  }

  updateTags(externalId: string, tags: Record<string, unknown>): Promise<void> {
    return this.request("PUT", `/users/${externalId}/tags`, { tags });
  }

  track(name: string, externalId?: string, properties?: Record<string, unknown>): Promise<void> {
    return this.request("POST", "/events", {
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
    return this.request("POST", "/receipts", {
      messageId,
      event,
      ...(externalId ? { externalId } : {}),
      ...(properties ? { properties } : {}),
    });
  }
}
