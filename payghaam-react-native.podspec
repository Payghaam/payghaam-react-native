require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "payghaam-react-native"
  s.version      = package["version"]
  s.summary      = "Payghaam SDK for React Native"
  s.homepage     = "https://github.com/payghaam/payghaam-react-native"
  s.license      = "MIT"
  s.author       = { "Payghaam" => "dev@payghaam.com" }
  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/payghaam/payghaam-react-native.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.dependency "React-Core"
  # Canonical native SDK, published to the CocoaPods trunk as the `Payghaam`
  # pod. Resolved from the public CocoaPods spec repo, same as any other
  # third-party pod.
  s.dependency "Payghaam"
end
