// netlify/functions/send-rdv.js
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Le PDF est inclus dans le bundle Netlify via included_files dans netlify.toml
function readPdfBase64() {
  try {
    const pdfPath = path.join(__dirname, '../../presentation-valtis.pdf');
    return fs.readFileSync(pdfPath).toString('base64');
  } catch (err) {
    console.error('PDF introuvable:', err.message);
    return null;
  }
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

  const { prenom, nom, email, societe, date, heure, honeypot } = body;

  // Honeypot anti-bot
  if (honeypot) {
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  }

  // Champs obligatoires
  if (!nom || !email || !date || !heure) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Champs obligatoires manquants.' }) };
  }

  // Validation email
  if (!isValidEmail(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Adresse email invalide.' }) };
  }

  // Limites de longueur
  if (nom.length > 100 || email.length > 200) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Un champ dépasse la taille autorisée.' }) };
  }

  // Échappement HTML
  const sPrenom  = escapeHtml(prenom || '');
  const sNom     = escapeHtml(nom);
  const sEmail   = escapeHtml(email);
  const sSociete = escapeHtml(societe || 'Non renseignée');
  const sDate    = escapeHtml(date);
  const sHeure   = escapeHtml(heure);

  // Prénom ou nom pour la salutation
  const salutation = sPrenom || sNom;

  // Email de confirmation au prospect (avec PDF en pièce jointe si dispo)
  const attachments = [];
  const pdfBase64 = readPdfBase64();
  if (pdfBase64) {
    attachments.push({
      content: pdfBase64,
      name: 'Presentation-Valtis.pdf',
      type: 'application/pdf',
    });
  }

  const confirmationEmail = {
    sender:  { name: 'Valtis', email: 'contact@valtis.tech' },
    to:      [{ email, name: `${sPrenom} ${sNom}`.trim() }],
    subject: `Confirmation de votre RDV Valtis — ${sDate} à ${sHeure}`,
    htmlContent: `
      <p>Bonjour ${salutation},</p>
      <p>Votre rendez-vous avec Valtis est confirmé :</p>
      <ul>
        <li><strong>Date :</strong> ${sDate}</li>
        <li><strong>Heure :</strong> ${sHeure}</li>
        <li><strong>Format :</strong> Google Meet</li>
        <li><strong>Lien :</strong> <a href="https://meet.google.com/ipn-jzsa-iuj">meet.google.com/ipn-jzsa-iuj</a></li>
      </ul>
      ${pdfBase64 ? '<p>Vous trouverez en pièce jointe notre présentation.</p>' : ''}
      <p>À bientôt,<br/>Mevorah Abergel — Valtis<br/>contact@valtis.tech</p>
    `,
    attachment: attachments.length > 0 ? attachments : undefined,
  };

  // Notification interne
  const notifEmail = {
    sender:  { name: 'Valtis RDV', email: 'contact@valtis.tech' },
    to:      [{ email: 'contact@valtis.tech', name: 'Valtis' }],
    subject: `Nouveau RDV — ${sPrenom} ${sNom} (${sSociete}) — ${sDate} ${sHeure}`,
    htmlContent: `
      <p><strong>Prénom :</strong> ${sPrenom || '—'}</p>
      <p><strong>Nom :</strong> ${sNom}</p>
      <p><strong>Email :</strong> ${sEmail}</p>
      <p><strong>Société :</strong> ${sSociete}</p>
      <p><strong>Date :</strong> ${sDate} à ${sHeure}</p>
    `,
  };

  try {
    await Promise.all([
      brevoRequest(confirmationEmail),
      brevoRequest(notifEmail),
    ]);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Erreur Brevo send-rdv:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Une erreur est survenue. Veuillez réessayer ou nous écrire directement à contact@valtis.tech.' }),
    };
  }
};
