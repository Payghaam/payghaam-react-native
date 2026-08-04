import { Linking, NativeEventEmitter, NativeModules, Platform } from "react-native";
import { ApiClient, EngageKaroApiError, EngageKaroConfig, SubscriptionType } from "./api-client";
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
  // ── Cross-platform API bridge (sdk-native-wrapper-design.md §4.5) ─────────
  // Proxies a single call through the canonical native SDK's ApiClient +
  // offline queue. Falls back to `ApiClient` below (the `fetch`-based
  // implementation) if this native module isn't present at all — e.g. a
  // JS-only test harness, or Expo Go without a custom dev client.
  apiSync(config: {
    apiKey: string;
    baseUrl: string;
    externalId?: string;
    identityHash?: string;
  }): Promise<void>;
  apiClearIdentity(): Promise<void>;
  apiIdentify(args: { deviceContext?: Record<string, unknown> }): Promise<void>;
  apiAddSubscription(args: {
    type: SubscriptionType;
    token: string;
    deviceModel?: string;
    deviceOs?: string;
    appVersion?: string;
  }): Promise<void>;
  apiUpdateTags(args: { tags: Record<string, unknown> }): Promise<void>;
  apiTrack(args: { name: string; properties?: Record<string, unknown> }): Promise<void>;
  apiReportReceipt(args: {
    messageId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): Promise<void>;
  apiFlushQueue(): Promise<void>;
}

const NativePush: EngageKaroNativePush | undefined =
  NativeModules.EngagekaroReactNative as EngageKaroNativePush | undefined;

const emitter = NativePush ? new NativeEventEmitter(NativeModules.EngagekaroReactNative) : null;

let config: EngageKaroConfig | null = null;
// HTTP fallback, used only where there's no native SDK to delegate to (see
// EngageKaroNativePush above).
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
  return !!config && (!config.requireConsent || consentGiven);
}

/**
 * Runs a native-bridge call when the native module is present, converting its
 * `engagekaro_api_error` rejection into an `EngageKaroApiError`; falls back to
 * the `fetch`-based `ApiClient` when there's no native module at all. Native's
 * `sendOrQueue` already swallows retryable failures (parks them in its own
 * offline queue), so a rejection here means a non-retryable one (e.g. a 4xx).
 */
async function callApi(nativeCall: () => Promise<void>, httpFallback: () => Promise<void>): Promise<void> {
  // NativePush is checked here (not by the caller) so `nativeCall` closures can
  // safely use `NativePush!` — by the time this actually invokes `nativeCall()`,
  // the module-level binding is known non-null.
  if (!NativePush) return httpFallback();
  try {
    await nativeCall();
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string; userInfo?: { statusCode?: number }; statusCode?: number };
    if (e?.code === "engagekaro_api_error") {
      const statusCode = e.userInfo?.statusCode ?? e.statusCode ?? 0;
      throw new EngageKaroApiError(statusCode, e.message ?? "");
    }
    throw err;
  }
}

async function pingDeviceContext(sessionStart = false): Promise<void> {
  if (!canSend() || !externalId) return;
  try {
    const countSession = sessionStart && noteForegroundResume();
    const ctx = await collectDeviceContext({
      sessionStart: countSession,
      pushPermission,
    });
    await callApi(
      () => NativePush!.apiIdentify({ deviceContext: ctx as Record<string, unknown> }),
      () => api!.identify(externalId!, ctx as Record<string, unknown>),
    );
  } catch {
    // Best-effort device profile sync.
  }
}

async function runPostLoginTasks(): Promise<void> {
  if (!canSend() || !externalId) return;
  const token = pendingToken ?? (await NativePush?.getToken()) ?? null;
  if (token) await registerToken(token);
  await pingDeviceContext(true);
}

async function registerToken(token: string): Promise<void> {
  if (!canSend()) return;
  if (!externalId) {
    pendingToken = token;
    return;
  }
  const type: SubscriptionType = Platform.OS === "ios" ? "IOS_PUSH" : "ANDROID_PUSH";
  await callApi(
    () => NativePush!.apiAddSubscription({ type, token }),
    () => api!.addSubscription(externalId!, type, token),
  );
  pendingToken = null;
}

function reportFromData(data: Record<string, unknown>, event: string): void {
  const messageId = data.ek_message_id;
  if (typeof messageId !== "string" || !messageId || !canSend()) return;
  void callApi(
    () => NativePush!.apiReportReceipt({ messageId, event, properties: data }),
    () => api!.reportReceipt(messageId, event, externalId ?? undefined, data),
  );
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
    // Mirror config/identity into the native bridge (see EngageKaroNativePush
    // above) so apiIdentify/apiTrack/etc. work without a separate "did you call
    // login() yet" state machine on the native side.
    void NativePush?.apiSync({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, externalId: externalId ?? undefined });
    wirePushListeners();
    // On foreground: session ping + drain anything queued while offline.
    subs.push(
      wireAppStateSession(() => {
        void pingDeviceContext(true);
        void NativePush?.apiFlushQueue();
        void api?.flushQueue();
      }),
    );
    void NativePush?.apiFlushQueue();
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
    if (config) {
      void NativePush?.apiSync({ apiKey: config.apiKey, baseUrl: config.baseUrl, externalId: id, identityHash });
    }
    if (!canSend()) return;
    void runPostLoginTasks();
  },

  async logout(): Promise<void> {
    externalId = null;
    if (api) api.identityHash = undefined;
    await NativePush?.apiClearIdentity();
  },

  async trackEvent(name: string, properties?: Record<string, unknown>): Promise<void> {
    if (!canSend()) return;
    await callApi(
      () => NativePush!.apiTrack({ name, properties }),
      () => api!.track(name, externalId ?? undefined, properties),
    );
  },

  async addTag(key: string, value: unknown): Promise<void> {
    return EngageKaro.addTags({ [key]: value });
  },

  async addTags(tags: Record<string, unknown>): Promise<void> {
    if (!canSend() || !externalId) throw new Error("Call login() first");
    await callApi(
      () => NativePush!.apiUpdateTags({ tags }),
      () => api!.updateTags(externalId!, tags),
    );
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

  /** Current push token (FCM on Android, APNs on iOS), or null if not yet available. */
  async getToken(): Promise<string | null> {
    if (!NativePush) return null;
    return NativePush.getToken();
  },

  /** Fires whenever the platform issues a new/rotated push token. Returns an unsubscribe function. */
  onTokenRefresh(handler: (token: string) => void): () => void {
    if (!emitter) return () => {};
    const sub = emitter.addListener("onToken", (token: unknown) => {
      if (typeof token === "string") handler(token);
    });
    return sub.remove;
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
