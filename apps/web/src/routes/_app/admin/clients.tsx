import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { Client } from '@repo/contract';
import { BanControl } from '@/components/ban-control';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errorMessage } from '@/errors';
import { orpc } from '@/orpc';

export const Route = createFileRoute('/_app/admin/clients')({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(orpc.admin.users.list.queryOptions()),
  component: ClientsPage,
});

/** Every client (organization owners), with ban / unban. */
function ClientsPage() {
  const queryClient = useQueryClient();
  const clients = useQuery(orpc.admin.users.list.queryOptions());
  // Banning a user also changes what the organizations page shows.
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
  const ban = useMutation(orpc.admin.users.ban.mutationOptions({ onSuccess: refresh }));
  const unban = useMutation(orpc.admin.users.unban.mutationOptions({ onSuccess: refresh }));
  const error = ban.error ?? unban.error ?? clients.error;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Clients</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everyone with an account, except you. Banning logs them out everywhere and blocks login.
      </p>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <div className="mt-6 grid gap-3">
        {clients.data?.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No clients yet. Invite one from Organizations.
            </CardContent>
          </Card>
        )}
        {clients.data?.map((client) => (
          <ClientCard
            key={client.id}
            client={client}
            pending={ban.isPending || unban.isPending}
            onBan={(reason) => ban.mutate({ userId: client.id, reason: reason || undefined })}
            onUnban={() => unban.mutate({ userId: client.id })}
          />
        ))}
      </div>
    </main>
  );
}

function ClientCard({
  client,
  pending,
  onBan,
  onUnban,
}: {
  client: Client;
  pending: boolean;
  onBan: (reason: string) => void;
  onUnban: () => void;
}) {
  const banned = !!client.bannedAt;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <CardTitle className="flex items-center gap-2">
            <span className="truncate">{client.name}</span>
            {banned && <Badge variant="destructive">Banned</Badge>}
          </CardTitle>
          <CardDescription className="truncate">{client.email}</CardDescription>
        </div>
        <BanControl banned={banned} pending={pending} onBan={onBan} onUnban={onUnban} />
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <p>
          {client.orgs.length === 0
            ? 'No organization'
            : client.orgs.map((o) => (
                <span key={o.id} className="mr-3 inline-flex items-center gap-1.5">
                  {o.name} <span className="text-muted-foreground">· {o.role}</span>
                  {o.bannedAt && (
                    <Badge variant="outline" className="text-destructive">
                      org banned
                    </Badge>
                  )}
                </span>
              ))}
        </p>
        {banned && (
          <p className="text-muted-foreground">
            Banned {client.bannedAt!.toLocaleDateString()}
            {client.banReason ? ` · ${client.banReason}` : ''}
          </p>
        )}
        <p className="text-muted-foreground">Joined {client.createdAt.toLocaleDateString()}</p>
      </CardContent>
    </Card>
  );
}
