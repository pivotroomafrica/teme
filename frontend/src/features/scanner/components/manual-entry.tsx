"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, FormField, Input, PhoneInput, Tabs } from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import type { Customer } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { toE164 } from "@/lib/validation/enrollment";

/**
 * When the camera cannot be used: type the card code, or look a member up by phone number.
 *
 * The phone lookup is read-only. The backend can stamp only a card that was scanned or typed in (it has no way to
 * stamp "the customer with this number"), so a lookup confirms who the member is and then asks for the card.
 * Branch staff see masked numbers and must give the complete number.
 */
export function ManualEntry({
  disabled,
  onCode,
}: {
  disabled: boolean;
  onCode: (text: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="manual-title" className="flex flex-col gap-3">
      <h2 id="manual-title" className="text-lg font-bold text-green-900">
        {t("scanner.manualTitle")}
      </h2>
      <Tabs
        label={t("scanner.manualTitle")}
        tabs={[
          {
            id: "code",
            label: t("scanner.tabCode"),
            content: <CodeForm disabled={disabled} onCode={onCode} />,
          },
          {
            id: "phone",
            label: t("scanner.tabPhone"),
            content: <PhoneLookup disabled={disabled} />,
          },
        ]}
      />
    </section>
  );
}

function CodeForm({ disabled, onCode }: { disabled: boolean; onCode: (text: string) => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) {
      setError(t("scanner.codeRequired"));
      return;
    }
    setError(null);
    onCode(value);
    setValue("");
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <FormField label={t("scanner.code")} hint={t("scanner.codeHelp")} error={error}>
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
        />
      </FormField>
      <Button type="submit" size="lg" disabled={disabled}>
        {t("scanner.lookUp")}
      </Button>
    </form>
  );
}

type Lookup =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; customers: Customer[] }
  | { phase: "failed"; message: string };

function PhoneLookup({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ phase: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const e164 = toE164(value);
    if (!/^\+251\d{9}$/.test(e164)) {
      setError(t("scanner.phoneNeedsFull"));
      return;
    }
    setError(null);
    setLookup({ phase: "loading" });
    try {
      const page = await getBrowserApi().customers.search({ q: e164 });
      setLookup({ phase: "done", customers: page.items });
    } catch (e) {
      setLookup({ phase: "failed", message: describeApiError(toApiError(e), t).description });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-charcoal-700">{t("scanner.phoneHelp")}</p>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <FormField label={t("enrollment.phone")} error={error}>
          <PhoneInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
          />
        </FormField>
        <Button
          type="submit"
          size="lg"
          disabled={disabled}
          loading={lookup.phase === "loading"}
          loadingLabel={t("scanner.lookingUp")}
        >
          {t("scanner.lookUp")}
        </Button>
      </form>

      {lookup.phase === "failed" ? <Alert tone="danger">{lookup.message}</Alert> : null}
      {lookup.phase === "done" && lookup.customers.length === 0 ? (
        <Alert tone="info">{t("scanner.lookupNone")}</Alert>
      ) : null}
      {lookup.phase === "done" && lookup.customers.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="lookup-results">
          {lookup.customers.map((customer) => {
            const active = customer.memberships.some((m) => m.status === "ACTIVE");
            return (
              <li key={customer.id} className="rounded-card border border-border bg-surface p-4">
                <p className="text-sm font-medium text-muted">{t("scanner.lookupFound")}</p>
                <p className="text-xl font-bold break-words text-green-900">
                  {customer.firstName ?? t("scanner.customerFallback")}
                </p>
                <p className="text-muted">{customer.phone}</p>
                <p className="mt-1 font-medium">
                  {active ? t("scanner.membershipActive") : t("scanner.membershipInactive")}
                </p>
                {active ? (
                  <p className="mt-2 text-charcoal-700">{t("scanner.lookupAskForCard")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
