import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { errorMessage } from '@/errors';
import { orpc } from '@/orpc';

export const Route = createFileRoute('/_app/_org/api-keys')({ component: ApiKeysPage });

function ApiKeysPage() {
  const { org } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.apiTokens.key() });

  const tokens = useQuery(orpc.apiTokens.list.queryOptions({ input: { orgId: org.id } }));
  const create = useMutation(
    orpc.apiTokens.create.mutationOptions({
      onSuccess: (res) => {
        setCreated({ name: res.name, token: res.token });
        setName('');
        void refresh();
      },
    }),
  );
  const revoke = useMutation(
    orpc.apiTokens.revoke.mutationOptions({ onSuccess: () => void refresh() }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate({ orgId: org.id, name });
  };
  const error = tokens.error ?? create.error ?? revoke.error;
  const apiBase = tokens.data?.apiBase ?? '';
  const accountId = tokens.data?.accountId ?? org.id;

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8 md:px-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The API is compatible with Cloudflare Stream: existing Stream code works after changing
          the three values below.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Switching from Cloudflare Stream</CardTitle>
          <CardDescription>Replace these in your Stream configuration.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="API base" was="https://api.cloudflare.com/client/v4" value={apiBase} />
          <Field label="Account ID" was="your Cloudflare account ID" value={accountId} />
          <Field
            label="API token"
            was="your Cloudflare API token"
            value="a key created below"
            plain
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a key</CardTitle>
          <CardDescription>
            Keys can upload, list, edit and delete this organization's videos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit}>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                required
                maxLength={100}
                placeholder="e.g. Production server"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              Create key
            </Button>
          </form>
          {created && (
            <div className="grid gap-2 rounded-lg border p-3">
              <p className="text-sm">
                <span className="font-medium">{created.name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · copy this key now. It is shown only once.
                </span>
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.token}
                  aria-label="New API key"
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <CopyButton value={created.token} />
                <Button variant="ghost" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {tokens.data && tokens.data.tokens.length > 0 && (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-0 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="pl-4 font-medium">{t.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {t.prefix}…
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t.lastUsedAt ? formatDate(t.lastUsedAt) : 'Never'}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => {
                        if (
                          confirm(`Revoke "${t.name}"? Apps using it stop working immediately.`)
                        ) {
                          revoke.mutate({ orgId: org.id, id: t.id });
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </main>
  );
}

function Field({
  label,
  was,
  value,
  plain,
}: {
  label: string;
  was: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[8rem_1fr] sm:items-center">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid gap-1">
        {plain ? (
          <p className="text-sm">{value}</p>
        ) : (
          <div className="flex gap-2">
            <Input readOnly value={value} aria-label={label} className="font-mono text-xs" />
            <CopyButton value={value} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Instead of {was}</p>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
