"use client";

import { useState } from "react";
import { ConfirmDialog, DropdownMenu, useToast, type MenuItem } from "@/components/ui";
import { toApiError } from "@/lib/errors/api-error";
import { describeApiError } from "@/lib/errors/messages";
import { useI18n } from "@/lib/i18n/client";
import { sessionClient } from "../session-client";

/**
 * The person's own menu: switch branch (staff with several), log out, log out of all devices. Logging out
 * always ends THIS browser's session even if the backend is unreachable; "all devices" must succeed on the
 * backend, so a failure is reported instead of pretending it worked.
 */
export function AccountMenu({
  displayName,
  switchBranchHref,
}: {
  displayName: string;
  /** Present for branch staff with more than one branch. */
  switchBranchHref?: string;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [confirmAll, setConfirmAll] = useState(false);

  // A full page load on purpose: it discards every client-side cache of the signed-out person's data.
  const go = (reason: "signed-out" | "revoked") =>
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/${locale}/session-expired?reason=${reason}`);

  const items: MenuItem[] = [
    ...(switchBranchHref
      ? [{ id: "branch", label: t("auth.switchBranch"), href: switchBranchHref }]
      : []),
    {
      id: "logout",
      label: t("auth.logOut"),
      onSelect: async () => {
        try {
          await sessionClient.signOut();
        } finally {
          go("signed-out");
        }
      },
    },
    {
      id: "logout-all",
      label: t("auth.logOutAll"),
      tone: "danger",
      onSelect: () => setConfirmAll(true),
    },
  ];

  return (
    <>
      <DropdownMenu
        label={<span className="max-w-40 truncate">{displayName}</span>}
        items={items}
      />
      <ConfirmDialog
        open={confirmAll}
        onCancel={() => setConfirmAll(false)}
        tone="danger"
        title={t("auth.logOutAllTitle")}
        description={t("auth.logOutAllBody")}
        confirmLabel={t("auth.logOutAll")}
        onConfirm={async () => {
          try {
            await sessionClient.signOutAllDevices();
            go("revoked");
          } catch (e) {
            const error = toApiError(e);
            if (error.isAuthError) return go("revoked");
            setConfirmAll(false);
            toast.show({ tone: "danger", ...describeApiError(error, t) });
          }
        }}
      />
    </>
  );
}
