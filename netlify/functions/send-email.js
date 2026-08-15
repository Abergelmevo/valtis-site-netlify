// netlify/functions/send-email.js
const https = require('https');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function brevoRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.brevo.com',
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY,
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true });
        } else {
          reject(new Error(`Brevo error ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Méthode non autorisée.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide.' }) };
  }

  const { nom, email, telephone, taille_infra, message, honeypot } = body;

  // Honeypot anti-bot : doit être vide
  if (honeypot) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // Champs obligatoires
  if (!nom || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nom et email sont obligatoires.' }) };
  }

  // Validation email
  if (!isValidEmail(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Adresse email invalide.' }) };
  }

  // Limites de longueur
  if (nom.length > 100 || email.length > 200 || (message && message.length > 2000)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Un champ dépasse la taille autorisée.' }) };
  }

  // Échappement HTML
  const sNom          = escapeHtml(nom);
  const sEmail        = escapeHtml(email);
  const sTelephone    = escapeHtml(telephone || 'Non renseigné');
  const sTailleInfra  = escapeHtml(taille_infra || 'Non renseignée');
  const sMessage      = escapeHtml(message || '').replace(/\n/g, '<br/>');

  const emailPayload = {
    sender:  { name: 'Valtis Contact', email: 'contact@valtis.tech' },
    to:      [{ email: 'contact@valtis.tech', name: 'Valtis' }],
    replyTo: { email, name: nom },
    subject: `Nouveau message — ${sNom}`,
    htmlContent: `
      <p><strong>Nom :</strong> ${sNom}</p>
      <p><strong>Email :</strong> ${sEmail}</p>
      <p><strong>Téléphone :</strong> ${sTelephone}</p>
      <p><strong>Taille du parc :</strong> ${sTailleInfra}</p>
      <p><strong>Message :</strong></p>
      <p>${sMessage || '<em>Aucun message saisi</em>'}</p>
    `,
  };

  try {
    await brevoRequest(emailPayload);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erreur Brevo send-email:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Une erreur est survenue. Veuillez réessayer ou nous écrire directement à contact@valtis.tech.' }),
    };
  }
};
