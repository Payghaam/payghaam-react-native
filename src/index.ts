import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { ApiClient, EngageKaroConfig, SubscriptionType } from "./api-client";

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
const subs: (() => void)[] = [];

function canSend(): boolean {
  return !!config && !!api && (!config.requireConsent || consentGiven);
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
    void NativePush?.getInitialNotification().then((n) => {
      if (n) reportFromData(n, "opened");
    });
  },

  /** Identify the current user by your backend user id. */
  async login(id: string, identityHash?: string): Promise<void> {
    externalId = id;
    if (api) api.identityHash = identityHash;
    if (!canSend() || !api) return;
    await api.identify(id);
    const token = pendingToken ?? (await NativePush?.getToken()) ?? null;
    if (token) await registerToken(token);
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
    if (granted) {
      const token = await NativePush.getToken();
      if (token) await registerToken(token);
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
