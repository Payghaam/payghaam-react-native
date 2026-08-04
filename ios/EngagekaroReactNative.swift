import EngageKaro
import Foundation
import React
import UserNotifications

@objc(EngagekaroReactNative)
class EngagekaroReactNative: RCTEventEmitter, UNUserNotificationCenterDelegate {
  private var hasListeners = false
  private var currentToken: String?
  /// A tap that arrived before JS attached its listeners — i.e. one that launched
  /// the app from terminated. Drained by getInitialNotification().
  private var initialNotification: [AnyHashable: Any]?

  override static func requiresMainQueueSetup() -> Bool { true }
  override func supportedEvents() -> [String]! { ["onToken", "onOpened", "onForeground"] }

  override init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving() { hasListeners = false }

  @objc func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                               reject: @escaping RCTPromiseRejectBlock) {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, err in
      if let err { reject("E_PERMISSION", err.localizedDescription, err); return }
      DispatchQueue.main.async {
        UIApplication.shared.registerForRemoteNotifications()
        resolve(granted)
      }
    }
  }

  @objc func getToken(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    resolve(currentToken)
  }

  @objc func getDeviceContext(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    // Delegates to the canonical SDK (sdks/ios) instead of duplicating the
    // locale/UIDevice snapshot — see sdk-native-wrapper-design.md. JS always
    // overwrites `sdkVersion` with its own SDK_VERSION, so the value from
    // here is ignored regardless. `EngageKaro` is @MainActor; assumeIsolated
    // is safe because requiresMainQueueSetup() guarantees this already runs
    // on the main thread.
    let snapshot = MainActor.assumeIsolated { EngageKaro.deviceContextSnapshot() }
    resolve(snapshot)
  }

  @objc func getInitialNotification(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    let payload = initialNotification
    initialNotification = nil
    resolve(payload)
  }

  @objc func setSharedConfig(_ config: NSDictionary,
                             resolve: RCTPromiseResolveBlock,
                             reject: RCTPromiseRejectBlock) {
    guard let appGroup = config["appGroup"] as? String,
          let apiBase = config["apiBase"] as? String,
          let apiKey = config["apiKey"] as? String,
          let externalId = config["externalId"] as? String else {
      resolve(nil)
      return
    }
    // Delegates to the canonical SDK (sdks/ios) instead of writing the App
    // Group UserDefaults keys directly — its `ek_*` scheme already matches
    // what this module used to write by hand, so this is a drop-in swap. See
    // sdk-native-wrapper-design.md. `EngageKaro` is @MainActor; assumeIsolated
    // is safe because requiresMainQueueSetup() guarantees this already runs
    // on the main thread.
    MainActor.assumeIsolated {
      EngageKaro.shared.shareConfig(
        appGroup: appGroup, apiBase: apiBase, apiKey: apiKey, externalId: externalId
      )
    }
    resolve(nil)
  }

  @objc func setDeviceToken(_ token: String) {
    currentToken = token
    if hasListeners { sendEvent(withName: "onToken", body: token) }
  }

  // MARK: - Cross-platform API bridge (sdk-native-wrapper-design.md §4.5)
  //
  // Proxies a single call through the canonical ApiClient + offline queue,
  // replacing this module's old `fetch`-based ApiClient in the JS layer.

  @objc func apiSync(_ config: NSDictionary,
                     resolve: RCTPromiseResolveBlock,
                     reject: RCTPromiseRejectBlock) {
    if let apiKey = config["apiKey"] as? String, let baseUrl = config["baseUrl"] as? String {
      MainActor.assumeIsolated {
        EngageKaro.shared.persistBridgeConfig(
          apiKey: apiKey,
          baseUrl: baseUrl,
          externalId: config["externalId"] as? String,
          identityHash: config["identityHash"] as? String
        )
      }
    }
    resolve(nil)
  }

  @objc func apiClearIdentity(_ resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock) {
    MainActor.assumeIsolated { EngageKaro.shared.clearBridgeIdentity() }
    resolve(nil)
  }

  @objc func apiIdentify(_ args: NSDictionary?,
                         resolve: @escaping RCTPromiseResolveBlock,
                         reject: @escaping RCTPromiseRejectBlock) {
    let deviceContext = args?["deviceContext"] as? [String: Any]
    Task {
      do {
        try await EngageKaro.shared.bridgeIdentify(deviceContext: deviceContext)
        resolve(nil)
      } catch {
        Self.reject(reject, error)
      }
    }
  }

  @objc func apiAddSubscription(_ args: NSDictionary,
                                resolve: @escaping RCTPromiseResolveBlock,
                                reject: @escaping RCTPromiseRejectBlock) {
    guard let typeStr = args["type"] as? String,
          let type = SubscriptionType(rawValue: typeStr),
          let token = args["token"] as? String else {
      resolve(nil)
      return
    }
    Task {
      do {
        try await EngageKaro.shared.bridgeAddSubscription(type: type, token: token)
        resolve(nil)
      } catch {
        Self.reject(reject, error)
      }
    }
  }

  @objc func apiUpdateTags(_ args: NSDictionary,
                           resolve: @escaping RCTPromiseResolveBlock,
                           reject: @escaping RCTPromiseRejectBlock) {
    let raw = args["tags"] as? [String: Any] ?? [:]
    Task {
      do {
        try await EngageKaro.shared.addTags(Self.nilCoalesced(raw))
        resolve(nil)
      } catch {
        Self.reject(reject, error)
      }
    }
  }

  @objc func apiTrack(_ args: NSDictionary,
                      resolve: @escaping RCTPromiseResolveBlock,
                      reject: @escaping RCTPromiseRejectBlock) {
    guard let name = args["name"] as? String else {
      resolve(nil)
      return
    }
    let properties = args["properties"] as? [String: Any]
    Task {
      do {
        try await EngageKaro.shared.trackEvent(name, properties: properties)
        resolve(nil)
      } catch {
        Self.reject(reject, error)
      }
    }
  }

  @objc func apiReportReceipt(_ args: NSDictionary,
                              resolve: @escaping RCTPromiseResolveBlock,
                              reject: @escaping RCTPromiseRejectBlock) {
    guard let messageId = args["messageId"] as? String, let event = args["event"] as? String else {
      resolve(nil)
      return
    }
    let properties = args["properties"] as? [String: Any]
    Task {
      await EngageKaro.shared.reportPushReceipt(messageId: messageId, event: event, properties: properties)
      resolve(nil)
    }
  }

  @objc func apiFlushQueue(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    Task {
      await EngageKaro.shared.bridgeFlushQueue()
      resolve(nil)
    }
  }

  /// Converts an RN-bridged `[String: Any]` (where a JS `null` value arrives
  /// as `NSNull`, not Swift `nil`) into `[String: Any?]` so
  /// `EngageKaro.addTags` sees real `nil`s for tag removal.
  private static func nilCoalesced(_ dict: [String: Any]) -> [String: Any?] {
    var out: [String: Any?] = [:]
    for (k, v) in dict {
      if v is NSNull {
        out[k] = nil
      } else {
        out[k] = v
      }
    }
    return out
  }

  /// `sendOrQueue` inside the canonical SDK already swallows retryable failures
  /// (parks them in the offline queue), so this only ever rejects for a
  /// non-retryable one (e.g. a 4xx) — JS wraps that back into
  /// `EngageKaroApiError`. The `userInfo` map carries the status code so JS
  /// doesn't have to parse it out of the message.
  private static func reject(_ reject: RCTPromiseRejectBlock, _ error: Error) {
    if let apiError = error as? EngageKaroApiError {
      let nsError = NSError(
        domain: "EngageKaro",
        code: apiError.statusCode,
        userInfo: [
          NSLocalizedDescriptionKey: apiError.errorDescription ?? "",
          "statusCode": apiError.statusCode,
        ]
      )
      reject("engagekaro_api_error", apiError.errorDescription, nsError)
    } else {
      reject("engagekaro_api_error", "\(error)", error)
    }
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter,
                              willPresent notification: UNNotification,
                              withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    if hasListeners {
      sendEvent(withName: "onForeground", body: notification.request.content.userInfo)
    }
    completionHandler([.banner, .sound, .badge])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter,
                              didReceive response: UNNotificationResponse,
                              withCompletionHandler completionHandler: @escaping () -> Void) {
    let payload = response.notification.request.content.userInfo
    if hasListeners {
      sendEvent(withName: "onOpened", body: payload)
    } else {
      // The tap launched the app from terminated, so JS is not listening yet —
      // hold it for getInitialNotification() rather than dropping it.
      initialNotification = payload
    }
    completionHandler()
  }
}
