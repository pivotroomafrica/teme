"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  Skeleton,
  SkeletonGroup,
  useToast,
} from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { explainOrgError } from "@/features/org/errors";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { usePaged } from "@/features/org/use-paged";
import { getBrowserApi } from "@/lib/api/browser";
import type { Branch, Staff } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import {
  BLANK_BRANCH,
  branchToForm,
  createBranchSchema,
  toBranchInput,
  toBranchPatch,
  type BranchFormValues,
} from "../branch-form";

type Dialogs =
  | { kind: "none" }
  | { kind: "form"; branch: Branch | null }
  | { kind: "status"; branch: Branch }
  | { kind: "staff"; branch: Branch };

/**
 * Branches: list, add, edit, activate or deactivate, and see who works at each. What each person may do comes from
 * their permissions (`branch:manage` to change anything, `staff:read` to see the team), but the buttons only show
 * intent: the backend decides every request, and a refusal (for example deactivating the last active branch) is
 * shown in words.
 */
export function BranchesWorkspace({
  canManage,
  canReadStaff,
}: {
  canManage: boolean;
  canReadStaff: boolean;
}) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) => getBrowserApi().branches.list(signal),
  });
  const staff = useQuery({
    queryKey: ["team"],
    queryFn: ({ signal }) => getBrowserApi().team.list(signal),
    enabled: canReadStaff,
  });
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialogs>({ kind: "none" });

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = branches.data ?? [];
    if (!needle) return all;
    return all.filter((b) =>
      [b.nameEn, b.nameAm ?? "", b.city ?? ""].some((v) => v.toLowerCase().includes(needle)),
    );
  }, [branches.data, search]);
  const paged = usePaged(shown);

  if (branches.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </SkeletonGroup>
    );
  }
  if (branches.isError) {
    const failure = toApiError(branches.error);
    return (
      <ErrorState
        title={t("errors.genericTitle")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void branches.refetch()}
        retrying={branches.isFetching}
      />
    );
  }

  const name = (b: Branch) => pickLocalized(locale, b.nameEn, b.nameAm);
  const team = (b: Branch): Staff[] =>
    (staff.data ?? []).filter((s) => s.branchIds.includes(b.id) && s.status !== "DEACTIVATED");

  function refresh(saved?: Branch) {
    if (saved) {
      client.setQueryData<Branch[]>(["branches"], (current = []) =>
        current.some((b) => b.id === saved.id)
          ? current.map((b) => (b.id === saved.id ? saved : b))
          : [...current, saved],
      );
    }
    void client.invalidateQueries({ queryKey: ["branches"] });
  }

  const actions = (b: Branch) => {
    const items = [
      ...(canReadStaff
        ? [
            {
              id: "staff",
              label: t("branches.staffHere"),
              onSelect: () => setDialog({ kind: "staff", branch: b }),
            },
          ]
        : []),
      ...(canManage
        ? [
            {
              id: "edit",
              label: t("branches.edit"),
              onSelect: () => setDialog({ kind: "form", branch: b }),
            },
            {
              id: "status",
              label: b.status === "ACTIVE" ? t("branches.deactivate") : t("branches.activate"),
              tone: b.status === "ACTIVE" ? ("danger" as const) : ("default" as const),
              onSelect: () => setDialog({ kind: "status", branch: b }),
            },
          ]
        : []),
    ];
    return items.length ? (
      <DropdownMenu label={t("branches.actionsFor", { name: name(b).text })} items={items} />
    ) : null;
  };
  const statusBadge = (b: Branch) => (
    <Badge tone={b.status === "ACTIVE" ? "success" : "neutral"}>
      {b.status === "ACTIVE" ? t("branches.statusActive") : t("branches.statusInactive")}
    </Badge>
  );
  const location = (b: Branch) => [b.addressText, b.city].filter(Boolean).join(", ") || "—";
  const phone = (b: Branch) => b.phoneE164 ?? "—";

  return (
    <div className="flex flex-col gap-5">
      {!canManage ? <Alert tone="info">{t("branches.readOnly")}</Alert> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-sm min-w-0 flex-1">
          <FormField label={t("branches.search")}>
            <Input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                paged.reset();
              }}
            />
          </FormField>
        </div>
        {canManage ? (
          <Button onClick={() => setDialog({ kind: "form", branch: null })}>
            {t("branches.add")}
          </Button>
        ) : null}
      </div>

      {branches.data.length === 0 ? (
        <EmptyState
          title={t("branches.empty")}
          description={t("branches.emptyBody")}
          action={
            canManage ? (
              <Button onClick={() => setDialog({ kind: "form", branch: null })}>
                {t("branches.add")}
              </Button>
            ) : undefined
          }
        />
      ) : shown.length === 0 ? (
        <p className="text-muted" data-testid="no-match">
          {t("branches.noMatch")}
        </p>
      ) : (
        <>
          <ResponsiveTable
            label={t("branches.tableLabel")}
            items={paged.slice}
            rowKey={(b) => b.id}
            columns={[
              {
                id: "name",
                header: t("branches.colName"),
                rowHeader: true,
                cell: (b) => <span lang={name(b).lang}>{name(b).text}</span>,
              },
              { id: "location", header: t("branches.colLocation"), cell: location },
              { id: "phone", header: t("branches.colPhone"), cell: phone },
              { id: "status", header: t("branches.colStatus"), cell: statusBadge },
              ...(canReadStaff
                ? [
                    {
                      id: "team",
                      header: t("branches.colStaff"),
                      cell: (b: Branch) => team(b).length,
                    },
                  ]
                : []),
              { id: "actions", header: t("branches.colActions"), cell: actions },
            ]}
            card={(b) => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg font-bold break-words" lang={name(b).lang}>
                    {name(b).text}
                  </p>
                  {statusBadge(b)}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("branches.colLocation")}</dt>
                  <dd className="break-words">{location(b)}</dd>
                  <dt className="text-muted">{t("branches.colPhone")}</dt>
                  <dd>{phone(b)}</dd>
                  {canReadStaff ? (
                    <>
                      <dt className="text-muted">{t("branches.colStaff")}</dt>
                      <dd>{team(b).length}</dd>
                    </>
                  ) : null}
                </dl>
                <div>{actions(b)}</div>
              </div>
            )}
          />
          <Pagination
            hasPrevious={paged.hasPrevious}
            hasNext={paged.hasNext}
            onPrevious={paged.previous}
            onNext={paged.next}
            from={paged.from}
            to={paged.to}
            total={paged.total}
          />
        </>
      )}

      <BranchFormDialog
        key={dialog.kind === "form" ? (dialog.branch?.id ?? "new") : "closed"}
        open={dialog.kind === "form"}
        branch={dialog.kind === "form" ? dialog.branch : null}
        onClose={() => setDialog({ kind: "none" })}
        onSaved={(saved, created) => {
          refresh(saved);
          setDialog({ kind: "none" });
          toast.show({
            tone: "success",
            title: created ? t("branches.created") : t("branches.saved"),
          });
        }}
      />

      <ConfirmDialog
        open={dialog.kind === "status"}
        tone={dialog.kind === "status" && dialog.branch.status === "ACTIVE" ? "danger" : "primary"}
        title={
          dialog.kind === "status"
            ? t(
                dialog.branch.status === "ACTIVE"
                  ? "branches.deactivateTitle"
                  : "branches.activateTitle",
                {
                  name: name(dialog.branch).text,
                },
              )
            : ""
        }
        description={
          dialog.kind === "status"
            ? t(
                dialog.branch.status === "ACTIVE"
                  ? "branches.deactivateBody"
                  : "branches.activateBody",
              )
            : undefined
        }
        confirmLabel={
          dialog.kind === "status" && dialog.branch.status === "ACTIVE"
            ? t("branches.deactivate")
            : t("branches.activate")
        }
        cancelLabel={t("ui.cancel")}
        onCancel={() => setDialog({ kind: "none" })}
        onConfirm={async () => {
          if (dialog.kind !== "status") return;
          const target = dialog.branch;
          const deactivating = target.status === "ACTIVE";
          try {
            const api = getBrowserApi().branches;
            const saved = deactivating
              ? await api.deactivate(target.id)
              : await api.activate(target.id);
            refresh(saved);
            setDialog({ kind: "none" });
            toast.show({
              tone: "success",
              title: deactivating ? t("branches.deactivated") : t("branches.activated"),
            });
          } catch (error) {
            setDialog({ kind: "none" });
            toast.show({ tone: "danger", title: explainOrgError(error, t) });
          }
        }}
      />

      <Dialog
        open={dialog.kind === "staff"}
        onClose={() => setDialog({ kind: "none" })}
        title={
          dialog.kind === "staff"
            ? t("branches.staffTitle", { name: name(dialog.branch).text })
            : ""
        }
        footer={<Button onClick={() => setDialog({ kind: "none" })}>{t("branches.close")}</Button>}
      >
        {dialog.kind === "staff" ? (
          <BranchTeam team={team(dialog.branch)} loading={staff.isPending} failed={staff.isError} />
        ) : null}
      </Dialog>
    </div>
  );
}

function BranchTeam({
  team,
  loading,
  failed,
}: {
  team: Staff[];
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useI18n();
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (failed) return <Alert tone="danger">{t("team.loadErrorTitle")}</Alert>;
  return (
    <div className="flex flex-col gap-3" data-testid="branch-team">
      {team.length === 0 ? (
        <p>{t("branches.staffEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {team.map((s) => (
            <li key={s.id} className="py-2">
              <p className="font-medium">{s.displayName}</p>
              <p className="text-sm text-muted">{s.email}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">{t("branches.staffAllNote")}</p>
    </div>
  );
}

function BranchFormDialog({
  open,
  branch,
  onClose,
  onSaved,
}: {
  open: boolean;
  branch: Branch | null;
  onClose: () => void;
  onSaved: (branch: Branch, created: boolean) => void;
}) {
  const { t } = useI18n();
  const schema = useMemo(() => createBranchSchema(t), [t]);
  const initial = branch ? branchToForm(branch) : BLANK_BRANCH;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BranchFormValues>({ resolver: zodResolver(schema), defaultValues: initial });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      reset(branch ? branchToForm(branch) : BLANK_BRANCH);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh form clears the previous attempt's message
      setProblem(null);
    }
  }, [open, branch, reset]);

  const submit = handleSubmit(async (values) => {
    setProblem(null);
    try {
      const api = getBrowserApi().branches;
      if (!branch) {
        onSaved(await api.create(toBranchInput(values)), true);
        return;
      }
      const patch = toBranchPatch(values, branch);
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      onSaved(await api.update(branch.id, patch), false);
    } catch (error) {
      const e = toApiError(error);
      for (const field of Object.keys(e.fieldErrors)) {
        if (field === "phone") setError("phone", { message: t("branches.errPhone") });
        if (field === "nameEn") setError("nameEn", { message: t("branches.errName") });
      }
      setProblem(explainOrgError(error, t));
    }
  });

  const field = (n: keyof BranchFormValues) => errors[n]?.message as string | undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!isSubmitting}
      title={branch ? t("branches.formEdit", { name: branch.nameEn }) : t("branches.formCreate")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t("ui.cancel")}
          </Button>
          <Button
            type="submit"
            form="branch-form"
            loading={isSubmitting}
            loadingLabel={t("branches.saving")}
          >
            {t("branches.save")}
          </Button>
        </>
      }
    >
      <form id="branch-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        {problem ? <Alert tone="danger">{problem}</Alert> : null}
        <FormField label={t("branches.nameEn")} error={field("nameEn")} required>
          <Input {...register("nameEn")} />
        </FormField>
        <FormField label={t("branches.nameAm")} error={field("nameAm")}>
          <Input lang="am" {...register("nameAm")} />
        </FormField>
        <FormField label={t("branches.address")} error={field("addressText")}>
          <Input {...register("addressText")} />
        </FormField>
        <FormField label={t("branches.city")} error={field("city")}>
          <Input {...register("city")} />
        </FormField>
        <FormField
          label={t("branches.phone")}
          hint={t("branches.phoneHint")}
          error={field("phone")}
        >
          <Input inputMode="tel" {...register("phone")} />
        </FormField>
      </form>
    </Dialog>
  );
}
