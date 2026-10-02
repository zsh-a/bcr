import { useId, useRef, type ReactNode } from "react";

export function ResearchTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  children,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <>
      <div className="research-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`${id}-${tab.value}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab.value === value}
            tabIndex={tab.value === value ? 0 : -1}
            ref={(element) => {
              refs.current[index] = element;
            }}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              onChange(tabs[next]!.value);
              refs.current[next]?.focus();
            }}
          >
            {tab.label}
            {tab.count !== undefined && <small>{tab.count.toLocaleString()}</small>}
          </button>
        ))}
      </div>
      <section
        className="research-tab-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${value}`}
        tabIndex={0}
      >
        {children}
      </section>
    </>
  );
}
