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
    let locale = Locale.current
    let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    resolve([
      "country": locale.regionCode ?? "",
      "language": locale.languageCode ?? "",
      "timezone": TimeZone.current.identifier,
      "os": "iOS",
      "osVersion": UIDevice.current.systemVersion,
      "appVersion": appVersion,
      "deviceModel": UIDevice.current.model,
    ])
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
          let defaults = UserDefaults(suiteName: appGroup) else {
      resolve(nil)
      return
    }
    defaults.set(config["apiBase"], forKey: "ek_api_base")
    defaults.set(config["apiKey"], forKey: "ek_api_key")
    defaults.set(config["externalId"], forKey: "ek_external_id")
    resolve(nil)
  }

  @objc func setDeviceToken(_ token: String) {
    currentToken = token
    if hasListeners { sendEvent(withName: "onToken", body: token) }
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
