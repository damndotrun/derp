import { Link } from 'react-router';
import { ApiError } from './api.ts';
import { t } from './i18n.ts';

/** Hibaüzenet egy betöltési hibához: 403-ra „Nincs jogosultság”, 404-re a „nem található” szöveg. */
export function LoadError({
  error,
  notFound,
  forbidden = t('common.forbidden'),
  back,
}: {
  error: Error;
  notFound: string;
  forbidden?: string;
  back: { to: string; label: string };
}) {
  const status = error instanceof ApiError ? error.status : 0;
  const text = status === 403 ? forbidden : status === 404 ? notFound : error.message;
  return (
    <div className="flex flex-col gap-2">
      <p role={status === 403 ? 'alert' : undefined} className={status === 403 || status === 404 ? '' : 'text-destructive'}>
        {text}
      </p>
      <Link to={back.to} className="text-sm underline">
        {back.label}
      </Link>
    </div>
  );
}
