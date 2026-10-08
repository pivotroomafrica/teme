"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, Button, FormField, Input } from "@/components/ui";
import { useHydrated } from "@/hooks/use-hydrated";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { createLoginSchema, type LoginValues } from "@/lib/validation/login";
import { sessionClient } from "../session-client";

/**
 * The sign-in form. Wrong credentials, a deactivated account and a temporary lockout all produce the same
 * message on purpose (the backend answers them identically, so nothing about an account can be learned).
 */
export function LoginForm({ next }: { next?: string }) {
  const { t, locale } = useI18n();
  const schema = useMemo(() => createLoginSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });
  const [problem, setProblem] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      const result = await sessionClient.signIn({ ...values, next, locale });
      setDone(true);
      // A full navigation: the next page is rendered on the server with the new session cookie, and no
      // password stays in this page's memory. The form stays disabled (busy) while we leave.
      window.location.assign(result.redirectTo);
    } catch (e) {
      const error = toApiError(e);
      setProblem(
        error.kind === "unauthenticated"
          ? t("auth.invalidCredentials")
          : describeApiError(error, t).description,
      );
    }
  });

  const hydrated = useHydrated();
  const busy = isSubmitting || done;

  return (
    <form
      // If the form is ever submitted natively (before this page is interactive), it must be a POST: a GET would
      // put the password in the address bar, browser history and server logs.
      method="post"
      action="/api/session/login"
      data-hydrated={hydrated}
      onSubmit={onSubmit}
      noValidate
      aria-busy={busy || undefined}
      className="flex flex-col gap-5"
    >
      {problem ? <Alert tone="danger">{problem}</Alert> : null}

      <FormField label={t("auth.email")} error={errors.email?.message} required>
        <Input
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
          {...register("email")}
        />
      </FormField>

      <FormField label={t("auth.password")} error={errors.password?.message} required>
        <div className="flex gap-2">
          <Input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            disabled={busy}
            {...register("password")}
          />
          <Button
            variant="secondary"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
            disabled={busy}
          >
            {showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
          </Button>
        </div>
      </FormField>

      <Button type="submit" size="lg" fullWidth loading={busy} loadingLabel={t("auth.signingIn")}>
        {t("auth.signIn")}
      </Button>
    </form>
  );
}
