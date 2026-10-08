"use client";

import { useEffect } from "react";
import { UNAUTHORIZED_EVENT } from "@/lib/api/browser";
import { useI18n } from "@/lib/i18n/client";

/**
 * Reacts once when any browser request is answered with 401 (session ended elsewhere, deactivated, expired
 * while the page stayed open): a full navigation to the endpoint that clears the cookie and explains why.
 */
export function SessionWatcher() {
  const { locale } = useI18n();
  useEffect(() => {
    let handled = false;
    const onUnauthorized = () => {
      if (handled) return;
      handled = true;
      // Full page load on purpose: it must reach the route handler that clears the cookie.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/api/session/end?reason=expired&locale=${locale}`);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [locale]);
  return null;
}
