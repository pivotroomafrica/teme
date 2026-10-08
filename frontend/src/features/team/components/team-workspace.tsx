"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  DropdownMenu,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Pagination,
  Select,
  Skeleton,
  SkeletonGroup,
  useToast,
} from "@/components/ui";
import type { Tone } from "@/components/ui";
import { pickLocalized } from "@/features/enrollment/localized";
import { ResponsiveTable } from "@/features/org/responsive-table";
import { usePaged } from "@/features/org/use-paged";
import { getBrowserApi } from "@/lib/api/browser";
import type { Branch, InvitedStaff, Staff } from "@/lib/api/contract";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import { canManageMember, filterTeam, grantableRoles, isSelf, type Actor } from "../team-rules";
import {
  ActivityDialog,
  InviteDialog,
  MemberBranchesDialog,
  ROLE_LABEL,
  RoleDialog,
  StatusDialog,
  TokenDialog,
  type StatusAction,
} from "./team-dialogs";

const STATUS_LABEL: Record<Staff["status"], MessageKey> = {
  INVITED: "team.statusInvited",
  ACTIVE: "team.statusActive",
  DEACTIVATED: "team.statusDeactivated",
};
const STATUS_TONE: Record<Staff["status"], Tone> = {
  INVITED: "warning",
  ACTIVE: "success",
  DEACTIVATED: "neutral",
};

type Open =
  | { kind: "none" }
  | { kind: "invite" }
  | { kind: "role"; staff: Staff }
  | { kind: "branches"; staff: Staff }
  | { kind: "status"; staff: Staff; action: StatusAction }
  | { kind: "activity"; staff: Staff };

/**
 * The team: list, filter, invite, change role or branches, activate or deactivate, and read recent activity.
 *
 * Who is offered what follows the person's permissions and role (`staff:manage` to change anything; managers only
 * for branch staff; never for themselves). That only shapes the buttons: the backend decides every request, and
 * its refusals (the last active owner, someone else's role, a deactivated member...) are shown in words. A
 * disabled button is never treated as protection.
 */
export function TeamWorkspace({ actor, canManage }: { actor: Actor; canManage: boolean }) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const toast = useToast();
  const team = useQuery({
    queryKey: ["team"],
    queryFn: ({ signal }) => getBrowserApi().team.list(signal),
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: ({ signal }) => getBrowserApi().branches.list(signal),
  });
  const [filter, setFilter] = useState({ search: "", role: "", status: "" });
  const [open, setOpen] = useState<Open>({ kind: "none" });
  // Each opening gets a fresh dialog, so none of them starts with the previous person's choices or messages.
  const [session, setSession] = useState(0);
  const [token, setToken] = useState<{ value: string; expiresAt: string; name: string } | null>(
    null,
  );

  const shown = useMemo(() => filterTeam(team.data ?? [], filter), [team.data, filter]);
  const paged = usePaged(shown);
  const roles = grantableRoles(actor);

  if (team.isPending) {
    return (
      <SkeletonGroup className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </SkeletonGroup>
    );
  }
  if (team.isError) {
    const failure = toApiError(team.error);
    return (
      <ErrorState
        title={t("team.loadErrorTitle")}
        description={describeApiError(failure, t).description}
        requestId={failure.requestId}
        onRetry={() => void team.refetch()}
        retrying={team.isFetching}
      />
    );
  }

  const branchList: Branch[] = branches.data ?? [];
  const branchName = (id: string) => {
    const b = branchList.find((x) => x.id === id);
    return b ? pickLocalized(locale, b.nameEn, b.nameAm).text : id.slice(0, 8);
  };
  const branchesOf = (s: Staff) =>
    s.roleKey !== "STAFF" && s.branchIds.length === 0
      ? t("team.allBranches")
      : s.branchIds.length === 0
        ? t("team.noBranches")
        : s.branchIds.map(branchName).join(", ");

  function changed(staff?: Staff) {
    if (staff) {
      client.setQueryData<Staff[]>(["team"], (current = []) =>
        current.some((s) => s.id === staff.id)
          ? current.map((s) => (s.id === staff.id ? staff : s))
          : [...current, staff],
      );
    }
    void client.invalidateQueries({ queryKey: ["team"] });
  }

  const manageable = (s: Staff) => canManageMember(actor, s, canManage);
  const menu = (s: Staff) => {
    const can = manageable(s);
    const deactivated = s.status === "DEACTIVATED";
    const items = [
      {
        id: "activity",
        label: t("team.viewActivity"),
        onSelect: () => setOpen({ kind: "activity", staff: s }),
      },
      ...(canManage
        ? [
            {
              id: "role",
              label: t("team.changeRole"),
              disabled: !can || deactivated,
              onSelect: () => setOpen({ kind: "role", staff: s }),
            },
            {
              id: "branches",
              label: t("team.changeBranches"),
              disabled: !can || deactivated,
              onSelect: () => setOpen({ kind: "branches", staff: s }),
            },
            ...(s.status === "INVITED"
              ? [
                  {
                    id: "reissue",
                    label: t("team.reissue"),
                    disabled: !can,
                    onSelect: () =>
                      setOpen({ kind: "status", staff: s, action: "reissue" as const }),
                  },
                ]
              : []),
            ...(s.status === "DEACTIVATED"
              ? [
                  {
                    id: "activate",
                    label: t("team.activate"),
                    disabled: !can,
                    onSelect: () =>
                      setOpen({ kind: "status", staff: s, action: "activate" as const }),
                  },
                ]
              : []),
            ...(s.status !== "DEACTIVATED"
              ? [
                  {
                    id: "deactivate",
                    label: t("team.deactivate"),
                    tone: "danger" as const,
                    disabled: !can,
                    onSelect: () =>
                      setOpen({ kind: "status", staff: s, action: "deactivate" as const }),
                  },
                ]
              : []),
          ]
        : []),
    ];
    return <DropdownMenu label={t("team.actionsFor", { name: s.displayName })} items={items} />;
  };

  const nameCell = (s: Staff) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium">{s.displayName}</span>
      {isSelf(actor, s) ? <Badge tone="info">{t("team.you")}</Badge> : null}
    </span>
  );
  const roleCell = (s: Staff) => t(ROLE_LABEL[s.roleKey]);
  const statusCell = (s: Staff) => (
    <Badge tone={STATUS_TONE[s.status]}>{t(STATUS_LABEL[s.status])}</Badge>
  );

  const meInList = (team.data ?? []).some((s) => isSelf(actor, s));
  const target = open.kind === "none" || open.kind === "invite" ? null : open.staff;

  return (
    <div className="flex flex-col gap-5">
      {!canManage ? <Alert tone="info">{t("team.readOnly")}</Alert> : null}
      {canManage && actor.role === "MANAGER" ? (
        <Alert tone="info">{t("team.managerNote")}</Alert>
      ) : null}
      {canManage && meInList ? <p className="text-sm text-muted">{t("team.selfNote")}</p> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="max-w-sm min-w-0 flex-1">
          <FormField label={t("team.search")}>
            <Input
              type="search"
              value={filter.search}
              onChange={(event) => {
                setFilter({ ...filter, search: event.target.value });
                paged.reset();
              }}
            />
          </FormField>
        </div>
        <FormField label={t("team.filterRole")}>
          <Select
            value={filter.role}
            onChange={(event) => {
              setFilter({ ...filter, role: event.target.value });
              paged.reset();
            }}
          >
            <option value="">{t("team.filterAny")}</option>
            {(["OWNER", "MANAGER", "STAFF"] as const).map((r) => (
              <option key={r} value={r}>
                {t(ROLE_LABEL[r])}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("team.filterStatus")}>
          <Select
            value={filter.status}
            onChange={(event) => {
              setFilter({ ...filter, status: event.target.value });
              paged.reset();
            }}
          >
            <option value="">{t("team.filterAny")}</option>
            {(["ACTIVE", "INVITED", "DEACTIVATED"] as const).map((s) => (
              <option key={s} value={s}>
                {t(STATUS_LABEL[s])}
              </option>
            ))}
          </Select>
        </FormField>
        {canManage && roles.length > 0 ? (
          <Button
            onClick={() => {
              setSession((n) => n + 1);
              setOpen({ kind: "invite" });
            }}
          >
            {t("team.invite")}
          </Button>
        ) : null}
      </div>

      {(team.data ?? []).length === 0 ? (
        <EmptyState title={t("team.empty")} />
      ) : shown.length === 0 ? (
        <p className="text-muted" data-testid="no-match">
          {t("team.noMatch")}
        </p>
      ) : (
        <>
          <ResponsiveTable
            label={t("team.tableLabel")}
            items={paged.slice}
            rowKey={(s) => s.id}
            columns={[
              { id: "name", header: t("team.colName"), rowHeader: true, cell: nameCell },
              { id: "email", header: t("team.colEmail"), cell: (s) => s.email },
              { id: "role", header: t("team.colRole"), cell: roleCell },
              { id: "status", header: t("team.colStatus"), cell: statusCell },
              { id: "branches", header: t("team.colBranches"), cell: branchesOf },
              { id: "actions", header: t("team.colActions"), cell: menu },
            ]}
            card={(s) => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-lg break-words">{nameCell(s)}</p>
                  {statusCell(s)}
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted">{t("team.colEmail")}</dt>
                  <dd className="break-all">{s.email}</dd>
                  <dt className="text-muted">{t("team.colRole")}</dt>
                  <dd>{roleCell(s)}</dd>
                  <dt className="text-muted">{t("team.colBranches")}</dt>
                  <dd className="break-words">{branchesOf(s)}</dd>
                </dl>
                <div>{menu(s)}</div>
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

      <InviteDialog
        key={`invite-${session}`}
        open={open.kind === "invite"}
        roles={roles}
        branches={branchList}
        onClose={() => setOpen({ kind: "none" })}
        onInvited={(result: InvitedStaff) => {
          changed(result.staff);
          setOpen({ kind: "none" });
          setToken({
            value: result.invitation.token,
            expiresAt: result.invitation.expiresAt,
            name: result.staff.displayName,
          });
        }}
      />
      <TokenDialog token={token} name={token?.name ?? ""} onClose={() => setToken(null)} />

      <RoleDialog
        key={`role-${target?.id ?? "none"}`}
        target={open.kind === "role" ? open.staff : null}
        actor={actor}
        team={team.data ?? []}
        roles={roles}
        onClose={() => setOpen({ kind: "none" })}
        onChanged={(staff) => {
          changed(staff);
          setOpen({ kind: "none" });
          toast.show({ tone: "success", title: t("team.roleChanged") });
        }}
      />
      <MemberBranchesDialog
        key={`branches-${target?.id ?? "none"}`}
        target={open.kind === "branches" ? open.staff : null}
        actor={actor}
        branches={branchList}
        onClose={() => setOpen({ kind: "none" })}
        onChanged={(staff) => {
          changed(staff);
          setOpen({ kind: "none" });
          toast.show({ tone: "success", title: t("team.branchesChanged") });
        }}
      />
      <StatusDialog
        key={`status-${target?.id ?? "none"}-${open.kind === "status" ? open.action : ""}`}
        target={open.kind === "status" ? open.staff : null}
        action={open.kind === "status" ? open.action : null}
        actor={actor}
        team={team.data ?? []}
        onClose={() => setOpen({ kind: "none" })}
        onDone={(result) => {
          const action = open.kind === "status" ? open.action : null;
          const who = target;
          setOpen({ kind: "none" });
          if (result.invitation && who) {
            setToken({
              value: result.invitation.token,
              expiresAt: result.invitation.expiresAt,
              name: who.displayName,
            });
          }
          if (result.staff) {
            changed(result.staff);
            toast.show({
              tone: "success",
              title: action === "deactivate" ? t("team.deactivated") : t("team.activated"),
            });
          }
        }}
      />
      <ActivityDialog
        target={open.kind === "activity" ? open.staff : null}
        onClose={() => setOpen({ kind: "none" })}
      />
    </div>
  );
}
