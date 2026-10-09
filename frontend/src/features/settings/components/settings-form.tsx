"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ErrorState,
  FormField,
  Input,
  Select,
  Skeleton,
  SkeletonGroup,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { getBrowserApi } from "@/lib/api/browser";
import type { MerchantProfile } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { normalizeEthiopianPhone } from "@/lib/i18n/phone";
import type { Translate } from "@/lib/i18n/translator";
import { TIMEZONES, patchFrom, valuesFrom, type SettingsValues } from "../settings-rules";

type Errors = Partial<Record<keyof SettingsValues, string>>;

export function validate(values: SettingsValues, t: Translate): Errors {
  const errors: Errors = {};
  if (!values.nameEn.trim()) errors.nameEn = t("settings.nameRequired");
  else if (values.nameEn.length > 120) errors.nameEn = t("settings.nameTooLong");
  if (values.nameAm.length > 120) errors.nameAm = t("settings.nameTooLong");
  const email = values.supportEmail.trim();
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    errors.supportEmail = t("settings.emailInvalid");
  }
  const phone = values.supportPhone.trim();
  if (phone && !normalizeEthiopianPhone(phone)) errors.supportPhone = t("settings.phoneInvalid");
  const stamps = Number(values.defaultStampsRequired);
  if (!/^\d+$/.test(values.defaultStampsRequired.trim()) || stamps < 1 || stamps > 1000) {
    errors.defaultStampsRequired = t("settings.stampsRange");
  }
  const cooldown = Number(values.defaultCooldownMinutes);
  if (!/^\d+$/.test(values.defaultCooldownMinutes.trim()) || cooldown > 10_080) {
    errors.defaultCooldownMinutes = t("settings.cooldownRange");
  }
  return errors;
}

const STATUS_TONE: Record<NonNullable<MerchantProfile["status"]>, Tone> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  DEACTIVATED: "neutral",
};

/**
 * The business's own settings. The form sends only the fields that changed (an emptied optional field clears it), the
 * backend validates and answers with the saved profile, and its refusals are shown in words. People without the
 * permission see the values but cannot change them; the backend refuses them anyway. The join reference and the
 * status are read-only: only TemelashCard changes a status, and a logo cannot be uploaded because the service has no
 * file storage yet.
 */
export function SettingsForm({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: ["profile"],
    queryFn: ({ signal }) => getBrowserApi().merchant.getProfile(signal),
  });

  if (query.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-full max-w-md" />
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    const failure = toApiError(query.error);
    return (
      <ErrorState
        title={t("settings.loadError")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const profile = query.data;
  return (
    // Keyed by the saved profile, so after a save the form starts again from what the backend returned.
    <Form
      key={JSON.stringify(profile)}
      profile={profile}
      canEdit={canEdit}
      onSaved={(saved) => {
        client.setQueryData(["profile"], saved);
        toast.show({ tone: "success", title: t("settings.saved") });
      }}
    />
  );
}

function Form({
  profile,
  canEdit,
  onSaved,
}: {
  profile: MerchantProfile;
  canEdit: boolean;
  onSaved: (profile: MerchantProfile) => void;
}) {
  const { t } = useI18n();
  const initial = valuesFrom(profile);
  const [values, setValues] = useState<SettingsValues>(initial);
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const patch = patchFrom(initial, values);
  const changed = Object.keys(patch).length > 0;
  const timezones: readonly string[] = (TIMEZONES as readonly string[]).includes(initial.timezone)
    ? TIMEZONES
    : [initial.timezone, ...TIMEZONES];

  const save = useMutation({
    mutationFn: () => getBrowserApi().merchant.updateProfile(patch),
  });
  const set = (key: keyof SettingsValues) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    const found = validate(values, t);
    setErrors(found);
    if (Object.keys(found).length > 0 || !changed) return;
    try {
      onSaved(await save.mutateAsync());
    } catch (failure) {
      const error = toApiError(failure);
      setProblem(
        error.kind === "forbidden"
          ? t("settings.errForbidden")
          : error.kind === "validation"
            ? t("settings.errInvalid")
            : describeApiError(error, t).description,
      );
    }
  }

  const disabled = !canEdit || save.isPending;
  return (
    <form
      onSubmit={submit}
      noValidate
      aria-busy={save.isPending || undefined}
      className="flex max-w-2xl flex-col gap-8"
    >
      {!canEdit ? <Alert tone="info">{t("settings.readOnly")}</Alert> : null}
      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-1 text-lg font-bold text-green-900">
          {t("settings.businessTitle")}
        </legend>
        <FormField label={t("settings.nameEn")} error={errors.nameEn} required>
          <Input value={values.nameEn} onChange={(e) => set("nameEn")(e.target.value)} />
        </FormField>
        <FormField label={t("settings.nameAm")} error={errors.nameAm} optional>
          <Input lang="am" value={values.nameAm} onChange={(e) => set("nameAm")(e.target.value)} />
        </FormField>
        <FormField label={t("settings.defaultLanguage")}>
          <Select
            value={values.defaultLanguage}
            onChange={(e) => set("defaultLanguage")(e.target.value)}
          >
            <option value="EN">{t("settings.langEn")}</option>
            <option value="AM">{t("settings.langAm")}</option>
          </Select>
        </FormField>
        <FormField label={t("settings.timezone")} hint={t("settings.timezoneHint")}>
          <Select value={values.timezone} onChange={(e) => set("timezone")(e.target.value)}>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </FormField>
        {values.timezone !== initial.timezone ? (
          <Alert tone="warning">{t("settings.timezoneNote")}</Alert>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-1 text-lg font-bold text-green-900">
          {t("settings.contactTitle")}
        </legend>
        <p className="text-sm text-muted">{t("settings.contactHint")}</p>
        <FormField label={t("settings.supportEmail")} error={errors.supportEmail} optional>
          <Input
            type="email"
            autoComplete="off"
            inputMode="email"
            value={values.supportEmail}
            onChange={(e) => set("supportEmail")(e.target.value)}
          />
        </FormField>
        <FormField label={t("settings.supportPhone")} error={errors.supportPhone} optional>
          <Input
            type="tel"
            autoComplete="off"
            inputMode="tel"
            dir="ltr"
            value={values.supportPhone}
            onChange={(e) => set("supportPhone")(e.target.value)}
          />
        </FormField>
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={disabled}>
        <legend className="mb-1 text-lg font-bold text-green-900">
          {t("settings.defaultsTitle")}
        </legend>
        <p className="text-sm text-muted">{t("settings.defaultsHint")}</p>
        <FormField label={t("settings.defaultStamps")} error={errors.defaultStampsRequired}>
          <Input
            inputMode="numeric"
            value={values.defaultStampsRequired}
            onChange={(e) => set("defaultStampsRequired")(e.target.value)}
          />
        </FormField>
        <FormField
          label={t("settings.defaultCooldown")}
          hint={t("settings.cooldownHint")}
          error={errors.defaultCooldownMinutes}
        >
          <Input
            inputMode="numeric"
            value={values.defaultCooldownMinutes}
            onChange={(e) => set("defaultCooldownMinutes")(e.target.value)}
          />
        </FormField>
      </fieldset>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            loading={save.isPending}
            loadingLabel={t("settings.saving")}
            disabled={!changed}
          >
            {t("settings.save")}
          </Button>
          <Button
            variant="secondary"
            disabled={!changed || save.isPending}
            onClick={() => {
              setValues(initial);
              setErrors({});
              setProblem(null);
            }}
          >
            {t("settings.undo")}
          </Button>
          {!changed ? (
            <span className="text-sm text-muted">{t("settings.nothingToSave")}</span>
          ) : null}
        </div>
      ) : null}

      <section aria-labelledby="join-h" className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 id="join-h" className="text-lg font-bold text-green-900">
          {t("settings.joinTitle")}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">{t("settings.joinReference")}</dt>
          <dd dir="ltr" className="text-start font-mono">
            {profile.joinReference ?? "—"}
          </dd>
          <dt className="text-muted">{t("settings.slug")}</dt>
          <dd dir="ltr" className="text-start">
            {profile.slug ?? "—"}
          </dd>
          <dt className="text-muted">{t("settings.status")}</dt>
          <dd>
            {profile.status ? (
              <Badge tone={STATUS_TONE[profile.status]}>
                {t(
                  profile.status === "ACTIVE"
                    ? "settings.statusActive"
                    : profile.status === "SUSPENDED"
                      ? "settings.statusSuspended"
                      : "settings.statusDeactivated",
                )}
              </Badge>
            ) : (
              "—"
            )}
          </dd>
        </dl>
        <p className="text-sm text-muted">{t("settings.joinHint")}</p>
        <p className="text-sm text-muted">{t("settings.statusNote")}</p>
      </section>

      <section aria-labelledby="logo-h" className="flex flex-col gap-2">
        <h2 id="logo-h" className="text-lg font-bold text-green-900">
          {t("settings.logoTitle")}
        </h2>
        <p className="text-sm text-muted">{t("settings.logoNote")}</p>
      </section>
    </form>
  );
}
