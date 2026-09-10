/**
 * @bcr/docgen-core — 纯端侧虚构公用事业账单生成器（纯逻辑入口）。
 * 本入口不引用任何 DOM API，可在 node 环境直接跑测试；
 * DOM 栅格化 / 实拍合成请从 "@bcr/docgen-core/dom" 导入。
 */

export type {
  AccountSummary,
  BillInput,
  BillKind,
  BillTemplate,
  BillViewModel,
  ChargeLine,
  ChargeSection,
  FieldSchema,
  GasConversion,
  MeterRow,
  RegionId,
  RenderOptions,
  SettlementBlock,
  SettlementInstallment,
  TextFieldSchema,
  UsageBar,
} from "./model";

export { fnv1a, djb2, mulberry32 } from "./hash";

export {
  ADDRESS_BOOKS,
  listAddresses,
  randomAddress,
  type AddressBook,
} from "./address";

export { REGIONS, TEMPLATES, getTemplate, listTemplates, rngForInput, type RegionDef } from "./registry";

export { validateBillInput, type ValidationResult } from "./validate";

export {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  addDaysIso,
  formatDateEn,
  formatInt,
  formatMoney,
  formatMoneyDe,
  formatMoneyLocale,
  formatNumDe,
  isoToday,
} from "./templates/common";

export { encodeCode128B, code128BValues, code128Svg, CODE128_PATTERNS } from "./barcode";

export { pseudoQrMatrix, pseudoQrSvg, PSEUDO_QR_SIZE } from "./pseudoqr";
