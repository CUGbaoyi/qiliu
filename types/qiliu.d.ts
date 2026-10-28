export {};

declare global {
  interface Window {
    QiliuAndroid?: { postMessage(value: string): void };
    webkit?: { messageHandlers?: { qiliu?: { postMessage(value: string): void } } };
    __qiliuReply?: (id: string, result: { error?: string; value?: unknown }) => void;
  }
}
