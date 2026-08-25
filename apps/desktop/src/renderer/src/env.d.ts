import type { RxApi } from '@rx/contract';

declare global {
  interface Window {
    rx: RxApi;
  }
}

export {};
