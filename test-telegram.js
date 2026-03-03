const https = require('https');

const BOT_TOKEN = '7980341773:AAHPMc2OlwfU3V1dDnvYxdK73rwo_VywtRA';
const CHAT_ID = '8168528646';

function sendTestMessage() {
  const data = JSON.stringify({
    chat_id: CHAT_ID,
    text: '🔧 Test message from monitoring system',
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let response = '';
    res.on('data', chunk => response += chunk);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', response);
      
      if (res.statusCode === 200) {
        console.log('✅ Telegram working!');
      } else {
        console.log('❌ Failed:', JSON.parse(response).description);
      }
    });
  });

  req.on('error', (err) => console.error('Error:', err.message));
  req.write(data);
  req.end();
}

sendTestMessage();