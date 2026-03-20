exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { keyId, keySecret, model, prompt, size, refImage } = payload;
  if (!keyId || !keySecret || !model || !prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const authHeader = `Key ${keyId}:${keySecret}`;
  const BASE = 'https://api.higgsfield.ai';

  let endpoint, body;

  if (model === 'seedream') {
    endpoint = `${BASE}/bytedance/seedream/v4/text-to-image`;
    body = { prompt, resolution: '2K', aspect_ratio: size || '9:16', camera_fixed: false };
    if (refImage) { body.input_image = refImage; body.strength = 0.85; }

  } else if (model === 'soul') {
    endpoint = `${BASE}/v1/text2image/soul`;
    const sizeMap = { '9:16': '1152x2048', '1:1': '1536x1536', '16:9': '2048x1152', '21:9': '2048x878' };
    body = { prompt, quality: '4K', width_and_height: sizeMap[size] || '1152x2048' };
    if (refImage) { body.input_image_url = refImage; body.strength = 0.85; }

  } else if (model === 'flux') {
    endpoint = `${BASE}/flux-pro/kontext/max/text-to-image`;
    body = { prompt, aspect_ratio: size || '9:16', safety_tolerance: 2 };
    if (refImage) { body.image_url = refImage; }

  } else {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown model: ${model}` }) };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({ error: data?.detail || data?.message || `HTTP ${res.status}`, raw: data })
      };
    }

    // If image came back immediately (some models do this)
    const immediateUrl = data?.images?.[0]?.url || data?.result?.url || data?.url;
    if (immediateUrl) {
      return { statusCode: 200, body: JSON.stringify({ done: true, url: immediateUrl, model }) };
    }

    // Return request ID for polling
    const requestId = data?.request_id || data?.id || data?.job_id;
    if (requestId) {
      return { statusCode: 200, body: JSON.stringify({ done: false, requestId, model, raw: data }) };
    }

    return { statusCode: 500, body: JSON.stringify({ error: 'No request ID or image URL returned', raw: data }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
