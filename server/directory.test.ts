import { expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import { readDirectory } from './directory.js';

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>(), stat: vi.fn() }));
it('maps actual filesystem permission errors to a readable 403', async () => {
  vi.mocked(fs.stat).mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
  await expect(readDirectory(resolve('private'))).rejects.toMatchObject({ status: 403, message: '没有读取此目录的权限。' });
});
