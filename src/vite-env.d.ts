/// <reference types="vite/client" />

// Launch Handler API（experimental・Chromium）。#98: WebAPK が既存アプリを start_url で
// 再利用起動しクエリを失うケースで、実際の起動 URL を受け取るために使う。
// https://developer.mozilla.org/en-US/docs/Web/API/LaunchParams
interface LaunchParams {
  readonly targetURL: string | null;
}
interface LaunchQueue {
  setConsumer(consumer: (launchParams: LaunchParams) => void): void;
}
interface Window {
  launchQueue?: LaunchQueue;
}
