import { useCallback, useState } from 'react';
import { appendLog } from './helpers';
import type { EventItem } from './types';

export function useEventLog() {
  const [events, setEvents] = useState<EventItem[]>([]);

  const logEvent = useCallback(
    (level: EventItem['level'], message: string) => {
      appendLog(setEvents, level, message);
    },
    [setEvents],
  );

  return {
    events,
    setEvents,
    logEvent,
  };
}
