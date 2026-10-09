import type { MetadataRoute } from "next";
import { publicEnv } from "@/lib/config/public-env";

/**
 * Only the home page is meant to be found. Signed-in areas, sign-in, customer cards and the API are disallowed here
 * and also send `X-Robots-Tag: noindex` (src/proxy.ts), which covers crawlers that ignore robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = ["en", "am"].flatMap((l) =>
    [
      "login",
      "denied",
      "session-expired",
      "card",
      "wallet",
      "staff",
      "dashboard",
      "operations",
      "dev",
    ].map((area) => `/${l}/${area}`),
  );
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...disallow, "/api/"] }],
    sitemap: undefined,
    host: publicEnv.NEXT_PUBLIC_APP_URL,
  };
}
