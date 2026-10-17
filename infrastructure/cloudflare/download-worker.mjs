/** R2 is the data plane; the API only returns authorization metadata and reserves the requested range. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !/^\/download\/[A-Za-z0-9_.-]+$/.test(url.pathname)) return new Response('Not found', { status: 404 });
    const transferId = crypto.randomUUID();
    const headers = new Headers({ 'x-gateway-auth': env.GATEWAY_SHARED_SECRET, 'x-transfer-id': transferId });
    if (request.headers.has('range')) headers.set('range', request.headers.get('range'));
    let auth;
    try {
      auth = await fetch(`${env.API_ORIGIN}${url.pathname}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    } catch { return new Response('Authorization unavailable', { status: 503 }); }
    if (!auth.ok) return new Response(await auth.text(), { status: auth.status, headers: { 'cache-control': 'no-store', ...(auth.headers.has('content-range') ? { 'content-range': auth.headers.get('content-range') } : {}) } });
    const grant = await auth.json();
    let object;
    try {
      object = await env.DATASETS.get(grant.key, { range: { offset: grant.start, length: Number(grant.length) } });
      if (!object || object.size !== grant.size) throw new Error('object unavailable');
    } catch {
      await fetch(`${env.API_ORIGIN}/gateway/transfers/${transferId}/failed`, { method: 'POST', headers: { 'x-gateway-auth': env.GATEWAY_SHARED_SECRET }, signal: AbortSignal.timeout(15_000) }).catch(() => {});
      return new Response('Storage unavailable', { status: 503 });
    }
    const output = new Headers({ 'content-type': 'application/octet-stream', 'content-length': grant.length, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-sha256': grant.sha256, 'x-download-accounting': 'authorized-bytes', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename="${String(grant.name).replace(/["\\\r\n]/g, '_')}"` });
    if (grant.partial) output.set('content-range', `bytes ${grant.start}-${grant.end}/${grant.size}`);
    // Reservation measures authorized bytes, never asserts that the browser completed a transfer.
    return new Response(object.body, { status: grant.partial ? 206 : 200, headers: output });
  },
};
