import { AppState, NativeModules, Platform } from "react-native";

export const SDK_VERSION = "0.1.0";
const SESSION_GAP_MS = 30 * 60 * 1000;

let lastSessionAt = 0;
let sessionCountedThisLaunch = false;

export interface DeviceContextPayload {
  country?: string;
  language?: string;
  timezone?: string;
  os?: string;
  osVersion?: string;
  appVersion?: string;
  deviceModel?: string;
  sdkVersion?: string;
  pushPermission?: string;
  sessionStart?: boolean;
}

interface DeviceContextNative {
  getDeviceContext?: () => Promise<Record<string, string>>;
}

const NativeDevice: DeviceContextNative | undefined =
  NativeModules.EngagekaroReactNative as DeviceContextNative | undefined;

export function noteForegroundResume(): boolean {
  const now = Date.now();
  if (sessionCountedThisLaunch && now - lastSessionAt < SESSION_GAP_MS) return false;
  if (lastSessionAt > 0 && now - lastSessionAt < SESSION_GAP_MS) return false;
  lastSessionAt = now;
  sessionCountedThisLaunch = true;
  return true;
}

export async function collectDeviceContext(
  opts: { sessionStart?: boolean; pushPermission?: string } = {},
): Promise<DeviceContextPayload> {
  let native: Record<string, string> = {};
  try {
    native = (await NativeDevice?.getDeviceContext?.()) ?? {};
  } catch {
    native = {};
  }

  const locale = Intl.DateTimeFormat().resolvedOptions();
  const payload: DeviceContextPayload = {
    country: native.country || undefined,
    language: native.language || locale.locale?.split("-")[0],
    timezone: native.timezone || locale.timeZone,
    os: native.os || (Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : Platform.OS),
    osVersion: native.osVersion || String(Platform.Version),
    appVersion: native.appVersion,
    deviceModel: native.deviceModel,
    sdkVersion: SDK_VERSION,
    pushPermission: opts.pushPermission,
  };
  if (opts.sessionStart) payload.sessionStart = true;
  return payload;
}

export function wireAppStateSession(onSession: () => void): () => void {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active" && noteForegroundResume()) onSession();
  });
  return () => sub.remove();
}
