import { createMockState, type MockState } from "./handlers";

const key = Symbol.for("temelashcard.mockState");

/**
 * One mock backend state per server process, shared by every request (and by hot reloads), so a mock sign-in
 * made in one request is still valid in the next. Stored on globalThis because route handlers, pages and the
 * proxy are separate bundles.
 */
export function sharedMockState(): MockState {
  const holder = globalThis as unknown as Record<symbol, MockState | undefined>;
  return (holder[key] ??= createMockState());
}
