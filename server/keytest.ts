/**
 * «Does this key work?»: one tiny request to the provider with the key from the vault, and the
 * answer in a word. The key never leaves this machine except to its own provider, and is never
 * returned or logged.
 */
import { isProvider, PROVIDERS, type TextProvider } from '../src/sim/settings';
import { getSecret } from './vault';

export interface KeyTest {
  ok: boolean;
  /** works · busy (valid, but rate-limited right now) · nokey · key · credits · down · other */
  result: 'works' | 'busy' | 'nokey' | 'key' | 'credits' | 'down' | 'other';
  detail: string;
}

export async function testKey(provider: unknown): Promise<KeyTest> {
  if (!isProvider(provider) || !PROVIDERS[provider].key) return { ok: false, result: 'other', detail: 'Ese proveedor no usa clave.' };
  const key = getSecret(PROVIDERS[provider].key!);
  if (!key) return { ok: false, result: 'nokey', detail: 'No hay ninguna clave guardada.' };
  try {
    const res = await request(provider, key);
    const text = (await res.text()).slice(0, 400);
    if (res.ok) return { ok: true, result: 'works', detail: 'La clave funciona.' };
    if (res.status === 401 || res.status === 403) return { ok: false, result: 'key', detail: 'El proveedor no acepta esta clave: revisa que esté copiada entera.' };
    if (res.status === 402 || /insufficient_quota|credit balance|billing|payment required/i.test(text)) {
      return { ok: false, result: 'credits', detail: 'La clave es buena, pero la cuenta no tiene saldo.' };
    }
    if (res.status === 429) return { ok: true, result: 'busy', detail: 'La clave funciona; ahora mismo el proveedor pide esperar un poco.' };
    if (res.status >= 500) return { ok: false, result: 'down', detail: 'El proveedor no responde bien ahora mismo; prueba en un rato.' };
    return { ok: false, result: 'other', detail: `El proveedor respondió ${res.status}.` };
  } catch {
    return { ok: false, result: 'down', detail: 'No se pudo contactar con el proveedor (¿sin conexión?).' };
  }
}

/** The cheapest call each provider has that needs a valid key. */
function request(provider: TextProvider, key: string): Promise<Response> {
  const signal = AbortSignal.timeout(15_000);
  if (provider === 'anthropic') {
    return fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal });
  }
  if (provider === 'groq') return fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${key}` }, signal });
  // NVIDIA lists its models without a key: a one-token answer from a small model checks it.
  return fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
    signal,
  });
}
