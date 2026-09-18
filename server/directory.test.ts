import { beforeEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import { readDirectory } from './directory.js';

vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof fs>(), stat: vi.fn(), readdir: vi.fn(), writeFile: vi.fn(), rm: vi.fn(),
}));
const denied = () => Object.assign(new Error('denied'), { code: 'EACCES' });
beforeEach(() => {
  vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof fs.stat>>);
  vi.mocked(fs.readdir).mockResolvedValue([]);
  vi.mocked(fs.writeFile).mockResolvedValue();
  vi.mocked(fs.rm).mockResolvedValue();
});

it('maps actual filesystem permission errors to a readable 403', async () => {
  vi.mocked(fs.stat).mockRejectedValue(denied());
  await expect(readDirectory(resolve('private'))).rejects.toMatchObject({ status: 403, message: '没有读取此目录的权限。' });
});
it('reports a readable directory that cannot be written, and cleans up its probe when it can', async () => {
  expect(await readDirectory(resolve('mods'))).toMatchObject({ writable: true });
  expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('.server-mods-write-check-'), { force: true });
  vi.mocked(fs.writeFile).mockRejectedValue(denied());
  expect(await readDirectory(resolve('mods'))).toMatchObject({ entries: [], writable: false });
});
