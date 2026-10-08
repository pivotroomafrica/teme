import { createApi } from "@/lib/api";
import { accessTokenFor, type MockEmail } from "./fixtures";
import { createMockState } from "./handlers";
import { createMockTransport } from "./mock-transport";

/**
 * The real feature clients talking to the mock backend as one of the mock accounts, with its own fresh state.
 * Component tests use it so a screen is exercised together with the request building, the parsing and the
 * backend's rules, instead of against hand-written fakes that could drift from them.
 */
export function createMockApiFor(email: MockEmail) {
  const state = createMockState();
  const api = createApi(
    createMockTransport({ state, getAccessToken: () => accessTokenFor(email) }),
  );
  // The state is returned too, so a test can arrange a situation (for example a second owner) before it starts.
  return { api, state };
}
