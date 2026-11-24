import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CouncilSettingsSchema,
  MEMBER_HANDLE,
} from '@council/config/schema.js';
import type { Store, StoredState } from '@council/core/ports.js';
import { failure, success, type Result } from '@council/core/result.js';
import { SLACK_TIMESTAMP } from '@council/core/slack-timestamp.js';
import { MAX_PRIVATE_NOTE_CHARS } from '@council/core/types.js';
import { z } from 'zod';

export const MAX_ACCEPTED_MESSAGES = 4_096;

const id = z.string().min(1);
const StoredStateSchema = z.strictObject({
  councils: z.array(
    z.strictObject({
      id,
      scope: z.strictObject({ channel: id, threadTs: id.optional() }),
      // Legacy councils lack a start time, so keep their prior history window.
      convenedAtTs: z.string().regex(SLACK_TIMESTAMP).optional(),
      owner: id,
      roster: z.array(z.string().regex(MEMBER_HANDLE)).min(1),
      settings: CouncilSettingsSchema,
    }),
  ),
  acceptedMessageKeys: z.array(id).max(MAX_ACCEPTED_MESSAGES),
  privateNotes: z
    .array(
      z.strictObject({
        councilId: id,
        memberId: z.string().regex(MEMBER_HANDLE),
        targetTs: id,
        note: id.max(MAX_PRIVATE_NOTE_CHARS),
        createdAtTs: id,
      }),
    )
    .default([]),
});

function decode(content: string): Result<StoredState> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return failure('E_INVALID_STATE', 'Council state is not valid JSON');
  }
  const parsed = StoredStateSchema.safeParse(raw);
  return parsed.success
    ? success(parsed.data)
    : failure('E_INVALID_STATE', 'Council state has an invalid structure');
}

export function createJsonStore(stateDir: string): Store {
  const directory = resolve(stateDir);
  const path = join(directory, 'councils.json');
  return {
    async load() {
      try {
        return decode(await readFile(path, 'utf8'));
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return success({
            councils: [],
            acceptedMessageKeys: [],
            privateNotes: [],
          });
        }
        return failure('E_STORE_READ', 'Could not read council state');
      }
    },

    async save(state) {
      const temporary = join(directory, `.councils-${randomUUID()}.tmp`);
      let ownsTemporary = false;
      try {
        await mkdir(directory, { recursive: true });
        const file = await open(temporary, 'wx', 0o600);
        ownsTemporary = true;
        try {
          await file.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
        ownsTemporary = false;
        return success(undefined);
      } catch {
        return failure('E_STORE_WRITE', 'Could not write council state');
      } finally {
        if (ownsTemporary)
          await rm(temporary, { force: true }).catch(() => undefined);
      }
    },
  };
}
