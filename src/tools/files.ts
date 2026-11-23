import { constants } from 'node:fs';
import { open, opendir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { ToolsConfig } from '@council/config/schema.js';
import { failure, success, type Result } from '@council/core/result.js';
import { tool, type Tool } from 'ai';
import { z } from 'zod';

const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 100;
const MAX_HITS = 50;
const MAX_LINE_CHARS = 300;
const MAX_WALK_ENTRIES = 2_000;
const unavailable = failure('E_PATH_UNAVAILABLE', 'Path is unavailable');
const pathSchema = z.string().min(1).max(4096);
const lineNumber = z.int().min(1);

type DirectoryEntry = { name: string; kind: 'directory' | 'file' };
type SearchHit = { path: string; line: number; text: string };
type FileTools = {
  read_file: Tool<
    { path: string; startLine?: number; endLine?: number },
    Result<string>
  >;
  list_dir: Tool<
    { path: string },
    Result<{ entries: DirectoryEntry[]; capped: boolean }>
  >;
  search_files: Tool<
    { path: string; query: string },
    Result<{ hits: SearchHit[]; capped: boolean }>
  >;
};

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
}

// Compile a deny glob (single star, double star, question mark). Unlike
// path.matchesGlob, wildcards match dot segments, so the env-file pattern also
// denies an env file inside a dot-directory. A trailing slash-double-star denies
// the directory itself as well as its contents. Matching ignores case on every
// platform and crosses line breaks in names: a deny rule should over-match.
function compileGlob(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? '';
    if (char === '*' && glob[index + 1] === '*') {
      while (glob[index + 1] === '*') index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        // Repeated double-star segments mean the same as one.
        while (glob.startsWith('**/', index + 1)) index += 3;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[\\^$.|+()[\]{}]/u, '\\$&');
    }
  }
  source = source.replace(/\/\.\*$/u, '(?:/.*)?');
  return new RegExp(`^${source}$`, 'isu');
}

const toPosix = (path: string) =>
  sep === '/' ? path : path.replaceAll(sep, '/');

export function createFileTools(config: ToolsConfig['files']): FileTools {
  // Pin roots to their canonical paths. A missing or inaccessible root grants nothing.
  const roots = Promise.all(
    config.roots.map(async (root) => {
      const path = resolve(root);
      try {
        const canonical = await realpath(path);
        return (await stat(canonical)).isDirectory()
          ? [{ path, canonical }]
          : [];
      } catch {
        return [];
      }
    }),
  ).then((resolved) => resolved.flat());

  const denyPatterns = config.deny.map(compileGlob);

  function denied(path: string, root: string): boolean {
    for (let current = path; ; current = dirname(current)) {
      const candidates = inside(root, current)
        ? [current, relative(root, current)]
        : [current];
      if (
        denyPatterns.some((pattern) =>
          candidates.some((candidate) => pattern.test(toPosix(candidate))),
        )
      )
        return true;
      if (dirname(current) === current) return false;
    }
  }

  async function allowed(path: string): Promise<string | undefined> {
    const configured = await roots;
    const candidates = configured.flatMap(({ path: root, canonical }) =>
      [root, canonical]
        .filter((base) => inside(base, path))
        .map((base) => ({ base, canonical })),
    );
    if (
      candidates.length === 0 ||
      candidates.some(({ base }) => denied(path, base))
    )
      return;
    try {
      const canonical = await realpath(path);
      if (
        candidates.some((root) => inside(root.canonical, canonical)) &&
        !configured.some(
          (root) =>
            inside(root.canonical, canonical) &&
            denied(canonical, root.canonical),
        )
      ) {
        return canonical;
      }
    } catch {
      // Missing, denied and inaccessible paths share the same response.
    }
    return undefined;
  }

  /**
   * A model rarely knows the absolute root, so a relative path is tried under
   * each root in order. The policy check in `allowed` still decides access.
   */
  async function locate(path: string): Promise<string> {
    if (isAbsolute(path)) return resolve(path);
    for (const { path: root } of await roots) {
      const candidate = resolve(root, path);
      if ((await allowed(candidate)) !== undefined) return candidate;
    }
    return resolve(path);
  }

  async function readText(path: string) {
    const canonical = await allowed(path);
    if (canonical === undefined) return unavailable;
    try {
      const expected = await stat(canonical);
      if (!expected.isFile()) return unavailable;
      const file = await open(
        canonical,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const opened = await file.stat();
        if (
          !opened.isFile() ||
          opened.dev !== expected.dev ||
          opened.ino !== expected.ino ||
          (await allowed(path)) !== canonical
        )
          return unavailable;
        const current = await stat(canonical);
        if (opened.dev !== current.dev || opened.ino !== current.ino)
          return unavailable;
        if (opened.size > MAX_BYTES)
          return failure('E_FILE_TOO_LARGE', `File exceeds ${MAX_BYTES} bytes`);
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(
            buffer,
            offset,
            buffer.length - offset,
            offset,
          );
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > MAX_BYTES)
          return failure('E_FILE_TOO_LARGE', `File exceeds ${MAX_BYTES} bytes`);
        const bytes = buffer.subarray(0, offset);
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (/(?![\t\r\n])\p{Cc}/u.test(text))
          return failure('E_BINARY_FILE', 'File is not plain UTF-8 text');
        return success(text);
      } catch (error) {
        if (error instanceof TypeError)
          return failure('E_BINARY_FILE', 'File is not plain UTF-8 text');
        return unavailable;
      } finally {
        await file.close();
      }
    } catch {
      return unavailable;
    }
  }

  async function* entries(
    path: string,
    canonical: string,
    budget: { remaining: number },
    signal?: AbortSignal,
  ) {
    const directory = await opendir(canonical);
    for await (const entry of directory) {
      if (signal?.aborted || budget.remaining === 0) break;
      budget.remaining -= 1;
      const child = join(path, entry.name);
      const resolved = await allowed(child);
      if (resolved === undefined) continue;
      const info = await stat(resolved).catch(() => undefined);
      if (info?.isFile())
        yield {
          path: child,
          resolved,
          name: entry.name,
          kind: 'file' as const,
        };
      else if (info?.isDirectory())
        yield {
          path: child,
          resolved,
          name: entry.name,
          kind: 'directory' as const,
        };
    }
  }

  return {
    read_file: tool({
      description:
        'Read a UTF-8 text file under a configured root (up to 64 KiB). Give a path relative to the root, or an absolute path. Line numbers are one-based and inclusive.',
      inputSchema: z.strictObject({
        path: pathSchema,
        startLine: lineNumber.optional(),
        endLine: lineNumber.optional(),
      }),
      execute: async ({ path, startLine = 1, endLine }) => {
        if (endLine !== undefined && endLine < startLine)
          return failure(
            'E_INVALID_INPUT',
            'endLine must be at least startLine',
          );
        const result = await readText(await locate(path));
        if (!result.ok || (startLine === 1 && endLine === undefined))
          return result;
        return success(
          result.value
            .split(/\r\n?|\n/u)
            .slice(startLine - 1, endLine)
            .join('\n'),
        );
      },
    }),
    list_dir: tool({
      description:
        'List up to 100 files and directories visible inside a configured root. Use "." for the root itself, or a path relative to it.',
      inputSchema: z.strictObject({ path: pathSchema }),
      execute: async ({ path }, { abortSignal }) => {
        const absolute = await locate(path);
        const canonical = await allowed(absolute);
        if (canonical === undefined) return unavailable;
        const out: DirectoryEntry[] = [];
        const budget = { remaining: MAX_WALK_ENTRIES };
        try {
          for await (const { name, kind } of entries(
            absolute,
            canonical,
            budget,
            abortSignal,
          )) {
            if (out.length === MAX_ENTRIES)
              return success({ entries: out, capped: true });
            out.push({ name, kind });
          }
          return success({ entries: out, capped: budget.remaining === 0 });
        } catch {
          return unavailable;
        }
      },
    }),
    search_files: tool({
      description:
        'Search text files under a directory for a literal, case-sensitive substring. Use "." for the root, or a path relative to it.',
      inputSchema: z.strictObject({
        path: pathSchema,
        query: z.string().min(1).max(MAX_LINE_CHARS),
      }),
      execute: async ({ path, query }, { abortSignal }) => {
        const absolute = await locate(path);
        const canonical = await allowed(absolute);
        if (canonical === undefined) return unavailable;
        const hits: SearchHit[] = [];
        const visited = new Set([canonical]);
        const dirs = [{ path: absolute, resolved: canonical }];
        const budget = { remaining: MAX_WALK_ENTRIES };
        for (const dir of dirs) {
          if (abortSignal?.aborted || budget.remaining === 0) break;
          try {
            for await (const child of entries(
              dir.path,
              dir.resolved,
              budget,
              abortSignal,
            )) {
              if (child.kind === 'directory') {
                if (!visited.has(child.resolved)) {
                  visited.add(child.resolved);
                  dirs.push(child);
                }
                continue;
              }
              const result = await readText(child.path);
              if (!result.ok) continue;
              const lines = result.value.split(/\r\n?|\n/u);
              for (const [index, line] of lines.entries()) {
                const match = line.indexOf(query);
                if (match === -1) continue;
                const start = Math.max(
                  0,
                  match - Math.floor((MAX_LINE_CHARS - query.length) / 2),
                );
                hits.push({
                  path: child.path,
                  line: index + 1,
                  text: line.slice(start, start + MAX_LINE_CHARS),
                });
                if (hits.length === MAX_HITS)
                  return success({ hits, capped: true });
              }
            }
          } catch {
            if (dir.path === absolute) return unavailable;
          }
        }
        return success({ hits, capped: budget.remaining === 0 });
      },
    }),
  };
}
