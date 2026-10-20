import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// A modulregiszter (mint az alkalmazásban): a modulok offline sorbeli elemfajtái így be vannak jegyezve.
import './core/modules.ts';
import { outbox } from './core/outbox.ts';

afterEach(() => cleanup());

// A felületi tesztekben bejelentkezett felhasználó (az alkalmazásban a `Layout` állítja), hogy a modulok űrlapjai az
// offline soron át küldhessenek.
outbox.setUser('00000000-0000-4000-8000-000000000001');
