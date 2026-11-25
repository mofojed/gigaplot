import { BusinessCalendar, type SeriesDelta } from "gigaplot";
import { MarketDataSource } from "./MarketDataSource";

const CALENDAR = {
  timeZone: "America/New_York",
  sessions: [["09:30", "16:00"]] as [string, string][],
  holidays: ["2026-01-19"],
};

function makeSource(): MarketDataSource {
  return new MarketDataSource(
    [{ id: "a", name: "A", start: 100, volatility: 0.001 }],
    {
      calendar: CALENDAR,
      startDate: "2026-01-16",
      initialDays: 1,
      barsPerTick: 2,
      intervalMs: 100,
      seed: 3,
    },
  );
}

async function getBars(source: MarketDataSource) {
  const { data } = await source.requestSeriesData({
    seriesId: "a",
    viewport: { xMin: 0, xMax: 1e15, yMin: 0, yMax: 1e3 },
    pixelSize: { width: 1e6, height: 100 },
    style: {},
  });
  return data;
}

it("only trades a bar a minute within sessions", async () => {
  const bars = await getBars(makeSource());
  // Friday's one session, from 9:30 to 16:00
  expect(bars.length).toBe(390);
  expect(bars.x[0]).toBe(Date.parse("2026-01-16T14:30:00Z"));
  expect(bars.x[389]).toBe(Date.parse("2026-01-16T20:59:00Z"));
});

it("ticks from a close to the next open, skipping weekends and holidays", async () => {
  const source = makeSource();
  const deltas: SeriesDelta[] = [];
  source.addEventListener("datachanged", (event) =>
    deltas.push(...event.deltas),
  );
  source.tick();

  const appended = deltas[0];
  expect(appended.type).toBe("append");
  // Monday the 19th is a holiday, so Tuesday's open is next
  const x = appended.type === "append" ? Array.from(appended.data.x) : [];
  expect(x).toEqual([
    Date.parse("2026-01-20T14:30:00Z"),
    Date.parse("2026-01-20T14:31:00Z"),
  ]);
  const calendar = new BusinessCalendar(CALENDAR);
  expect(calendar.getSessions(Date.parse("2026-01-19") / 86_400_000)).toEqual(
    [],
  );
  expect((await getBars(source)).length).toBe(392);
});
