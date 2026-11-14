/** One external event instance as a source delivers it (Google or iCal), before it's stored. */
export interface Incoming {
  externalId: string;
  title: string;
  location: string | null;
  allDay: boolean;
  startsAt: Temporal.Instant | null;
  endsAt: Temporal.Instant | null;
  startDate: string | null;
  /** Exclusive. */
  endDate: string | null;
  status: "confirmed" | "tentative";
  htmlLink: string | null;
  updatedRemoteAt: Temporal.Instant | null;
}
