import type { Platform } from './index';
import { createFakePlatform } from './fake';
import { createTauriPlatform } from './tauri';

/** Tauri exposes `__TAURI_INTERNALS__` on the window. In a plain browser or in
 * tests the in-memory platform is used instead, so the UI stays runnable. */
export function createPlatform(): Platform {
  const hasTauri =
    typeof window !== 'undefined' &&
    typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === 'object';

  return hasTauri ? createTauriPlatform() : createFakePlatform();
}
