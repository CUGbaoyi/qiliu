export {};

declare global {
  interface Window {
    QiliuAndroid?: { postMessage(value: string): void };
    webkit?: { messageHandlers?: { qiliu?: { postMessage(value: string): void } } };
    __qiliuReply?: (id: string, result: { error?: string; value?: unknown }) => void;
    __TAURI__?: {
      core?: {
        invoke?: (
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<{ error?: string; value?: unknown } | undefined>;
      };
    };
  }
}
