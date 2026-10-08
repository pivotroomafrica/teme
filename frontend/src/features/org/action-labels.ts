import type { MessageKey } from "@/lib/i18n/translator";

/** Audit action codes the backend sends, with their translated labels. Unknown codes are shown as they are. */
export const ACTION_LABEL: Record<string, MessageKey> = {
  "stamp.issued": "dashboard.actionStampIssued",
  "reward.unlocked": "dashboard.actionRewardUnlocked",
  "reward.redeemed": "dashboard.actionRewardRedeemed",
  "scan.rejected": "dashboard.actionScanRejected",
  "staff.role_changed": "dashboard.actionStaffRoleChanged",
  "program.activated": "dashboard.actionProgramActivated",
  "auth.login": "dashboard.actionAuthLogin",
  "branch.updated": "dashboard.actionBranchUpdated",
};
