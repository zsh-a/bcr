/**
 * DocGen 数据模型：schema 驱动的公用事业账单。
 * 地区与货币为真实国家/地区（澳/加/港/新/英/德）；机构、单号与用量金额均为虚构，仅用于版式学习演示。
 */

export type RegionId = "australia" | "canada" | "hongkong" | "singapore" | "uk" | "germany";

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

/** 燃气账单的换算块：Verbrauch m³ × Brennwert × Zustandszahl = kWh */
export interface GasConversion {
  readonly cubicMeters: number;
  readonly brennwert: number;
  readonly zustandszahl: number;
  readonly kwh: number;
}

/**
 * 德国暖气费分摊表（Heizkostenabrechnung）一行：
 * Gesamtkosten / Gesamteinheiten / Preis je Einheit / Ihre Einheiten / Ihre Kosten，
 * 全部为 compute 预格式化的 de-DE 字符串，renderHtml 直接平铺。
 */
export interface AllocationRow {
  readonly label: string;
  /** Gesamtkosten in EUR（如 "10.352,87"），汇总行可留空 */
  readonly totalCost: string;
  /** Gesamteinheiten（如 "674,000 Nutzfläche"） */
  readonly totalUnits: string;
  /** Preis je Einheit（如 "4,608101"） */
  readonly pricePerUnit: string;
  /** Ihre Einheiten（如 "55,000 m²"） */
  readonly ownUnits: string;
  /** Ihre Kosten in EUR（如 "185,01"），减去行以 "−" 前缀 */
  readonly ownCost: string;
  /** 加粗行（分组标题 / 小计行） */
  readonly emphasis?: boolean;
}

/** 分区计价（新加坡三合一单 / 英国 dual fuel 单）：一个 section 内的明细行与小计 */
export interface ChargeSection {
  readonly title: string;
  /** 副标题，如表号 "MPAN 12 3456 7890 123" / 资费名 */
  readonly subtitle?: string;
  readonly lines: ReadonlyArray<ChargeLine>;
  readonly sectionTotal: number;
}

/** 渲染所需的全部派生数据（renderHtml 不再做任何计算） */
export interface BillViewModel {
  readonly docType: string;
  readonly regionId: RegionId;
  readonly kind: BillKind;
  readonly utilityName: string;
  readonly utilityNameZh: string;
  readonly tagline: string;
  /** 真实货币代码（如 "AUD" / "GBP" / "EUR"） */
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
  /** 账户摘要流派模板才有：上期余额 / 已收款 / 本期费用 */
  readonly accountSummary?: AccountSummary;
  /** 燃气年度结算才有：m³ × Brennwert × Zustandszahl = kWh 换算因子 */
  readonly conversion?: GasConversion;
  /** 德国暖气费分摊结算单才有：Gesamtkosten → Ihre Kosten 的多列分摊表 */
  readonly allocation?: ReadonlyArray<AllocationRow>;
  /** 分区计价模板才有（新加坡三合一 / 英国 dual fuel）：各 section 明细与 sectionTotal */
  readonly sections?: ReadonlyArray<ChargeSection>;
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
