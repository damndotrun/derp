// Chat-üzenet küldése csatolmányokkal. Az offline sor (8.) is ezt használja: előbb `prepareMessage` (kliens oldali
// azonosítók és időbélyeg, kicsinyített képek; az eredmény IndexedDB-be tehető), majd `sendMessage` (újrajátszva sem
// duplikál). Az offline sor elemfajtája: `chat.message` (`web/index.ts`).
import { ApiError } from '@/core/api.ts';
import type { DocsFile } from '../../docs/shared.ts';
import { docsApi } from '../../docs/web/api.ts';
import { newId, prepareUpload, sendUpload, type PreparedUpload } from '../../docs/web/upload.ts';
import { CHAT_FOLDER, type ChatMessage } from '../shared.ts';
import { chatApi } from './api.ts';

export interface PreparedMessage {
  id: string;
  projectId: string;
  body: string;
  /** A csatolmányok a dokumentumtárba; a mappát és a szülő-eseményt a küldés tölti ki. */
  attachments: PreparedUpload[];
  /** Kliens oldali időbélyeg (ISO): offline írt üzenetnél a terepi időpont (a csatolmányoké is ez). */
  capturedAt?: string;
}

export async function prepareMessage(projectId: string, body: string, files: File[] = []): Promise<PreparedMessage> {
  const capturedAt = new Date().toISOString();
  return {
    id: newId(),
    projectId,
    body: body.trim(),
    attachments: await Promise.all(files.map((f) => prepareUpload(projectId, f, { capturedAt }))),
    capturedAt,
  };
}

/** A projekt dokumentumtárának „Chat” mappája (a gyökérben); ha nincs, létrehozza. */
export async function chatFolderId(projectId: string): Promise<string> {
  const find = async () => (await docsApi.project(projectId)).folders.find((f) => f.parentId === null && f.name.toLowerCase() === CHAT_FOLDER.toLowerCase());
  const existing = await find();
  if (existing) return existing.id;
  try {
    return (await docsApi.createFolder(projectId, { name: CHAT_FOLDER })).id;
  } catch (err) {
    // Közben más hozta létre.
    if (err instanceof ApiError && err.status === 409) {
      const created = await find();
      if (created) return created.id;
    }
    throw err;
  }
}

export interface SendProgress {
  message?: ChatMessage;
  uploaded: number;
}

/**
 * Elküldi az üzenetet (idempotens `PUT`), majd a csatolmányokat a dokumentumtár „Chat” mappájába, az üzenet
 * eseménye alá (`parentEventId`). Megszakadás után ugyanazzal a `PreparedMessage`-dzsel újra hívható: a már elküldött
 * üzenet és a már feltöltött fájlok nem duplikálódnak.
 */
export async function sendMessage(m: PreparedMessage, onProgress?: (p: SendProgress) => void): Promise<{ message: ChatMessage; files: DocsFile[] }> {
  const message = await chatApi.send(m.projectId, m.id, {
    body: m.body,
    attachments: m.attachments.map((a) => ({ id: a.id, name: a.name })),
    capturedAt: m.capturedAt,
  });
  onProgress?.({ message, uploaded: 0 });
  const files: DocsFile[] = [];
  if (m.attachments.length > 0) {
    const folderId = await chatFolderId(m.projectId);
    for (const a of m.attachments) {
      files.push(await sendUpload({ ...a, folderId, parentEventId: message.eventId, capturedAt: m.capturedAt ?? a.capturedAt }));
      onProgress?.({ message, uploaded: files.length });
    }
  }
  return { message, files };
}
