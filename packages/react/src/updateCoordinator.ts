export interface UpdateParticipant {
  blocked(): string | null;
  save(): Promise<void>;
}

/** Domains own persistence; the shell only coordinates the reload boundary. */
export function createUpdateCoordinator() {
  const participants = new Set<UpdateParticipant>();
  let pending: Promise<void> | null = null;
  const blocked = () => {
    for (const participant of participants) {
      const reason = participant.blocked();
      if (reason) return reason;
    }
    return null;
  };
  return {
    register(participant: UpdateParticipant) {
      participants.add(participant);
      return () => {
        participants.delete(participant);
      };
    },
    blocked,
    apply(activate: () => void) {
      if (pending) return pending;
      pending = Promise.resolve()
        .then(async () => {
          const reason = blocked();
          if (reason) throw new Error(reason);
          for (const participant of participants) await participant.save();
          const changed = blocked();
          if (changed) throw new Error(changed);
          activate();
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
