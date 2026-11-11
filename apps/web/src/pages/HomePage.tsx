import type { Me } from '@repo/contract';

/** Where organization owners land. The product's real pages go here. */
export function HomePage({ me }: { me: Me }) {
  return (
    <main className="page">
      <h1>Welcome, {me.name}</h1>
      {me.orgs.length === 0 ? (
        <p className="muted">You are not part of any organization yet.</p>
      ) : (
        <ul className="list plain">
          {me.orgs.map((org) => (
            <li key={org.id} className="card">
              <strong>{org.name}</strong> <span className="muted">· {org.role}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
