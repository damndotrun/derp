import type { Role } from '@derp/shared';

/** Feltöltés és mappa létrehozása: minden szerepkör (a terepes a hozzá rendelt projektekben). */
export const UPLOAD_ROLES: Role[] = ['admin', 'iroda', 'terepes'];
/** Bármely fájl törlése, átnevezése, áthelyezése, mappák átnevezése és törlése; más csak a saját feltöltését kezelheti. */
export const MANAGE_ROLES: Role[] = ['admin', 'iroda'];
