require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

# The Rust library and the generated uniffi bindings are produced at pod
# install by scripts/gen-iroh-xcframework.sh (injected into the Podfile by
# plugins/withIrohXcframework.js). Generated/ is a build output, not source:
# nothing in it is committed.
Pod::Spec.new do |s|
  s.name           = 'KalsaIroh'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.homepage       = 'https://github.com/Aspis0/kalsa'
  s.license        = { :type => 'MIT' }
  s.author         = { 'Kalsa' => 'dev@kalsa.app' }
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/expo/expo.git' }
  s.static_framework = true
  s.source_files   = 'KalsaIrohModule.swift', 'Generated/*.swift'
  s.vendored_frameworks = 'Generated/KalsaIroh.xcframework'
  s.preserve_paths = 'Generated/**/*'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  # The iroh dependency graph resolves interfaces through these on Apple.
  s.frameworks     = 'SystemConfiguration', 'CoreFoundation', 'Security'
  s.dependency     'ExpoModulesCore'
end
