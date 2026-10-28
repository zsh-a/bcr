import { createEconomicRepository } from "./repository";

/** Static project resources and local calculations only. No fetch, browser storage or side effects. */
export const bundledEconomicRepository = createEconomicRepository();
