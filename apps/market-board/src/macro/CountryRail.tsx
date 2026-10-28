import { useDeferredValue, useMemo, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import { Input } from "@bcr/react";
import type { MacroCountry } from "@bcr/market-data/macro";
import { SERIES_TOKENS } from "./state";

const recommended = [
  "CHN",
  "USA",
  "JPN",
  "DEU",
  "GBR",
  "IND",
  "BRA",
  "KOR",
  "FRA",
  "CAN",
  "AUS",
  "RUS",
  "MEX",
  "IDN",
];
export function CountryRail({
  countries,
  selected,
  onChange,
  maxSelected = 6,
}: {
  countries: MacroCountry[];
  selected: string[];
  onChange: (ids: string[]) => void;
  maxSelected?: number;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLocaleLowerCase());
  const visible = useMemo(
    () =>
      countries
        .filter((country) =>
          `${country.name} ${country.englishName} ${country.id} ${country.iso2}`
            .toLocaleLowerCase()
            .includes(deferred),
        )
        .sort((a, b) => {
          const rank = (id: string) =>
            selected.includes(id)
              ? selected.indexOf(id) - 100
              : recommended.includes(id)
                ? recommended.indexOf(id)
                : 100;
          return rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, "zh-CN");
        }),
    [countries, selected, deferred],
  );
  return (
    <section className="macro-country-rail" aria-label="选择比较经济体">
      <div className="macro-rail-heading">
        <span>比较经济体</span>
        <span className="macro-count">
          {selected.length} / {maxSelected}
        </span>
      </div>
      <label className="macro-search">
        <Search size={15} />
        <Input
          aria-label="搜索国家或经济体"
          placeholder="国家、地区或代码"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="macro-country-list">
        {visible.map((country) => {
          const index = selected.indexOf(country.id),
            checked = index !== -1;
          return (
            <button
              type="button"
              key={country.id}
              className="macro-country-row"
              aria-pressed={checked}
              disabled={checked ? selected.length === 1 : selected.length === maxSelected}
              onClick={() =>
                onChange(
                  checked ? selected.filter((id) => id !== country.id) : [...selected, country.id],
                )
              }
            >
              <span
                className="macro-country-code"
                style={
                  checked
                    ? {
                        color: `var(${SERIES_TOKENS[index]})`,
                        borderColor: `var(${SERIES_TOKENS[index]})`,
                      }
                    : undefined
                }
              >
                {country.iso2}
              </span>
              <span>
                <strong>{country.name}</strong>
                <small>{country.id}</small>
              </span>
              {checked ? (
                <Check size={15} style={{ color: `var(${SERIES_TOKENS[index]})` }} />
              ) : (
                <Plus size={14} />
              )}
            </button>
          );
        })}
        {!visible.length && <p className="macro-empty">没有匹配的经济体。</p>}
      </div>
      <footer>
        <span>{countries.length} 个国家与经济体</span>
        <span>最多同时比较 {maxSelected} 个</span>
      </footer>
    </section>
  );
}
