export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('无法连接服务，请检查服务状态后重试。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && (path.startsWith('/admin') || path === '/auth/password' || path === '/auth/logout')) {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(response.status, data?.error ?? '请求失败，请重试。');
  }
  return data as T;
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
