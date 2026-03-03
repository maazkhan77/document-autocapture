import type { StudioController } from '../useStudioController';

interface EventLogPanelProps {
  studio: StudioController;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function EventLogPanel({ studio }: EventLogPanelProps) {
  return (
    <article className="panel event-panel">
      <div className="panel-title-row">
        <h2>Runtime Event Log</h2>
        <button type="button" className="btn btn-soft" onClick={() => studio.setEvents([])}>
          Clear
        </button>
      </div>
      <ul className="event-list">
        {studio.events.length === 0 ? <li className="event-item">No events yet.</li> : null}
        {studio.events.map((event) => (
          <li key={event.id} className={`event-item ${event.level}`}>
            <span>{formatTs(event.ts)}</span>
            <span>{event.message}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
