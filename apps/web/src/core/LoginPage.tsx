import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from './api.ts';
import { t, translate } from './i18n.ts';
import { sessionKey, useSession } from './session.ts';

export function LoginPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  // A Google-belépés hibája (`/login?error=<kód>`, a szerver visszairányításából).
  const [params] = useSearchParams();
  const errorKey = params.get('error') ? `auth.error.${params.get('error')}` : null;
  const googleError = errorKey && translate(errorKey) !== errorKey ? translate(errorKey) : null;
  const login = useMutation({
    mutationFn: api.devLogin,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      navigate('/projects', { replace: true });
    },
  });

  if (session.isPending) return <p className="p-6">{t('common.loading')}</p>;
  if (session.data?.user) return <Navigate to="/projects" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(email);
  };

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">
            {t('app.name')} · {t('auth.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {googleError && (
            <p role="alert" className="text-sm text-destructive">
              {googleError}
            </p>
          )}
          {session.data?.googleLogin && (
            // Teljes oldalbetöltés: a szerver a Google-re irányít, onnan vissza a /api/auth/google/callback-re.
            <a href="/api/auth/google" className={buttonVariants()}>
              {t('auth.google')}
            </a>
          )}
          {session.data?.devLogin && (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              {login.error && (
                <p role="alert" className="text-sm text-destructive">
                  {login.error.message}
                </p>
              )}
              <Button type="submit" variant={session.data.googleLogin ? 'outline' : 'default'} disabled={login.isPending}>
                {t('auth.devLogin')}
              </Button>
            </form>
          )}
          {!session.data?.googleLogin && !session.data?.devLogin && (
            <p className="text-sm text-muted-foreground">{t('auth.unavailable')}</p>
          )}
          <a href="/adatvedelem" className="text-sm text-muted-foreground underline">
            {t('privacy.link')}
          </a>
        </CardContent>
      </Card>
    </main>
  );
}
