// Mely kéréseket tárol a service worker. A kliens is ezt használja a tár előtöltéséhez és kilépéskor a törléséhez.

/** Az API olvasó kéréseinek tára (előbb a hálózat). */
export const API_CACHE = 'derp-api';
/** A bélyegképek tára (előbb a tár). */
export const THUMB_CACHE = 'derp-thumbs';

/**
 * Csak az kerül a telefonra, ami a terepen kell (adattakarékosság: elveszett eszközön ennyi van): munkamenet és
 * modulok, a látható projektek (adatlap, idővonal, kollégák, ügyfél), „Mai kiszállásaim”, a projekt chatje, jegyzetei,
 * felmérései és a dokumentumtár listája. Levelek, auditnapló, felhasználók, cikktörzs, letöltések nem.
 */
const CACHED = [
  /^\/api\/(session|modules|projects)$/,
  /^\/api\/projects\/[^/]+(\/(events|event-types|members))?$/,
  /^\/api\/clients\/[^/]+$/,
  /^\/api\/visits\/mine$/,
  /^\/api\/chat\/(unread|projects\/[^/]+\/(messages|people))$/,
  /^\/api\/notes\/(projects|surveys)\/[^/]+$/,
  /^\/api\/docs\/projects\/[^/]+$/,
];

export const isThumb = (pathname: string): boolean => /^\/api\/docs\/files\/[^/]+\/thumb$/.test(pathname);

export const isCachedApi = (pathname: string): boolean => CACHED.some((re) => re.test(pathname));
