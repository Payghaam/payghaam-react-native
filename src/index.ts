import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { ApiClient, EngageKaroConfig, SubscriptionType } from "./api-client";
import {
  collectDeviceContext,
  noteForegroundResume,
  wireAppStateSession,
} from "./device-context";

interface EngageKaroNativePush {
  requestPermission(): Promise<boolean>;
  getToken(): Promise<string | null>;
  getInitialNotification(): Promise<Record<string, unknown> | null>;
  setSharedConfig(config: Record<string, string>): Promise<void>;
}

const NativePush: EngageKaroNativePush | undefined =
  NativeModules.EngagekaroReactNative as EngageKaroNativePush | undefined;

const emitter = NativePush ? new NativeEventEmitter(NativeModules.EngagekaroReactNative) : null;

let config: EngageKaroConfig | null = null;
let api: ApiClient | null = null;
let externalId: string | null = null;
let consentGiven = true;
let pendingToken: string | null = null;
let pushPermission: string | undefined;
const subs: (() => void)[] = [];

function canSend(): boolean {
  return !!config && !!api && (!config.requireConsent || consentGiven);
}

async function pingDeviceContext(sessionStart = false): Promise<void> {
  if (!canSend() || !api || !externalId) return;
  try {
    const countSession = sessionStart && noteForegroundResume();
    const ctx = await collectDeviceContext({
      sessionStart: countSession,
      pushPermission,
    });
    await api.identify(externalId, ctx as Record<string, unknown>);
  } catch {
    // Best-effort device profile sync.
  }
}

async function runPostLoginTasks(): Promise<void> {
  if (!canSend() || !api || !externalId) return;
  const token = pendingToken ?? (await NativePush?.getToken()) ?? null;
  if (token) await registerToken(token);
  await pingDeviceContext(true);
}

async function registerToken(token: string): Promise<void> {
  if (!canSend() || !api) return;
  if (!externalId) {
    pendingToken = token;
    return;
  }
  const type: SubscriptionType = Platform.OS === "ios" ? "IOS_PUSH" : "ANDROID_PUSH";
  await api.addSubscription(externalId, type, token);
  pendingToken = null;
}

function reportFromData(data: Record<string, unknown>, event: string): void {
  const messageId = data.ek_message_id;
  if (typeof messageId !== "string" || !messageId || !api || !canSend()) return;
  void api.reportReceipt(messageId, event, externalId ?? undefined, data);
}

function wirePushListeners(): void {
  if (!emitter) return;
  subs.push(
    emitter.addListener("onToken", (token: unknown) => {
      if (typeof token === "string") void registerToken(token);
    }).remove,
  );
  subs.push(
    emitter.addListener("onOpened", (data: unknown) => {
      if (data && typeof data === "object") reportFromData(data as Record<string, unknown>, "opened");
    }).remove,
  );
  subs.push(
    emitter.addListener("onForeground", (data: unknown) => {
      if (data && typeof data === "object") reportFromData(data as Record<string, unknown>, "delivered");
    }).remove,
  );
}

/** EngageKaro React Native SDK */
export const EngageKaro = {
  /** Initialize once at app start. */
  initialize(cfg: EngageKaroConfig): void {
    config = cfg;
    api = new ApiClient(cfg);
    consentGiven = !cfg.requireConsent;
    wirePushListeners();
    // On foreground: session ping + drain anything queued while offline.
    subs.push(
      wireAppStateSession(() => {
        void pingDeviceContext(true);
        void api?.flushQueue();
      }),
    );
    void api.flushQueue();
    void NativePush?.getInitialNotification().then((n) => {
      if (n) reportFromData(n, "opened");
    });
    void pingDeviceContext(true);
  },

  /** Identify the current user by your backend user id. */
  login(id: string, identityHash?: string): void {
    externalId = id;
    if (api) api.identityHash = identityHash;
    if (!canSend() || !api) return;
    void runPostLoginTasks();
  },

  async logout(): Promise<void> {
    externalId = null;
    if (api) api.identityHash = undefined;
  },

  async trackEvent(name: string, properties?: Record<string, unknown>): Promise<void> {
    if (!canSend() || !api) return;
    await api.track(name, externalId ?? undefined, properties);
  },

  async addTag(key: string, value: unknown): Promise<void> {
    return EngageKaro.addTags({ [key]: value });
  },

  async addTags(tags: Record<string, unknown>): Promise<void> {
    if (!canSend() || !api || !externalId) throw new Error("Call login() first");
    await api.updateTags(externalId, tags);
  },

  async requestPushPermission(): Promise<boolean> {
    if (!NativePush) return false;
    const granted = await NativePush.requestPermission();
    pushPermission = granted ? "granted" : "denied";
    if (granted) {
      void (async () => {
        const token = await NativePush.getToken();
        if (token) await registerToken(token);
        await pingDeviceContext();
      })();
    } else if (externalId) {
      void pingDeviceContext();
    }
    return granted;
  },

  /** iOS: share config with Notification Service Extension via App Group. */
  async shareConfig(opts: {
    appGroup?: string;
    apiBase: string;
    apiKey: string;
    externalId: string;
  }): Promise<void> {
    if (!NativePush?.setSharedConfig) return;
    await NativePush.setSharedConfig({
      appGroup: opts.appGroup ?? "",
      apiBase: opts.apiBase,
      apiKey: opts.apiKey,
      externalId: opts.externalId,
    });
  },

  dispose(): void {
    subs.forEach((u) => u());
    subs.length = 0;
  },
};

export type { EngageKaroConfig };
export { EngageKaroApiError } from "./api-client";
