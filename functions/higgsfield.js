exports.handler = async function(event, context) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { keyId, keySecret, model, prompt, size, refImage } = payload;

  if (!keyId || !keySecret || !model || !prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: keyId, keySecret, model, prompt' }) };
  }

  const authHeader = `Key ${keyId}:${keySecret}`;
  const BASE = 'https://api.higgsfield.ai';

  // Build endpoint + body per model
  let endpoint, body;

  if (model === 'seedream') {
    endpoint = `${BASE}/bytedance/seedream/v4/text-to-image`;
    body = { prompt, resolution: '2K', aspect_ratio: size || '9:16', camera_fixed: false };
    if (refImage) { body.input_image = refImage; body.strength = 0.85; }

  } else if (model === 'soul') {
    endpoint = `${BASE}/v1/text2image/soul`;
    const sizeMap = {
      '9:16': '1152x2048', '1:1': '1536x1536',
      '16:9': '2048x1152', '21:9': '2048x878'
    };
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
    // Submit generation request
    const submitRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      return {
        statusCode: submitRes.status,
        body: JSON.stringify({ error: submitData?.detail || submitData?.message || `HTTP ${submitRes.status}`, raw: submitData })
      };
    }

    // Check if image came back immediately
    const immediateUrl = submitData?.images?.[0]?.url || submitData?.result?.url || submitData?.url;
    if (immediateUrl) {
      return { statusCode: 200, body: JSON.stringify({ url: immediateUrl, model }) };
    }

    // Poll for completion
    const requestId = submitData?.request_id || submitData?.id || submitData?.job_id;
    if (!requestId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'No request ID returned', raw: submitData })
      };
    }

    // Poll up to 60 times × 3 seconds = 3 minutes max
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));

      const statusRes = await fetch(`${BASE}/requests/${requestId}/status`, {
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
      });

      if (!statusRes.ok) continue;

      const statusData = await statusRes.json();
      const status = statusData?.status?.toLowerCase() || '';

      if (status === 'failed' || status === 'cancelled' || status === 'nsfw') {
        return { statusCode: 500, body: JSON.stringify({ error: `Generation ${status}`, raw: statusData }) };
      }

      const imgUrl = statusData?.images?.[0]?.url
        || statusData?.result?.url
        || statusData?.jobs?.[0]?.results?.raw?.url;

      if (imgUrl || status === 'completed') {
        if (imgUrl) {
          return { statusCode: 200, body: JSON.stringify({ url: imgUrl, model, requestId }) };
        }
      }
    }

    return { statusCode: 504, body: JSON.stringify({ error: 'Timed out waiting for image after 3 minutes' }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
