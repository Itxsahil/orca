import type { Me } from '@repo/contract';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Where organization owners land. The product's real pages go here. */
export function HomePage({ me }: { me: Me }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome, {me.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Your organizations.</p>

      {me.orgs.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            You are not part of any organization yet.
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 grid gap-3">
          {me.orgs.map((org) => (
            <Card key={org.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{org.name}</CardTitle>
                <Badge variant="secondary" className="capitalize">
                  {org.role}
                </Badge>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
