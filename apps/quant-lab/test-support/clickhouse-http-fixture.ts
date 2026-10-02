import { Table, tableFromIPC, vectorFromArray, Utf8, RecordBatchStreamWriter } from "apache-arrow";
import { demoResearch } from "../src/data/demo";

/** HTTP protocol fixture, not a ClickHouse SQL implementation. Native CI covers SQL execution. */
export async function clickHouseHttpFixture() {
  const demo = demoResearch();
  const days = new Map<number, Table>();
  const fields = [
    "date",
    "open",
    "high",
    "low",
    "close",
    "preclose",
    "adjfactor",
    "profit",
    "shares",
    "is_st",
    "tradable",
    "breadth_member",
    "selection_member",
  ];
  for (const file of demo.files.slice(1)) {
    for (const batch of tableFromIPC(new Uint8Array(await file.arrayBuffer())).batches) {
      const date = Number(batch.getChild("date")!.get(0));
      const codes = Array.from(
        batch.getChild("id")!,
        (id: number) => demo.manifest.instruments[id]!.code,
      );
      const industries = Array.from(
        batch.getChild("industry")!,
        (id: number) => demo.manifest.industries[id]!,
      );
      days.set(
        date,
        new Table({
          code: vectorFromArray(codes, new Utf8()),
          industry_code: vectorFromArray(industries, new Utf8()),
          ...Object.fromEntries(fields.map((field) => [field, batch.getChild(field)!])),
        }),
      );
    }
  }
  const calendar = demo.manifest.calendar.map(({ date }) =>
    String(date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3"),
  );
  return {
    names: demo.manifest.displayNames!,
    calendar,
    codes: demo.manifest.instruments.map((i) => i.code),
    industries: demo.manifest.industries,
    arrow: (start: string, end: string) => {
      const first = Number(start.replaceAll("-", "")),
        last = Number(end.replaceAll("-", ""));
      const batches = [...days]
        .filter(([date]) => date >= first && date <= last)
        .flatMap(([, table]) => table.batches);
      return RecordBatchStreamWriter.writeAll(new Table(batches)).toUint8Array(true);
    },
  };
}
