import { Select, useNavigation } from "@bcr/react";

export function StrategyPicker({
  value,
  disabled,
}: {
  value: "portfolio" | "trend";
  disabled: boolean;
}) {
  const navigation = useNavigation();
  return (
    <Select
      aria-label="研究类型"
      className="research-strategy-picker"
      value={value}
      disabled={disabled}
      onChange={(event) =>
        navigation.navigate(event.target.value === "trend" ? "/quant?strategy=trend" : "/quant")
      }
    >
      <option value="portfolio">股票组合</option>
      <option value="trend">永续趋势</option>
    </Select>
  );
}
