import { notFound } from "next/navigation";

/** Any unknown path below a language prefix renders the localized 404 page (with a real 404 status). */
export default function CatchAll() {
  notFound();
}
