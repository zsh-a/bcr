import { createServer } from "node:http";
import { clickHouseHttpFixture } from "../apps/quant-lab/test-support/clickhouse-http-fixture";

const fixture = await clickHouseHttpFixture();
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "X-ClickHouse-User, X-ClickHouse-Key, Content-Type",
  );
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/ping") {
    response.end("Ok.");
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "POST" || url.searchParams.get("readonly") !== "1") {
    response.writeHead(400);
    response.end("readonly POST required");
    return;
  }
  let sql = "";
  for await (const chunk of request) {
    sql += String(chunk);
    if (sql.length > 100_000) {
      response.writeHead(413);
      response.end();
      return;
    }
  }
  if (!/^(SELECT|WITH)\b/u.test(sql.trimStart())) {
    response.writeHead(400);
    response.end("SELECT or WITH required");
    return;
  }
  if (sql.includes("FORMAT ArrowStream")) {
    const bytes = fixture.arrow(
      url.searchParams.get("param_start")!,
      url.searchParams.get("param_end")!,
    );
    response.setHeader("Content-Type", "application/octet-stream");
    response.end(bytes);
    return;
  }
  let rows: unknown[];
  if (sql.includes("1 AS connected")) rows = [{ connected: 1 }];
  else if (sql.includes("stock_daily FINAL") && sql.includes("{code:String}")) {
    const start = url.searchParams.get("param_start")!,
      end = url.searchParams.get("param_end")!;
    rows = fixture.calendar
      .filter((date) => date >= start && date <= end)
      .map((date, i) => ({ date, close: 100 + i * 0.1 }));
  } else if (sql.includes("version()")) rows = [{ version: "synthetic-http-fixture" }];
  else if (sql.includes("min(date)"))
    rows = [{ firstDate: fixture.calendar[0], lastDate: fixture.calendar.at(-1) }];
  else if (sql.includes("system.columns"))
    rows = [
      ...["code", "name", "last_update_date"].map((name) => ({ table: "stock_daily_meta", name })),
      ...["code", "industry_code", "industry_name", "enter_date"].map((name) => ({
        table: "industry_info",
        name,
      })),
    ];
  else if (sql.includes("AS display_name FROM stock_daily_meta"))
    rows = Object.entries(fixture.names.instruments).map(([code, display_name]) => ({
      code,
      display_name,
    }));
  else if (sql.includes("AS display_name FROM industry_info"))
    rows = Object.entries(fixture.names.industries).map(([code, display_name]) => ({
      code,
      display_name,
    }));
  else if (sql.includes("ORDER BY calendar_date DESC"))
    rows = fixture.calendar
      .slice(-2)
      .reverse()
      .map((date) => ({ date }));
  else if (sql.includes("FROM trade_dates")) rows = fixture.calendar.map((date) => ({ date }));
  else if (sql.includes("DISTINCT code")) rows = fixture.codes.map((code) => ({ code }));
  else if (sql.includes("DISTINCT industry_code"))
    rows = fixture.industries.map((industry_code) => ({ industry_code }));
  else {
    response.writeHead(400);
    response.end("unsupported fixture query");
    return;
  }
  response.setHeader("Content-Type", "application/x-ndjson");
  response.end(rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
});
server.listen(Number(process.env.JSG_FIXTURE_PORT ?? "8126"), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => server.close(() => process.exit(0)));
