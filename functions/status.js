exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { keyId, keySecret, requestId, model } = payload;
  if (!keyId || !keySecret || !requestId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing keyId, keySecret, or requestId' }) };
  }

  const authHeader = `Key ${keyId}:${keySecret}`;
  const BASE = 'https://cloud.higgsfield.ai';

  try {
    const res = await fetch(`${BASE}/requests/${requestId}/status`, {
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: `Status check failed: HTTP ${res.status}` }) };
    }

    const data = await res.json();
    const status = data?.status?.toLowerCase() || '';

    if (status === 'failed' || status === 'cancelled' || status === 'nsfw') {
      return { statusCode: 200, body: JSON.stringify({ done: true, error: `Generation ${status}`, model }) };
    }

    const imgUrl = data?.images?.[0]?.url
      || data?.result?.url
      || data?.jobs?.[0]?.results?.raw?.url;

    if (imgUrl || status === 'completed') {
      if (imgUrl) {
        return { statusCode: 200, body: JSON.stringify({ done: true, url: imgUrl, model }) };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ done: false, status, model, raw: data }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
