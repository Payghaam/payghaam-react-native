import { Linking, NativeEventEmitter, NativeModules, Platform } from "react-native";
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

/** Payload of a tapped notification: your `data` keys plus EngageKaro's `ek_*` keys. */
export type NotificationPayload = Record<string, unknown>;
type OpenedHandler = (payload: NotificationPayload) => void;

const openedHandlers = new Set<OpenedHandler>();
/** A tap that landed before any handler was registered (cold start), replayed on subscribe. */
let bufferedOpened: NotificationPayload | null = null;
/**
 * How long a cold-launch tap waits for the app to call onNotificationOpened before
 * the SDK decides nobody is listening and opens the deep link itself. The tap is
 * read during initialize(), necessarily before the app can subscribe, so without
 * this window the fallback would always beat an app that does its own routing.
 */
const OPENED_HANDLER_GRACE_MS = 400;

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

/** `ek_url` if the payload carries a usable deep link. */
function deepLinkFrom(data: NotificationPayload): string | null {
  const raw = data.ek_url;
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  return url ? url : null;
}

/**
 * Route a notification tap: always report the receipt, then hand the payload to
 * the app's handlers if it registered any, else fall back to opening `ek_url`.
 */
async function dispatchOpened(data: NotificationPayload, allowGrace = false): Promise<void> {
  reportFromData(data, "opened");

  if (allowGrace && openedHandlers.size === 0) {
    await new Promise((resolve) => setTimeout(resolve, OPENED_HANDLER_GRACE_MS));
  }
  if (openedHandlers.size > 0) {
    openedHandlers.forEach((handler) => handler(data));
    return;
  }

  // Buffer only when nothing was done with the tap, so a handler that registers
  // late doesn't re-handle a link we already opened.
  const url = deepLinkFrom(data);
  if (!url) {
    bufferedOpened = data;
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    // Nothing on the device claims this scheme — keep it for a late handler.
    bufferedOpened = data;
  }
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
      if (data && typeof data === "object") void dispatchOpened(data as NotificationPayload);
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
      if (n) void dispatchOpened(n, true);
    });
    void pingDeviceContext(true);
  },

  /**
   * Subscribe to notification taps. The handler receives the full push payload —
   * your custom `data` keys plus EngageKaro's own `ek_*` keys.
   *
   * ```ts
   * EngageKaro.onNotificationOpened((payload) => {
   *   if (typeof payload.targetId === "string") navigate("Offer", { id: payload.targetId });
   * });
   * ```
   * With no handler registered, the SDK opens `ek_url` (the campaign's deep link)
   * itself. Registering one suppresses that — routing becomes yours, including the
   * deep link, available as `payload.ek_url`.
   *
   * A tap that cold-launched the app is replayed to a handler registered shortly
   * after, so it is never dropped. Returns an unsubscribe function.
   */
  onNotificationOpened(handler: (payload: NotificationPayload) => void): () => void {
    openedHandlers.add(handler);
    const buffered = bufferedOpened;
    if (buffered) {
      bufferedOpened = null;
      handler(buffered);
    }
    return () => {
      openedHandlers.delete(handler);
    };
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
    openedHandlers.clear();
    bufferedOpened = null;
  },
};

export type { EngageKaroConfig };
export { EngageKaroApiError } from "./api-client";
