import { useMemo } from "react";
import { bundledEconomicRepository, createEconomicRepository } from "@bcr/market-data/economy";
import { bundledMacroSnapshot } from "@bcr/market-data/macro";
import { useMacroData } from "../macro/useMacroData";

/** Reuse the same optional annual cache as the specialised view; never fetch on entry. */
export function useEconomicRepository(countries: string[]) {
  const { snapshot: annual } = useMacroData(countries);
  return useMemo(
    () =>
      annual === bundledMacroSnapshot
        ? bundledEconomicRepository
        : createEconomicRepository({ annual }),
    [annual],
  );
}
