import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocationSearch } from "@bcr/react";
import type { DayEvent, ResearchOrder } from "@bcr/quant-core";
import { dateText } from "./model";
import type { SelectedRun } from "./session";
import { queryChartEvents } from "./result-reader";

interface Focus {
  date: string;
  code?: string;
  order?: ResearchOrder;
}
interface Inspection {
  focus: Focus;
  open: boolean;
  events: DayEvent[];
  loading: boolean;
  error: string;
  linked: boolean;
  inspect: (focus: Focus) => void;
  selectDate: (date: string) => void;
  close: () => void;
}
const InspectionContext = createContext<Inspection | null>(null);
export function useInspection() {
  const value = useContext(InspectionContext);
  if (!value) throw new Error("ResearchInspection is required");
  return value;
}
export function ResearchInspection({
  selected,
  children,
}: {
  selected: SelectedRun;
  children: ReactNode;
}) {
  const requestedDate = new URLSearchParams(useLocationSearch()).get("date");
  const [focus, setFocus] = useState<Focus>({ date: dateText(selected.run.endDate) });
  const [open, setOpen] = useState(false);
  const [linked, setLinked] = useState(false);
  const [events, setEvents] = useState<DayEvent[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (
      requestedDate &&
      selected.dataset.manifest.calendar.some((d) => dateText(d.date) === requestedDate)
    ) {
      setFocus({ date: requestedDate });
      setLinked(true);
    }
  }, [requestedDate, selected.dataset]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    void queryChartEvents(
      selected.result,
      dateText(selected.run.startDate),
      dateText(selected.run.endDate),
      abort.signal,
    )
      .then((value) => {
        if (!abort.signal.aborted) {
          setEvents(value);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [selected]);
  const inspect = useCallback((next: Focus) => {
    setFocus(next);
    setOpen(true);
    setLinked(true);
  }, []);
  const selectDate = useCallback((date: string) => {
    setFocus((value) => ({ date, ...(value.code ? { code: value.code } : {}) }));
    setLinked(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ focus, open, events, loading, error, linked, inspect, selectDate, close }),
    [focus, open, events, loading, error, linked, inspect, selectDate, close],
  );
  return <InspectionContext.Provider value={value}>{children}</InspectionContext.Provider>;
}
