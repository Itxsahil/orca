import { useQuery } from '@tanstack/react-query';
import { orpc } from './orpc';

export function App() {
  const health = useQuery(orpc.health.queryOptions());

  return (
    <main className="page">
      <h1>Video Platform</h1>
      <p className="muted">Vite + React · Express + oRPC · Drizzle + Postgres</p>
      <p>
        API:{' '}
        {health.isPending ? (
          'checking…'
        ) : health.isError ? (
          <span className="bad">offline ({health.error.message})</span>
        ) : (
          <span className={health.data.db ? 'ok' : 'bad'}>
            online, database {health.data.db ? 'connected' : 'unreachable'}
          </span>
        )}
      </p>
    </main>
  );
}
