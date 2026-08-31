import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWorkerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import mvpWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import { tableToIPC, type Table } from "apache-arrow";
import { decodeMarketArrow, marketTableFromBars } from "./arrow";
import type { ColumnarMetadata, MarketBar } from "./model";

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasmUrl, mainWorker: mvpWorkerUrl },
  eh: { mainModule: ehWasmUrl, mainWorker: ehWorkerUrl },
};

export interface ColumnarDatasetPayload {
  readonly bars: ReadonlyArray<MarketBar>;
  readonly arrow: Uint8Array;
  readonly parquet: Uint8Array;
  readonly metadata: ColumnarMetadata;
}

let databasePromise: Promise<duckdb.AsyncDuckDB> | undefined;
let relationId = 0;

async function createDatabase(): Promise<duckdb.AsyncDuckDB> {
  const bundle = await duckdb.selectBundle(BUNDLES);
  if (bundle.mainWorker === null) throw new Error("DuckDB-WASM worker bundle unavailable");
  const worker = new Worker(bundle.mainWorker);
  const database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  try {
    await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
    return database;
  } catch (error) {
    await database.terminate();
    throw error;
  }
}

function database(): Promise<duckdb.AsyncDuckDB> {
  databasePromise ??= createDatabase().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

function scalar(table: Table, name: string): unknown {
  return table.getChild(name)?.get(0);
}

async function metadataFor(
  connection: duckdb.AsyncDuckDBConnection,
  relation: string,
  source: ColumnarMetadata["source"],
  arrowBytes: number,
  parquetBytes: number,
): Promise<ColumnarMetadata> {
  const profile = await connection.query(`
    SELECT
      COUNT(*)::DOUBLE AS row_count,
      MIN(CAST(date AS VARCHAR)) AS min_date,
      MAX(CAST(date AS VARCHAR)) AS max_date,
      AVG(CAST(volume AS DOUBLE)) AS average_volume
    FROM "${relation}"
  `);
  const engine = await connection.bindings.getVersion();
  return {
    source,
    engine: `DuckDB ${engine} · Arrow 17`,
    arrowBytes,
    parquetBytes,
    rowCount: Number(scalar(profile, "row_count")),
    minDate: String(scalar(profile, "min_date") ?? ""),
    maxDate: String(scalar(profile, "max_date") ?? ""),
    averageVolume: Number(scalar(profile, "average_volume")),
  };
}

async function exportParquet(
  connection: duckdb.AsyncDuckDBConnection,
  database: duckdb.AsyncDuckDB,
  relation: string,
  fileName: string,
): Promise<Uint8Array> {
  await connection.query(`COPY "${relation}" TO '${fileName}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  return database.copyFileToBuffer(fileName);
}

/** 将行式 OHLCV 转为 Arrow IPC，并通过 DuckDB 物化为压缩 Parquet。 */
export async function columnarizeMarketBars(
  input: ReadonlyArray<MarketBar>,
  source: Exclude<ColumnarMetadata["source"], "parquet">,
): Promise<ColumnarDatasetPayload> {
  const table = marketTableFromBars(input);
  const arrow = tableToIPC(table, "stream");
  const db = await database();
  const connection = await db.connect();
  const id = relationId++;
  const relation = `market_${id}`;
  const fileName = `market_${id}.parquet`;
  try {
    await connection.insertArrowTable(table, { name: relation, create: true });
    const parquet = await exportParquet(connection, db, relation, fileName);
    const metadata = await metadataFor(
      connection,
      relation,
      source,
      arrow.byteLength,
      parquet.byteLength,
    );
    return { bars: decodeMarketArrow(arrow), arrow, parquet, metadata };
  } finally {
    await connection.query(`DROP TABLE IF EXISTS "${relation}"`).catch(() => undefined);
    await db.dropFile(fileName).catch(() => null);
    await connection.close();
  }
}

/** DuckDB 直接扫描用户提供的 Parquet，再产出规范化 Arrow 批次供 Pipeline 使用。 */
export async function readMarketParquet(bytes: Uint8Array): Promise<ColumnarDatasetPayload> {
  if (
    bytes.byteLength < 8 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "PAR1" ||
    String.fromCharCode(...bytes.subarray(-4)) !== "PAR1"
  ) {
    throw new Error("Parquet 文件头无效");
  }
  const db = await database();
  const connection = await db.connect();
  const id = relationId++;
  const relation = `market_${id}`;
  const fileName = `import_${id}.parquet`;
  // registerFileBuffer 会把传入 buffer 转移给 DuckDB worker；保留独立副本作为 Artifact。
  const parquet = bytes.slice();
  try {
    await db.registerFileBuffer(fileName, bytes);
    const table = await connection.query(`
      CREATE OR REPLACE TABLE "${relation}" AS
      SELECT
        CAST(date AS VARCHAR) AS date,
        CAST(open AS DOUBLE) AS open,
        CAST(high AS DOUBLE) AS high,
        CAST(low AS DOUBLE) AS low,
        CAST(close AS DOUBLE) AS close,
        CAST(volume AS DOUBLE) AS volume
      FROM read_parquet('${fileName}')
      ORDER BY TRY_CAST(date AS DATE), date
    `);
    void table;
    const normalized = await connection.query(`SELECT * FROM "${relation}"`);
    const arrow = tableToIPC(normalized, "stream");
    const bars = decodeMarketArrow(arrow);
    const metadata = await metadataFor(
      connection,
      relation,
      "parquet",
      arrow.byteLength,
      parquet.byteLength,
    );
    return { bars, arrow, parquet, metadata };
  } finally {
    await connection.query(`DROP TABLE IF EXISTS "${relation}"`).catch(() => undefined);
    await db.dropFile(fileName).catch(() => null);
    await connection.close();
  }
}
