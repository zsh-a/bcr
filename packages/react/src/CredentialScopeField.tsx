import { useId } from "react";
import type { CredentialScope } from "@bcr/agent";

/** Shared, explicit consent UI. This does not itself read or write credentials. */
export function CredentialScopeField({
  value,
  onChange,
  label = "凭据保存范围",
  disabled = false,
}: {
  value: CredentialScope;
  onChange: (value: CredentialScope) => void;
  label?: string;
  disabled?: boolean;
}) {
  const hint = useId();
  return (
    <div className="bcr-credential-scope">
      <label>
        {label}
        <select
          aria-label={label}
          aria-describedby={hint}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as CredentialScope)}
        >
          <option value="memory">仅本页</option>
          <option value="session">当前标签页</option>
          <option value="device">记住此设备</option>
        </select>
      </label>
      <p id={hint}>
        {disabled
          ? "未填写密钥，无需保存凭据。"
          : value === "device"
            ? "仅在可信个人设备上选择。凭据将明文保存在此浏览器，非加密保险箱，同源脚本可以读取；不会加入业务导出或同步。"
            : value === "session"
              ? "保存在当前标签页；刷新可恢复，浏览器恢复标签页时也可能保留。"
              : "凭据仅在本页内存中使用，不写入浏览器存储。"}
      </p>
    </div>
  );
}
