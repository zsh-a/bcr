import { forwardRef, useRef, type InputHTMLAttributes, type ReactNode } from "react";

interface ResourceSearchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "size"
> {
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
  inputClassName?: string;
}

/** A full-width search field. The whole field owns focus; clearing preserves scope and focus. */
export const ResourceSearch = forwardRef<HTMLInputElement, ResourceSearchProps>(
  function ResourceSearch(
    {
      value,
      onValueChange,
      clearLabel = "清除搜索",
      className = "",
      inputClassName = "",
      onKeyDown,
      ...props
    },
    ref,
  ) {
    const input = useRef<HTMLInputElement | null>(null);
    return (
      <div className={`ui-resource-search ${className}`.trim()}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 5 5" />
        </svg>
        <input
          {...props}
          ref={(element) => {
            input.current = element;
            if (typeof ref === "function") ref(element);
            else if (ref) ref.current = element;
          }}
          className={inputClassName}
          type="search"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              !props.readOnly &&
              !event.nativeEvent.isComposing &&
              event.key === "Escape" &&
              value
            ) {
              event.preventDefault();
              event.stopPropagation();
              onValueChange("");
            }
          }}
        />
        {value && (
          <button
            type="button"
            aria-label={clearLabel}
            title={clearLabel}
            disabled={props.disabled || props.readOnly}
            onClick={() => {
              onValueChange("");
              input.current?.focus();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);

/** Quiet view selectors share arrow-key navigation across resource lists and context panels. */
export function ResourceViews<T extends string>({
  label,
  views,
  value,
  onValueChange,
  className = "",
}: {
  label: string;
  views: readonly { id: T; label: string; count?: number }[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`ui-resource-views ${className}`.trim()} role="group" aria-label={label}>
      {views.map((view, index) => (
        <button
          key={view.id}
          type="button"
          aria-pressed={value === view.id}
          tabIndex={value === view.id ? 0 : -1}
          onClick={() => onValueChange(view.id)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? views.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + views.length) % views.length;
            onValueChange(views[next]!.id);
            event.currentTarget.parentElement
              ?.querySelectorAll<HTMLButtonElement>("button")
              [next]?.focus();
          }}
        >
          {view.label}
          {view.count !== undefined && <span>{view.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function ResourceHeader({
  title,
  actions,
  className = "",
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ui-resource-header ${className}`.trim()}>
      <div className="ui-resource-heading">{title}</div>
      {actions && <div className="ui-resource-actions">{actions}</div>}
    </div>
  );
}
