import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design system",
  robots: { index: false, follow: false },
};

/**
 * Component gallery. Development only: in a production build this route does not exist (404), and the
 * preview code is never reachable. It is the page the component accessibility and layout tests run against.
 */
export default async function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { DesignSystemPreview } = await import("@/components/dev/design-system-preview");
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-8">
      <DesignSystemPreview />
    </main>
  );
}
