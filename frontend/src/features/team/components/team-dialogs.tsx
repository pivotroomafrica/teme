"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import {
  Alert,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  FormField,
  Input,
  RadioGroup,
  Select,
  Skeleton,
} from "@/components/ui";
import { ACTION_LABEL } from "@/features/org/action-labels";
import { explainOrgError } from "@/features/org/errors";
import { pickLocalized } from "@/features/enrollment/localized";
import { getBrowserApi } from "@/lib/api/browser";
import type { Branch, InvitedStaff, MerchantRole, Staff } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { createFormatter } from "@/lib/i18n/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import {
  createInviteSchema,
  isDemotion,
  isLastActiveOwner,
  type Actor,
  type InviteFormValues,
} from "../team-rules";

export const ROLE_LABEL: Record<MerchantRole, MessageKey> = {
  OWNER: "auth.roleOwner",
  MANAGER: "auth.roleManager",
  STAFF: "auth.roleStaff",
};

/** Branches a person can be given: only active ones are offered. */
const activeBranches = (branches: readonly Branch[]) =>
  branches.filter((b) => b.status === "ACTIVE");

// ───────────────────────── invite ─────────────────────────

export function InviteDialog({
  open,
  roles,
  branches,
  onClose,
  onInvited,
}: {
  open: boolean;
  roles: MerchantRole[];
  branches: readonly Branch[];
  onClose: () => void;
  onInvited: (result: InvitedStaff) => void;
}) {
  const { t, locale } = useI18n();
  const schema = useMemo(() => createInviteSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      displayName: "",
      role: roles.includes("STAFF") ? "STAFF" : (roles[0] ?? "STAFF"),
      branchIds: [],
      preferredLanguage: locale === "am" ? "AM" : "EN",
    },
  });
  const [problem, setProblem] = useState<string | null>(null);
  const role = useWatch({ control, name: "role" });

  const submit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      const result = await getBrowserApi().team.invite({
        email: values.email.trim(),
        displayName: values.displayName.trim(),
        role: values.role,
        branchIds: values.branchIds,
        preferredLanguage: values.preferredLanguage,
      });
      onInvited(result);
    } catch (error) {
      const e = toApiError(error);
      if (e.code === "INVITE_NOT_POSSIBLE")
        setError("email", { message: t("team.errInviteNotPossible") });
      setProblem(
        explainOrgError(error, t, {
          forbidden: "team.errForbiddenRole",
          invalid: "team.errInvalidBranches",
        }),
      );
    }
  });

  const options = activeBranches(branches);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isSubmitting}
      title={t("team.inviteTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t("ui.cancel")}
          </Button>
          <Button
            type="submit"
            form="invite-form"
            loading={isSubmitting}
            loadingLabel={t("team.creating")}
          >
            {t("team.create")}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <FormField label={t("team.email")} error={errors.email?.message} required>
          <Input
            type="email"
            autoComplete="off"
            inputMode="email"
            spellCheck={false}
            {...register("email")}
          />
        </FormField>
        <FormField label={t("team.displayName")} error={errors.displayName?.message} required>
          <Input autoComplete="off" {...register("displayName")} />
        </FormField>
        <FormField
          label={t("team.role")}
          hint={roles.length === 1 ? t("team.roleHintManager") : undefined}
          required
        >
          <Select {...register("role")}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL[r])}
              </option>
            ))}
          </Select>
        </FormField>

        <fieldset className="flex flex-col gap-1" aria-describedby="invite-branches-hint">
          <legend className="font-medium">
            {t("team.branchesLabel")}
            {role === "STAFF" ? <span className="sr-only"> ({t("ui.required")})</span> : null}
          </legend>
          <p id="invite-branches-hint" className="text-sm text-muted">
            {role === "STAFF" ? t("team.branchesNeedOne") : t("team.branchesOptional")}
          </p>
          {options.length === 0 ? (
            <p className="text-sm text-muted">{t("team.noActiveBranches")}</p>
          ) : null}
          <Controller
            control={control}
            name="branchIds"
            render={({ field }) => (
              <>
                {options.map((b) => {
                  const label = pickLocalized(locale, b.nameEn, b.nameAm);
                  return (
                    <Checkbox
                      key={b.id}
                      label={<span lang={label.lang}>{label.text}</span>}
                      checked={field.value.includes(b.id)}
                      onChange={(event) =>
                        field.onChange(
                          event.target.checked
                            ? [...field.value, b.id]
                            : field.value.filter((id) => id !== b.id),
                        )
                      }
                    />
                  );
                })}
              </>
            )}
          />
          {errors.branchIds?.message ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {errors.branchIds.message}
            </p>
          ) : null}
        </fieldset>

        <Controller
          control={control}
          name="preferredLanguage"
          render={({ field }) => (
            <RadioGroup
              name="invite-language"
              legend={t("team.language")}
              value={field.value}
              onValueChange={field.onChange}
              options={[
                { value: "EN", label: t("program.qrEnglish") },
                { value: "AM", label: t("program.qrAmharic") },
              ]}
            />
          )}
        />
      </form>
    </Dialog>
  );
}

// ───────────────────────── one-time invitation code ─────────────────────────

/**
 * The invitation code is shown here once and never stored by the browser. No email is sent (the backend has no
 * delivery yet), so the person who invites hands the code over themselves.
 */
export function TokenDialog({
  token,
  name,
  onClose,
}: {
  token: { value: string; expiresAt: string } | null;
  name: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const format = useMemo(() => createFormatter(locale), [locale]);

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.value);
      setCopied(true);
    } catch {
      // Clipboard blocked: the code is selectable in the box, so it can still be copied by hand.
    }
  }

  return (
    <Dialog
      open={token !== null}
      onClose={() => {
        setCopied(false);
        onClose();
      }}
      dismissible={false}
      title={t("team.tokenTitle", { name })}
      footer={
        <Button
          onClick={() => {
            setCopied(false);
            onClose();
          }}
        >
          {t("team.tokenDone")}
        </Button>
      }
    >
      {token ? (
        <div className="flex flex-col gap-4" data-testid="invitation-token">
          <p>{t("team.tokenBody", { name, expires: format.dateTime(token.expiresAt) })}</p>
          <FormField label={t("team.tokenLabel")}>
            <Input
              readOnly
              value={token.value}
              className="font-mono"
              onFocus={(event) => event.currentTarget.select()}
              autoComplete="off"
            />
          </FormField>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => void copy()}>
              {t("team.tokenCopy")}
            </Button>
            {copied ? (
              <span role="status" className="text-sm font-medium text-green-700">
                {t("team.tokenCopied")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

// ───────────────────────── role ─────────────────────────

export function RoleDialog({
  target,
  actor,
  team,
  roles,
  onClose,
  onChanged,
}: {
  target: Staff | null;
  actor: Actor;
  team: readonly Staff[];
  roles: MerchantRole[];
  onClose: () => void;
  onChanged: (staff: Staff) => void;
}) {
  const { t } = useI18n();
  // The parent mounts a fresh dialog for each person (key), so this starts from their current role.
  const [role, setRole] = useState<MerchantRole>(target?.roleKey ?? "STAFF");
  const [problem, setProblem] = useState<string | null>(null);

  const lastOwner = target ? isLastActiveOwner(team, target) : false;
  const demotesOwner = target?.roleKey === "OWNER" && role !== "OWNER";
  void actor;

  return (
    <ConfirmDialog
      open={target !== null}
      tone={demotesOwner ? "danger" : "primary"}
      requirePhrase={demotesOwner ? t("team.confirmPhrase") : undefined}
      title={target ? t("team.roleTitle", { name: target.displayName }) : ""}
      confirmLabel={t("team.roleSave")}
      cancelLabel={t("ui.cancel")}
      onCancel={onClose}
      onConfirm={async () => {
        if (!target) return;
        if (role === target.roleKey) {
          onClose();
          return;
        }
        try {
          onChanged(await getBrowserApi().team.changeRole(target.id, role));
        } catch (error) {
          setProblem(
            explainOrgError(error, t, {
              forbidden: actor.role === "MANAGER" ? "team.errForbiddenRole" : "team.errSelf",
              conflict: "team.errDeactivated",
            }),
          );
        }
      }}
    >
      {target ? (
        <div className="flex flex-col gap-3">
          <p>{t("team.roleCurrent", { role: t(ROLE_LABEL[target.roleKey]) })}</p>
          <FormField label={t("team.role")}>
            <Select value={role} onChange={(event) => setRole(event.target.value as MerchantRole)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(ROLE_LABEL[r])}
                </option>
              ))}
            </Select>
          </FormField>
          <p className="text-sm text-muted">{t("team.roleWarn")}</p>
          {role === "OWNER" && target.roleKey !== "OWNER" ? (
            <Alert tone="warning">{t("team.roleOwnerNote")}</Alert>
          ) : null}
          {demotesOwner && isDemotion(target.roleKey, role) ? (
            <Alert tone="warning">{t("team.roleDemoteOwner")}</Alert>
          ) : null}
          {lastOwner && role !== "OWNER" ? (
            <Alert tone="danger">{t("team.lastOwnerWarn")}</Alert>
          ) : null}
          {problem ? <Alert tone="danger">{problem}</Alert> : null}
        </div>
      ) : null}
    </ConfirmDialog>
  );
}

// ───────────────────────── branches of a member ─────────────────────────

export function MemberBranchesDialog({
  target,
  actor,
  branches,
  onClose,
  onChanged,
}: {
  target: Staff | null;
  actor: Actor;
  branches: readonly Branch[];
  onClose: () => void;
  onChanged: (staff: Staff) => void;
}) {
  const { t, locale } = useI18n();
  const [chosen, setChosen] = useState<string[]>(target?.branchIds ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needOne = target?.roleKey === "STAFF" && chosen.length === 0;
  // A branch they already work at stays visible and can be unticked even if it has since been deactivated;
  // only active branches can be added.
  const listed = branches.filter((b) => b.status === "ACTIVE" || target?.branchIds.includes(b.id));

  async function save() {
    if (!target || needOne) return;
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await getBrowserApi().team.setBranches(target.id, chosen));
    } catch (error) {
      setProblem(
        explainOrgError(error, t, {
          forbidden: actor.role === "MANAGER" ? "team.errForbiddenRole" : "team.errSelf",
          conflict: "team.errDeactivated",
          invalid: "team.errInvalidBranches",
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      dismissible={!busy}
      title={target ? t("team.branchesTitle", { name: target.displayName }) : ""}
      description={t("team.branchesBody")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t("ui.cancel")}
          </Button>
          <Button
            onClick={() => void save()}
            loading={busy}
            loadingLabel={t("team.saving")}
            disabled={needOne}
          >
            {t("team.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        {needOne ? <Alert tone="warning">{t("team.branchesNeedOne")}</Alert> : null}
        {listed.map((b) => {
          const label = pickLocalized(locale, b.nameEn, b.nameAm);
          return (
            <Checkbox
              key={b.id}
              label={
                <span lang={label.lang}>
                  {label.text}
                  {b.status !== "ACTIVE" ? ` (${t("team.branchesInactive")})` : ""}
                </span>
              }
              checked={chosen.includes(b.id)}
              onChange={(event) =>
                setChosen((current) =>
                  event.target.checked ? [...current, b.id] : current.filter((id) => id !== b.id),
                )
              }
            />
          );
        })}
      </div>
    </Dialog>
  );
}

// ───────────────────────── activate / deactivate / new invitation ─────────────────────────

export type StatusAction = "deactivate" | "activate" | "reissue";

export function StatusDialog({
  target,
  action,
  actor,
  team,
  onClose,
  onDone,
}: {
  target: Staff | null;
  action: StatusAction | null;
  actor: Actor;
  team: readonly Staff[];
  onClose: () => void;
  onDone: (result: { staff?: Staff; invitation?: { token: string; expiresAt: string } }) => void;
}) {
  const { t } = useI18n();
  const [problem, setProblem] = useState<string | null>(null);

  if (!target || !action) {
    return <ConfirmDialog open={false} title="" onCancel={onClose} onConfirm={() => undefined} />;
  }
  const owner = target.roleKey === "OWNER" && action === "deactivate";
  const lastOwner = isLastActiveOwner(team, target) && action === "deactivate";
  const name = target.displayName;
  const title =
    action === "deactivate"
      ? t("team.deactivateTitle", { name })
      : action === "activate"
        ? t("team.activateTitle", { name })
        : t("team.reissueTitle", { name });
  const body =
    action === "deactivate"
      ? t("team.deactivateBody")
      : action === "activate"
        ? t("team.activateBody")
        : t("team.reissueBody");

  return (
    <ConfirmDialog
      open
      tone={action === "deactivate" ? "danger" : "primary"}
      requirePhrase={owner ? t("team.confirmPhrase") : undefined}
      title={title}
      description={body}
      confirmLabel={
        action === "deactivate"
          ? t("team.deactivate")
          : action === "activate"
            ? t("team.activate")
            : t("team.reissue")
      }
      cancelLabel={t("ui.cancel")}
      onCancel={onClose}
      onConfirm={async () => {
        const api = getBrowserApi().team;
        try {
          if (action === "reissue") onDone({ invitation: await api.reissueInvitation(target.id) });
          else
            onDone({
              staff:
                action === "deactivate"
                  ? await api.deactivate(target.id)
                  : await api.activate(target.id),
            });
        } catch (error) {
          setProblem(
            explainOrgError(error, t, {
              forbidden: actor.role === "MANAGER" ? "team.errForbiddenRole" : "team.errSelf",
              conflict:
                action === "reissue"
                  ? "team.errNotPending"
                  : target.status === "INVITED"
                    ? "team.errPendingActivate"
                    : "team.errDeactivated",
            }),
          );
        }
      }}
    >
      <div className="flex flex-col gap-3">
        {lastOwner ? <Alert tone="danger">{t("team.lastOwnerWarn")}</Alert> : null}
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
      </div>
    </ConfirmDialog>
  );
}

// ───────────────────────── activity ─────────────────────────

/**
 * What a person did, taken from the backend's audited record: counts and a newest-first list that loads more on
 * request. Passwords, IP addresses and device details are never part of it.
 */
export function ActivityDialog({ target, onClose }: { target: Staff | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const format = useMemo(() => createFormatter(locale), [locale]);
  const query = useInfiniteQuery({
    queryKey: ["team", "activity", target?.id],
    enabled: target !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      getBrowserApi().team.activity(target!.id, { limit: 10, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.events.nextCursor ?? undefined,
  });
  const first = query.data?.pages[0];
  const events = query.data?.pages.flatMap((p) => p.events.items) ?? [];

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? t("team.activityTitle", { name: target.displayName }) : ""}
      description={t("team.activityNote")}
      footer={<Button onClick={onClose}>{t("branches.close")}</Button>}
    >
      {query.isPending && target ? <Skeleton className="h-24 w-full" /> : null}
      {query.isError ? (
        <Alert tone="danger">{describeApiError(toApiError(query.error), t).description}</Alert>
      ) : null}
      {first ? (
        <div className="flex flex-col gap-4" data-testid="activity">
          <dl className="grid grid-cols-2 gap-3">
            {(
              [
                ["team.activityStamps", first.summary.stampsIssued],
                ["team.activityRedemptions", first.summary.redemptionsProcessed],
                ["team.activityReversals", first.summary.reversalsPerformed],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-card border border-border p-3">
                <dt className="text-sm text-muted">{t(label)}</dt>
                <dd className="text-2xl font-bold tabular-nums">{format.integer(value)}</dd>
              </div>
            ))}
            <div className="rounded-card border border-border p-3">
              <dt className="text-sm text-muted">{t("team.activityLast")}</dt>
              <dd className="font-semibold">
                {first.summary.lastActiveAt
                  ? format.dateTime(first.summary.lastActiveAt)
                  : t("team.activityNever")}
              </dd>
            </div>
          </dl>
          {events.length === 0 ? (
            <p>{t("team.activityEmpty")}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border" data-testid="activity-events">
              {events.map((event) => {
                const key = ACTION_LABEL[event.action];
                return (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span className="font-medium">
                      {key ? t(key) : t("dashboard.actionOther", { code: event.action })}
                    </span>
                    <time className="text-sm text-muted" dateTime={event.occurredAt}>
                      {format.dateTime(event.occurredAt)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
            >
              {t("team.activityMore")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
