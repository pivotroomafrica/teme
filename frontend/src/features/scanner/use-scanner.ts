"use client";

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { getBrowserApi } from "@/lib/api/browser";
import { newIdempotencyKey } from "@/lib/api/idempotency";
import { toApiError } from "@/lib/errors/api-error";
import {
  classifyFailure,
  initialScannerState,
  scannerReducer,
  type Pending,
  type ScannerAction,
} from "./scanner-flow";
import { parseScannedCode } from "./qr-input";

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

/** Whether the browser believes it is online. A hint only: the backend's answer is what counts. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Safe, non-identifying facts about this device: only that it is a web browser. */
const DEVICE = { platform: "web" as const };

/**
 * Runs the scan workflow against the backend.
 *
 *  - Every check asks the backend ("validate" and "rewards/lookup", both read-only); eligibility is never worked
 *    out here.
 *  - A stamp or redemption gets ONE idempotency key per action. If the answer is lost, "check again" re-sends
 *    that same key (a deliberate tap, never automatic), so the backend answers with the original result
 *    instead of acting twice.
 *  - A button press while a request is in flight does nothing.
 *  - Nothing is recorded or shown as done unless the backend confirmed it; there is no offline queue.
 */
export function useScanner({ branchId }: { branchId: string }) {
  const [state, dispatch] = useReducer(scannerReducer, initialScannerState);
  const online = useOnline();
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page abandons any request still being waited for.
  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback((action: ScannerAction) => dispatch(action), []);

  const fail = useCallback(
    (error: unknown, pending: Pending) => {
      const failure = classifyFailure(toApiError(error), navigator.onLine);
      send({
        type: "failed",
        pending,
        kind: failure.kind,
        // Reading is harmless to repeat; only a stamp or reward can be in an unknown state.
        uncertain: pending.action === "check" ? false : failure.uncertain,
        retryAfterSeconds: failure.retryAfterSeconds,
      });
    },
    [send],
  );

  const check = useCallback(
    async (token: string) => {
      if (busy.current) return;
      busy.current = true;
      controller.current = new AbortController();
      const { signal } = controller.current;
      const scanner = getBrowserApi().scanner;
      try {
        // Both are read-only questions to the backend; they run together to keep the counter moving.
        const [validation, rewards] = await Promise.all([
          scanner.validate({ cardToken: token, branchId }, signal),
          scanner.lookupRewards({ cardToken: token, branchId }, signal).catch((error) => {
            // A failed reward lookup must not hide a failed stamp check; unknown errors surface below.
            if (toApiError(error).kind === "aborted") throw error;
            return null;
          }),
        ]);
        send({ type: "checked", token, check: validation, rewards, now: Date.now() });
      } catch (error) {
        if (toApiError(error).kind === "aborted") return;
        fail(error, { action: "check", token });
      } finally {
        busy.current = false;
      }
    },
    [branchId, fail, send],
  );

  /** A code arrived from the camera or the keyboard. */
  const submitCode = useCallback(
    (text: string) => {
      const token = parseScannedCode(text);
      if (!token) {
        send({ type: "notACard" });
        return;
      }
      send({ type: "codeRead", token });
      void check(token);
    },
    [check, send],
  );

  const runStamp = useCallback(
    async (token: string, key: string, name: string) => {
      if (busy.current) return;
      busy.current = true;
      send({ type: "stampStarted", token, key, name });
      try {
        const result = await getBrowserApi().scanner.stamp(
          { cardToken: token, branchId, device: DEVICE },
          key,
        );
        send(
          result.outcome === "STAMPED"
            ? { type: "stamped", result, name, now: Date.now() }
            : { type: "rejected", result, name, now: Date.now() },
        );
      } catch (error) {
        fail(error, { action: "stamp", token, key, name });
      } finally {
        busy.current = false;
      }
    },
    [branchId, fail, send],
  );

  const runRedeem = useCallback(
    async (token: string, key: string, name: string, unlockId?: string) => {
      if (busy.current) return;
      busy.current = true;
      send({ type: "redeemStarted", token, key, name, unlockId });
      try {
        const result = await getBrowserApi().scanner.redeem(
          { cardToken: token, branchId, rewardUnlockId: unlockId, device: DEVICE },
          key,
        );
        send(
          result.outcome === "REDEEMED"
            ? { type: "redeemed", result, name, now: Date.now() }
            : { type: "rejected", result, name, now: Date.now() },
        );
      } catch (error) {
        fail(error, { action: "redeem", token, key, name, unlockId });
      } finally {
        busy.current = false;
      }
    },
    [branchId, fail, send],
  );

  /** Staff confirmed "Add stamp": one new key for this action. */
  const confirmStamp = useCallback(
    (token: string, name: string) => runStamp(token, newIdempotencyKey(), name),
    [runStamp],
  );

  /** Staff confirmed "Redeem reward": one new key for this action. */
  const confirmRedeem = useCallback(
    (token: string, name: string, unlockId?: string) =>
      runRedeem(token, newIdempotencyKey(), name, unlockId),
    [runRedeem],
  );

  /** "Check again" after a problem: repeats exactly what was being done, with the same key for writes. */
  const retry = useCallback(() => {
    if (state.phase.name !== "problem") return;
    const { pending } = state.phase;
    if (pending.action === "check") {
      send({ type: "dismiss" });
      send({ type: "codeRead", token: pending.token });
      void check(pending.token);
    } else if (pending.action === "stamp") {
      void runStamp(pending.token, pending.key, pending.name);
    } else {
      void runRedeem(pending.token, pending.key, pending.name, pending.unlockId);
    }
  }, [check, runRedeem, runStamp, send, state.phase]);

  /** Back to scanning. Abandons a check still in flight. */
  const dismiss = useCallback(() => {
    controller.current?.abort();
    busy.current = false;
    send({ type: "dismiss" });
  }, [send]);

  return { state, online, submitCode, confirmStamp, confirmRedeem, retry, dismiss };
}
