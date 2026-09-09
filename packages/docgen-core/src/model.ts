/**
 * DocGen 数据模型：schema 驱动的虚构公用事业账单。
 * 所有机构 / 地区 / 货币均为虚构，仅用于版式学习演示。
 */

export type RegionId = "nordhavn" | "caldera" | "veridia" | "castellan";

export type BillKind = "water" | "power" | "gas" | "telecom";

/** 表单字段 schema：驱动地址表单渲染与校验 */
export interface TextFieldSchema {
  readonly kind: "text";
  /** address Record 的键，如 "street" / "postcode" */
  readonly key: string;
  /** 表单里的中文 label */
  readonly label: string;
  readonly placeholder: string;
  readonly required: boolean;
  readonly maxLength: number;
  /** 可选格式校验（如邮编） */
  readonly pattern?: RegExp;
}

export type FieldSchema = TextFieldSchema;

export interface BillInput {
  readonly docType: string;
  readonly name: string;
  readonly address: Record<string, string>;
  /** "YYYY-MM-DD"；null = 自动取当天 */
  readonly billDate: string | null;
}

/** 账单表上的一行抄表/用量记录 */
export interface MeterRow {
  readonly label: string;
  readonly previous: string;
  readonly current: string;
  readonly usage: string;
}

/** 柱状图一格（近 N 期用量） */
export interface UsageBar {
  readonly label: string;
  readonly value: number;
}

/** 费用明细行 */
export interface ChargeLine {
  readonly label: string;
  readonly amount: number;
}

/** 美式流派的账户摘要：total = previousBalance − paymentsReceived + currentCharges */
export interface AccountSummary {
  readonly previousBalance: number;
  readonly paymentsReceived: number;
  readonly currentCharges: number;
}

/** 渲染所需的全部派生数据（renderHtml 不再做任何计算） */
export interface BillViewModel {
  readonly docType: string;
  readonly regionId: RegionId;
  readonly kind: BillKind;
  readonly utilityName: string;
  readonly utilityNameZh: string;
  readonly tagline: string;
  /** 虚构货币代码（如 "NDK" / "CID"） */
  readonly currency: string;
  readonly accountNumber: string;
  readonly invoiceNumber: string;
  readonly customerName: string;
  readonly addressLines: ReadonlyArray<string>;
  /** "09 Sep 2026" 格式（英文） */
  readonly billDate: string;
  readonly dueDate: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodDays: number;
  readonly meterRows: ReadonlyArray<MeterRow>;
  /** 用量摘要，如 "98 m³ · 90 days" */
  readonly usageSummary: string;
  readonly bars: ReadonlyArray<UsageBar>;
  readonly barUnit: string;
  readonly barTitle: string;
  readonly charges: ReadonlyArray<ChargeLine>;
  readonly subtotal: number;
  readonly taxLabel: string;
  readonly tax: number;
  readonly total: number;
  /** 美式流派模板才有：上期余额 / 已收款 / 本期费用 */
  readonly accountSummary?: AccountSummary;
  readonly barcodePayload: string;
  readonly qrSeed: string;
  readonly notes: ReadonlyArray<string>;
}

export interface RenderOptions {
  readonly watermark: boolean;
}

export interface BillTemplate {
  readonly docType: string;
  readonly regionId: RegionId;
  /** 中文名称，如 "水费账单" */
  readonly label: string;
  readonly kind: BillKind;
  /** 该地区地址字段 schema（表单渲染 + 校验共用） */
  readonly fields: ReadonlyArray<FieldSchema>;
  /** 由确定性 rng 派生全部账单数据；input.billDate 为 null 时取当天 */
  compute(input: BillInput, rng: () => number): BillViewModel;
  /** 返回完全自包含的 HTML 片段（2481×3509，A4@300DPI，CSS 内联） */
  renderHtml(vm: BillViewModel, opts: RenderOptions): string;
}
