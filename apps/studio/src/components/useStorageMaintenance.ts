import type {
  ArtifactCleanupPlan,
  ArtifactCleanupResult,
  CachePrunePlan,
  CachePruneResult,
  TaskJournalPrunePlan,
  TaskJournalPruneResult,
} from "@bcr/core";
import { Effect } from "effect";
import { useCallback, useState } from "react";
import { CACHE_RETENTION, JOURNAL_RETENTION } from "../storage-policy";
import { useServices } from "../services";
import { studio } from "../store";
import { formatBytes } from "./ui";

export type CleanupState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly plan: ArtifactCleanupPlan }
  | { readonly status: "running"; readonly plan: ArtifactCleanupPlan }
  | { readonly status: "done"; readonly result: ArtifactCleanupResult }
  | { readonly status: "error"; readonly message: string };

interface MaintenancePlan {
  readonly cache: CachePrunePlan;
  readonly journal: TaskJournalPrunePlan;
}

interface MaintenanceResult {
  readonly cache: CachePruneResult;
  readonly journal: TaskJournalPruneResult;
}

export type MaintenanceState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly plan: MaintenancePlan }
  | { readonly status: "running"; readonly plan: MaintenancePlan }
  | { readonly status: "done"; readonly result: MaintenanceResult }
  | { readonly status: "error"; readonly message: string };

export interface StorageMaintenanceController {
  readonly cleanup: CleanupState;
  readonly maintenance: MaintenanceState;
  readonly startCleanup: () => void;
  readonly confirmCleanup: () => void;
  readonly closeCleanup: () => void;
  readonly startMaintenance: () => void;
  readonly confirmMaintenance: () => void;
  readonly closeMaintenance: () => void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useStorageMaintenance(): StorageMaintenanceController {
  const services = useServices();
  const [cleanup, setCleanup] = useState<CleanupState>({ status: "idle" });
  const [maintenance, setMaintenance] = useState<MaintenanceState>({ status: "idle" });

  const startCleanup = useCallback(() => {
    setCleanup({ status: "loading" });
    const protectedIds = studio.getSnapshot().files.map(({ ref }) => ref.id);
    void Effect.runPromise(services.artifacts.planCleanup({ protectedIds })).then(
      (plan) => {
        studio.log(
          "info",
          `cleanup · scanned ${plan.scannedObjects} artifact(s) · ${plan.candidates.length} candidate(s)`,
        );
        setCleanup({ status: "ready", plan });
      },
      (reason: unknown) => setCleanup({ status: "error", message: errorMessage(reason) }),
    );
  }, [services]);

  const confirmCleanup = useCallback(() => {
    if (cleanup.status !== "ready") return;
    const plan = cleanup.plan;
    setCleanup({ status: "running", plan });
    const protectedIds = studio.getSnapshot().files.map(({ ref }) => ref.id);
    void Effect.runPromise(services.artifacts.reclaim(plan, { protectedIds })).then(
      (result) => {
        studio.log(
          "ok",
          `cleanup · reclaimed ${formatBytes(result.reclaimedBytes)} · ${result.deleted.length} artifact(s)`,
        );
        if (result.skipped.length > 0) {
          studio.log(
            "warn",
            `cleanup · skipped ${result.skipped.length} stale or protected item(s)`,
          );
        }
        setCleanup({ status: "done", result });
      },
      (reason: unknown) => setCleanup({ status: "error", message: errorMessage(reason) }),
    );
  }, [cleanup, services]);

  const startMaintenance = useCallback(() => {
    setMaintenance({ status: "loading" });
    void Promise.all([
      Effect.runPromise(services.scheduler.planCachePrune(CACHE_RETENTION)),
      Effect.runPromise(services.scheduler.planJournalPrune(JOURNAL_RETENTION)),
    ]).then(
      ([cache, journal]) => {
        studio.log(
          "info",
          `maintenance · scanned ${cache.scannedEntries} cache + ${journal.scannedEntries} history · ${cache.candidates.length + journal.candidates.length} candidate(s)`,
        );
        setMaintenance({ status: "ready", plan: { cache, journal } });
      },
      (reason: unknown) => setMaintenance({ status: "error", message: errorMessage(reason) }),
    );
  }, [services]);

  const confirmMaintenance = useCallback(() => {
    if (maintenance.status !== "ready") return;
    const plan = maintenance.plan;
    setMaintenance({ status: "running", plan });
    void Promise.all([
      Effect.runPromise(services.scheduler.reclaimCache(plan.cache)),
      Effect.runPromise(services.scheduler.reclaimJournal(plan.journal)),
    ]).then(
      ([cache, journal]) => {
        studio.log(
          "ok",
          `maintenance · removed ${cache.removed.length} cache + ${journal.removed.length} history item(s)`,
        );
        if (cache.skipped.length + journal.skipped.length > 0) {
          studio.log(
            "warn",
            `maintenance · skipped ${cache.skipped.length + journal.skipped.length} changed or protected item(s)`,
          );
        }
        setMaintenance({ status: "done", result: { cache, journal } });
      },
      (reason: unknown) => setMaintenance({ status: "error", message: errorMessage(reason) }),
    );
  }, [maintenance, services]);

  return {
    cleanup,
    maintenance,
    startCleanup,
    confirmCleanup,
    closeCleanup: () => setCleanup({ status: "idle" }),
    startMaintenance,
    confirmMaintenance,
    closeMaintenance: () => setMaintenance({ status: "idle" }),
  };
}
