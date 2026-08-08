# Payghaam React Native example

A minimal app showing SDK initialization, login, and event tracking.

This example intentionally ships without the `android/` and `ios/` native
project scaffolding — generate them with:

```
npx react-native init PayghaamExample --version 0.76.0
```

then copy `App.tsx` in, add `@payghaam/react-native` as a dependency, and
follow the native setup steps in the root README (Firebase for Android, APNs
+ an App Group for iOS) before running.
