import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  NativeModules: {
    PayghaamReactNative: {
      requestPermission: vi.fn().mockResolvedValue(true),
      getToken: vi.fn().mockResolvedValue("tok_test"),
      getInitialNotification: vi.fn().mockResolvedValue(null),
      setSharedConfig: vi.fn().mockResolvedValue(null),
      apiSync: vi.fn().mockResolvedValue(null),
      apiClearIdentity: vi.fn().mockResolvedValue(null),
      apiIdentify: vi.fn().mockResolvedValue(null),
      apiAddSubscription: vi.fn().mockResolvedValue(null),
      apiRemoveSubscription: vi.fn().mockResolvedValue(null),
      apiUpdateTags: vi.fn().mockResolvedValue(null),
      apiSetLanguage: vi.fn().mockResolvedValue(null),
      apiAddAliases: vi.fn().mockResolvedValue(null),
      apiTrack: vi.fn().mockResolvedValue(null),
      apiReportReceipt: vi.fn().mockResolvedValue(null),
      apiFlushQueue: vi.fn().mockResolvedValue(null),
    },
  },
  NativeEventEmitter: vi.fn().mockImplementation(() => ({
    addListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  })),
  Platform: { OS: "ios" },
  Linking: { openURL: vi.fn() },
  AppState: {
    currentState: "active",
    addEventListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
  },
}));

import { Payghaam } from "./index";

describe("Payghaam Anonymous Tracking & Profile Attributes", () => {
  it("initializes with an anonymousId", () => {
    Payghaam.initialize({
      appId: "app_test",
      apiKey: "pk_test_123",
      baseUrl: "http://localhost:3000",
    });

    const anonId = Payghaam.getAnonymousId();
    expect(anonId).toBeDefined();
    expect(anonId.length).toBeGreaterThan(10);
  });

  it("rotates anonymousId on logout", async () => {
    const anonId1 = Payghaam.getAnonymousId();
    Payghaam.login("user_123");
    await Payghaam.logout();
    const anonId2 = Payghaam.getAnonymousId();
    expect(anonId2).not.toBe(anonId1);
  });

  it("allows setting tags, aliases, and language for anonymous user", async () => {
    await Payghaam.setLanguage("ar");
    await Payghaam.addTag("tier", "silver");
    await Payghaam.addAlias("loyalty_id", "loyalty_123");
    await Payghaam.addEmail("user@example.com");
    await Payghaam.removeEmail("user@example.com");
    await Payghaam.addSms("+1234567890");
    await Payghaam.removeSms("+1234567890");
    await Payghaam.trackEvent("browse_product", { sku: "abc" });
  });
});
