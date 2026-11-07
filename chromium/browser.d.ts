interface Window {
  __nonstopPdfUrl: string;
  __nonstopExtUrl: string;
  __nonstopPdfData: Uint8Array;
  __nonstopSettings: { keyboardZoomStep: number };
}

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    sendMessage(id: string, message: { handler: string }): Promise<unknown>;
  };
  mimeHandler: {
    getStreamInfo(): Promise<{ originalUrl: string; streamUrl: string }>;
    abortAndFallbackToNativeHandler(): Promise<void>;
  };
};
