import { useEffect } from "react";
import type { dh as DhType } from "@deephaven/jsapi-types";
import Log from "@deephaven/log";

const log = Log.module("deephaven-plugin-gigaplot.useFetchedTable");

/**
 * Fetches each exported table and hands it to `onTable`, which takes
 * ownership. A fetch that is superseded before it resolves is closed instead.
 */
export function useFetchedTable(
  exported: DhType.WidgetExportedObject | undefined,
  onTable: ((table: DhType.Table) => void) | undefined,
  onError: (error: unknown) => void,
): void {
  useEffect(
    function fetchTable() {
      if (exported == null || onTable == null) {
        return undefined;
      }
      let isCancelled = false;
      // Re-export so the table outlives the document update that sent it
      exported
        .reexport()
        .then((reexported) => reexported.fetch())
        .then((result) => {
          const table = result as DhType.Table;
          if (isCancelled) {
            table.close();
            return;
          }
          onTable(table);
        })
        .catch((e) => {
          if (!isCancelled) {
            log.error("Unable to fetch table", e);
            onError(e);
          }
        });
      return () => {
        isCancelled = true;
      };
    },
    [exported, onTable, onError],
  );
}

export default useFetchedTable;
