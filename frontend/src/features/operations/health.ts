import "server-only";
import { getServerApi } from "@/lib/api/server";
import type { HealthSnapshot } from "./components/ops-overview";

/**
 * Asks the service whether it is up and ready. Both endpoints are public and say nothing but yes or no. A failure of
 * either is an answer ("not ready"), never an error page.
 */
export async function loadHealth(): Promise<{ health: HealthSnapshot; checkedAt: string }> {
  const api = await getServerApi();
  const live = await api.operations.health().then(
    () => true,
    () => false,
  );
  const ready = live
    ? await api.operations.ready().then(
        () => true,
        () => false,
      )
    : false;
  return { health: { live, ready }, checkedAt: new Date().toISOString() };
}
