import type { AutoPayRuntimeOptions, AutoPaySupabase } from "./types";
import { groupStockChanges } from "./group-stock-changes";
import { sendGroupNotifications } from "./send-group-notification";
import { submitGroupPayments } from "./submit-group-payment";

export async function processAutoPayGroups(
  options: AutoPayRuntimeOptions & {
    supabase: AutoPaySupabase;
    runGrouping?: boolean;
    runNotifications?: boolean;
    runCharges?: boolean;
  },
) {
  const {
    runGrouping = true,
    runNotifications = true,
    runCharges = true,
  } = options;

  const grouping = runGrouping
    ? await groupStockChanges(options)
    : {
        scannedRows: 0,
        matchedRows: 0,
        affectedGroups: 0,
        updatedRows: 0,
        skippedRows: 0,
        failures: [],
        groups: [],
      };

  const notifications = runNotifications
    ? await sendGroupNotifications(options)
    : {
        scannedRows: 0,
        matchedRows: 0,
        affectedGroups: 0,
        updatedRows: 0,
        skippedRows: 0,
        failures: [],
      };

  const charges = runCharges
    ? await submitGroupPayments(options)
    : {
        scannedRows: 0,
        matchedRows: 0,
        affectedGroups: 0,
        updatedRows: 0,
        skippedRows: 0,
        failures: [],
      };

  return {
    grouping,
    notifications,
    charges,
  };
}
