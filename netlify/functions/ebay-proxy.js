exports.handler = async function(event, context) {

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body);

    // ── PHOTO UPLOAD MODE ──────────────────────────────────────────
    // Fetches a Drive thumbnail server-side (no CORS) and uploads to imgBB
    if (body.action === 'upload_photo') {
      const { driveUrl, imgbbKey } = body;

      // Fetch the image from Drive on the server side
      const imgResp = await fetch(driveUrl);
      if (!imgResp.ok) {
        return {
          statusCode: 200,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, error: 'Failed to fetch Drive image: ' + imgResp.status })
        };
      }

      // Convert to base64
      const arrayBuffer = await imgResp.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      // Upload to imgBB
      const formData = new URLSearchParams();
      formData.append('key', imgbbKey);
      formData.append('image', base64);

      const imgbbResp = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });
      const imgbbData = await imgbbResp.json();

      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: imgbbData.success,
          url: imgbbData.success ? imgbbData.data.url : null,
          error: imgbbData.success ? null : JSON.stringify(imgbbData.error)
        })
      };
    }

    // ── EBAY API MODE ──────────────────────────────────────────────
    const xml = body.xml;
    const callName = body.callName || 'AddItem';

    if (!xml) {
      return {
        statusCode: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No XML provided' })
      };
    }

    const response = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '1155',
        'X-EBAY-API-CALL-NAME': callName,
        'X-EBAY-API-SITEID': '0'
      },
      body: xml
    });

    const responseText = await response.text();

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/xml' },
      body: responseText
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
