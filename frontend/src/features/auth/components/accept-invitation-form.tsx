"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Button, ButtonLink, FormField, Input } from "@/components/ui";
import { useHydrated } from "@/hooks/use-hydrated";
import { getBrowserApi } from "@/lib/api/browser";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import {
  createAcceptInvitationSchema,
  type AcceptInvitationValues,
} from "@/lib/validation/accept-invitation";

/**
 * A new team member's first step: the one-time code they were given and a password of their own choosing. Unknown,
 * expired, replaced and used codes all get the same answer from the backend, and the same message here, so nothing
 * can be learned about which codes exist. The code and password stay in this form only: they are never put in the
 * address, kept in storage or logged. After success the person signs in the normal way.
 */
export function AcceptInvitationForm() {
  const { t, locale } = useI18n();
  const schema = useMemo(() => createAcceptInvitationSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInvitationValues>({
    resolver: zodResolver(schema),
    defaultValues: { token: "", password: "", confirm: "" },
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const hydrated = useHydrated();

  const onSubmit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      await getBrowserApi().auth.acceptInvitation({
        token: values.token.trim(),
        password: values.password,
      });
      setDone(true);
    } catch (failure) {
      const error = toApiError(failure);
      setProblem(
        error.code === "INVALID_INVITATION"
          ? t("auth.acceptInvalid")
          : describeApiError(error, t).description,
      );
    }
  });

  if (done) {
    return (
      <div className="flex flex-col gap-4" data-testid="invitation-accepted">
        <Alert tone="success" title={t("auth.acceptDoneTitle")}>
          {t("auth.acceptDoneBody")}
        </Alert>
        <ButtonLink href={`/${locale}/login`} size="lg">
          {t("auth.acceptSignIn")}
        </ButtonLink>
      </div>
    );
  }

  return (
    <form
      // A native submission would put the code and password in the address bar, so it is a POST until the page is
      // interactive (the body is not in the address).
      method="post"
      data-hydrated={hydrated}
      onSubmit={onSubmit}
      noValidate
      aria-busy={isSubmitting || undefined}
      className="flex flex-col gap-5"
    >
      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <FormField
        label={t("auth.acceptCode")}
        hint={t("auth.acceptCodeHint")}
        error={errors.token?.message}
        required
      >
        <Input
          autoComplete="one-time-code"
          autoCapitalize="none"
          spellCheck={false}
          disabled={isSubmitting}
          {...register("token")}
        />
      </FormField>

      <FormField
        label={t("auth.acceptPassword")}
        hint={t("auth.acceptPasswordHint")}
        error={errors.password?.message}
        required
      >
        <div className="flex gap-2">
          <Input
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            disabled={isSubmitting}
            {...register("password")}
          />
          <Button
            variant="secondary"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            disabled={isSubmitting}
          >
            {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          </Button>
        </div>
      </FormField>

      <FormField label={t("auth.acceptConfirm")} error={errors.confirm?.message} required>
        <Input
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          disabled={isSubmitting}
          {...register("confirm")}
        />
      </FormField>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={isSubmitting}
        loadingLabel={t("auth.acceptSubmitting")}
      >
        {t("auth.acceptSubmit")}
      </Button>
      <Link className="text-center font-medium underline" href={`/${locale}/login`}>
        {t("auth.signIn")}
      </Link>
    </form>
  );
}
