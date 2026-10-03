/** Compact projection exported by scripts/trend/review.py; never an execution input. */
type Scalar = string | number | boolean | null;
export interface TrendResearchFinding {
  code: string;
  label: string;
  status: "pass" | "fail" | "info";
  actual: Scalar;
  threshold: Scalar;
  evidence: string;
}
export interface TrendResearchRow {
  window: string;
  candidate: string;
  costScenario: "base" | "stress";
  netReturn: number;
  dailyDrawdown: number;
  trades: number;
  netExpectancy: number | null;
  profitFactor: number | null;
  meanNetR: number | null;
  dailySharpe: number | null;
  dailyMean95CI: [number, number] | null;
}
export interface TrendResearchReview {
  kind: "trend-research-review";
  version: 1;
  title: string;
  engine: string;
  assumptions: {
    capitalMode: string;
    accountCapital: number;
    sleeveCapital: number;
    feeBps: number;
    slippageBps: number;
    stressFeeBps: number;
    stressSlippageBps: number;
  };
  identity: Record<string, string>;
  selected: string;
  selectionRule: string;
  symbols: string[];
  windows: { id: string; role: string; start: string; end: string }[];
  candidates: { id: string; parameters: Record<string, Scalar> }[];
  rows: TrendResearchRow[];
  verdict: {
    status: "pass" | "fail" | "unbound";
    stage: string;
    scope: string;
    cell: string | null;
  };
  findings: TrendResearchFinding[];
  limitations: string[];
  auditScope: string;
  qualificationReasons: string[];
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`研究文件无效：${message}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const scalar = (value: unknown): value is Scalar =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** Validate untrusted files before rendering. A browser import does not re-audit source ledgers. */
export function parseTrendResearchReview(input: unknown): TrendResearchReview {
  assert(
    record(input) && input.kind === "trend-research-review" && input.version === 1,
    "不支持的文件版本",
  );
  for (const key of ["title", "engine", "selected", "selectionRule", "auditScope"])
    assert(typeof input[key] === "string", key);
  for (const key of ["symbols", "limitations", "qualificationReasons"])
    assert(strings(input[key]), key);
  assert(record(input.identity), "缺少来源身份");
  assert(
    record(input.assumptions) && typeof input.assumptions.capitalMode === "string",
    "资金与成本口径",
  );
  for (const key of [
    "accountCapital",
    "sleeveCapital",
    "feeBps",
    "slippageBps",
    "stressFeeBps",
    "stressSlippageBps",
  ]) {
    assert(finite(input.assumptions[key]) && (input.assumptions[key] as number) >= 0, key);
  }
  assert(
    Object.values(input.identity).every((value) => typeof value === "string"),
    "来源身份字段",
  );
  for (const key of [
    "planSha256",
    "manifestSha256",
    "selectionSha256",
    "rawResultsSha256",
    "evaluationSha256",
  ]) {
    assert(
      typeof input.identity[key] === "string" && /^[a-f0-9]{64}$/.test(input.identity[key]),
      key,
    );
  }
  assert(
    Array.isArray(input.windows) && input.windows.length > 0 && input.windows.length <= 128,
    "研究窗口",
  );
  const windows = new Set<string>();
  for (const window of input.windows) {
    assert(
      record(window) &&
        ["id", "role", "start", "end"].every((key) => typeof window[key] === "string"),
      "窗口字段",
    );
    assert(!windows.has(window.id as string), "重复窗口");
    assert(
      Number.isFinite(Date.parse(window.start as string)) &&
        Date.parse(window.start as string) < Date.parse(window.end as string),
      "窗口日期",
    );
    windows.add(window.id as string);
  }
  assert(
    Array.isArray(input.candidates) &&
      input.candidates.length > 0 &&
      input.candidates.length <= 256,
    "候选数量",
  );
  const candidates = new Set<string>();
  for (const candidate of input.candidates) {
    assert(
      record(candidate) && typeof candidate.id === "string" && record(candidate.parameters),
      "候选字段",
    );
    assert(
      !candidates.has(candidate.id) && Object.values(candidate.parameters).every(scalar),
      "重复候选或参数无效",
    );
    candidates.add(candidate.id);
  }
  assert(candidates.has(input.selected as string), "冻结选择不在候选列表");
  assert(Array.isArray(input.rows) && input.rows.length <= 32768, "结果数量");
  const rows = new Set<string>();
  for (const row of input.rows) {
    assert(
      record(row) && windows.has(row.window as string) && candidates.has(row.candidate as string),
      "结果指向未知窗口或候选",
    );
    assert(row.costScenario === "base" || row.costScenario === "stress", "成本情景");
    const key = JSON.stringify([row.window, row.candidate, row.costScenario]);
    assert(!rows.has(key), "重复结果");
    rows.add(key);
    assert(
      finite(row.netReturn) && finite(row.dailyDrawdown) && (row.dailyDrawdown as number) <= 0,
      "收益或回撤",
    );
    assert(Number.isSafeInteger(row.trades) && (row.trades as number) >= 0, "交易数");
    for (const key of ["netExpectancy", "profitFactor", "meanNetR", "dailySharpe"])
      assert(row[key] === null || finite(row[key]), key);
    assert(
      row.dailyMean95CI === null ||
        (Array.isArray(row.dailyMean95CI) &&
          row.dailyMean95CI.length === 2 &&
          row.dailyMean95CI.every(finite) &&
          row.dailyMean95CI[0] <= row.dailyMean95CI[1]),
      "置信区间",
    );
  }
  assert(
    record(input.verdict) && ["pass", "fail", "unbound"].includes(input.verdict.status as string),
    "验收状态",
  );
  assert(
    typeof input.verdict.stage === "string" &&
      typeof input.verdict.scope === "string" &&
      (input.verdict.cell === null || typeof input.verdict.cell === "string"),
    "验收范围",
  );
  assert(Array.isArray(input.findings), "验收条目");
  const codes = new Set<string>();
  for (const finding of input.findings) {
    assert(
      record(finding) &&
        ["code", "label", "evidence"].every((key) => typeof finding[key] === "string"),
      "验收条目字段",
    );
    assert(
      !codes.has(finding.code as string) &&
        ["pass", "fail", "info"].includes(finding.status as string) &&
        scalar(finding.actual) &&
        scalar(finding.threshold),
      "验收值",
    );
    codes.add(finding.code as string);
  }
  if (input.verdict.status !== "unbound") {
    assert(
      ["development", "validation", "holdout"].includes(input.verdict.stage as string),
      "未知验收阶段",
    );
    assert(
      input.verdict.scope ===
        (input.verdict.stage === "development" ? "development-base-only" : "base-and-stress"),
      "阶段与成本范围矛盾",
    );
    const cell = input.verdict.cell;
    const checks = input.findings.filter((f) => f.status !== "info");
    assert(
      typeof cell === "string" &&
        checks.length > 0 &&
        checks.every((f) => f.evidence === `stage:${cell}`),
      "阶段证据",
    );
    assert(
      (input.verdict.status === "pass") === checks.every((f) => f.status === "pass"),
      "验收状态与条目矛盾",
    );
  } else {
    assert(
      input.verdict.stage === "unbound" &&
        input.verdict.scope === "descriptive-only" &&
        input.verdict.cell === null,
      "未绑定范围",
    );
    assert(
      input.findings.every((f) => f.status === "info"),
      "未绑定的验收不能标记通过或失败",
    );
  }
  return input as unknown as TrendResearchReview;
}

export function researchParameterAxes(review: TrendResearchReview): string[] {
  const keys = new Set(review.candidates.flatMap((candidate) => Object.keys(candidate.parameters)));
  return [...keys]
    .filter(
      (key) => new Set(review.candidates.map((c) => JSON.stringify(c.parameters[key]))).size > 1,
    )
    .sort();
}

/** Exact one-factor slices; no interpolation, nearest-neighbour guessing or target ranking. */
export function researchParameterSlice(
  review: TrendResearchReview,
  anchorId: string,
  axis: string,
  window: string,
  cost: string,
) {
  const anchor = review.candidates.find((candidate) => candidate.id === anchorId);
  if (!anchor || !researchParameterAxes(review).includes(axis)) return [];
  return review.candidates
    .filter((candidate) => {
      const keys = new Set([
        ...Object.keys(anchor.parameters),
        ...Object.keys(candidate.parameters),
      ]);
      return [...keys].every(
        (key) => key === axis || candidate.parameters[key] === anchor.parameters[key],
      );
    })
    .map((candidate) => ({
      candidate: candidate.id,
      value: candidate.parameters[axis],
      row:
        review.rows.find(
          (row) =>
            row.candidate === candidate.id && row.window === window && row.costScenario === cost,
        ) ?? null,
    }))
    .sort((a, b) =>
      typeof a.value === "number" && typeof b.value === "number"
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value)),
    );
}
