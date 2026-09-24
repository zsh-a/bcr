import { useId, useState } from "react";

/** Existing secrets are never rendered into an input; null means retain the saved value. */
export function SecretField({
  label,
  saved,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  saved: boolean;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="bcr-secret-field">
      {saved && value === null ? <span>{label}</span> : <label htmlFor={id}>{label}</label>}
      {saved && value === null ? (
        <div className="bcr-secret-row">
          <span>密钥已配置</span>
          <button
            type="button"
            className="ui-btn ui-btn-default"
            onClick={() => {
              setVisible(false);
              onChange("");
            }}
          >
            替换密钥
          </button>
        </div>
      ) : (
        <div className="bcr-secret-row">
          <input
            id={id}
            className="ui-input"
            aria-label={label}
            type={visible ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={value ?? ""}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="ui-btn ui-btn-default"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? "隐藏" : "显示"}
          </button>
          {saved && (
            <button
              type="button"
              className="ui-btn ui-btn-default"
              onClick={() => {
                setVisible(false);
                onChange(null);
              }}
            >
              保留原密钥
            </button>
          )}
        </div>
      )}
    </div>
  );
}
