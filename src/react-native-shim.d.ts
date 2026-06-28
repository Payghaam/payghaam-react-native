declare module "react-native" {
  export const NativeModules: Record<string, unknown>;
  export class NativeEventEmitter {
    constructor(module: unknown);
    addListener(event: string, handler: (...args: unknown[]) => void): { remove: () => void };
  }
  export const Platform: { OS: "ios" | "android" | "web" };
}
