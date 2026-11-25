import type { dh as DhType } from "@deephaven/jsapi-types";
import {
  createFormatterFromSettings,
  type DateTimeColumnFormatter,
  type Settings,
} from "@deephaven/jsapi-utils";
import { INSTANT_TYPE, toEpochNanos } from "./instants";
import { getTickPattern, type InstantFormatter } from "./timeTicks";

const OFFSET_PATTERN = "yyyy-MM-dd HH:mm:ss";
const OFFSET_REGEX = /^(-?\d+)-(\d+)-(\d+) (\d+):(\d+):(\d+)$/;

/**
 * Formats Instants of a column the way the user's workspace settings format it
 * in a grid: their time zone, date time format, and any format rule for the
 * column.
 */
export function createInstantFormatter(
  dh: typeof DhType,
  settings: Settings | undefined,
  columnName: string,
): InstantFormatter {
  const formatter = createFormatterFromSettings(dh, settings);
  const dateTimeFormatter = formatter.getColumnTypeFormatter(
    INSTANT_TYPE,
  ) as DateTimeColumnFormatter;
  const columnFormat = formatter.getColumnFormat(INSTANT_TYPE, columnName);
  const pattern = dateTimeFormatter.getEffectiveFormatString(
    columnFormat?.formatString || dateTimeFormatter.defaultDateTimeFormatString,
  );
  const timeZone = dateTimeFormatter.dhTimeZone;
  const patterns = new Map<string, string>();

  return {
    format(epochNanos, resolution) {
      const key = `${resolution.field}:${resolution.fractionDigits}`;
      let tickPattern = patterns.get(key);
      if (tickPattern == null) {
        tickPattern = getTickPattern(pattern, resolution);
        patterns.set(key, tickPattern);
      }
      return dh.i18n.DateTimeFormat.format(tickPattern, epochNanos, timeZone);
    },
    getOffsetSeconds(epochSeconds) {
      // The JS API has no offset lookup, so read the local wall clock instead
      const match = OFFSET_REGEX.exec(
        dh.i18n.DateTimeFormat.format(
          OFFSET_PATTERN,
          toEpochNanos(0, epochSeconds),
          timeZone,
        ),
      );
      if (match == null) {
        return 0;
      }
      const [, year, month, day, hours, minutes, seconds] = match.map(Number);
      const local = new Date(0);
      local.setUTCFullYear(year, month - 1, day);
      local.setUTCHours(hours, minutes, seconds);
      return local.getTime() / 1000 - epochSeconds;
    },
  };
}
