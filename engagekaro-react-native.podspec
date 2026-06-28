require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "engagekaro-react-native"
  s.version      = package["version"]
  s.summary      = "EngageKaro SDK for React Native"
  s.homepage     = "https://github.com/engagekaro/engagekaro"
  s.license      = "MIT"
  s.author       = { "EngageKaro" => "dev@engagekaro.com" }
  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => "https://github.com/engagekaro/engagekaro.git", :tag => "#{s.version}" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.dependency "React-Core"
end
