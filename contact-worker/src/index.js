// Worker « belfort-contact » : reçoit le formulaire de contact de belfort-systems.fr.
//
//   POST /contact   (JSON ou formulaire classique)  →  { ok: true } | { ok: false, error: "…" }
//   GET  /          →  { ok: true, service: "belfort-contact" }  (contrôle de vie)
//
// Chaîne de traitement :
//   1. CORS : seules les origines du site (belfort-systems.fr, www, aperçus *.belfort-systems-fr.pages.dev) ;
//   2. pot-de-miel « website » : rempli = robot, on répond ok sans rien faire ;
//   3. limitation : LIMITE_PAR_HEURE envois par heure et par IP (KV, binding RATE) ;
//   4. Turnstile, seulement si le secret TURNSTILE_SECRET est posé ;
//   5. validation des champs ;
//   6. enregistrement en D1 (table contacts) ;
//   7. e-mail à MAIL_A via le binding Email Workers MAIL ; s'il manque ou échoue, on répond
//      quand même ok (la demande est en base) et on le note dans les journaux.
//
// Pas de délai minimal entre l'affichage et l'envoi : il produisait de faux positifs
// (formulaire pré-rempli par le simulateur, visiteurs rapides). Aucune dépendance.

import { EmailMessage } from "cloudflare:email";

const ORIGINE_OK = /^https:\/\/(www\.)?belfort-systems\.fr$|^https:\/\/([a-z0-9-]+\.)?belfort-systems-fr\.pages\.dev$/i;
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LONGUEURS = { nom: 120, email: 200, tel: 30, sujet: 80, formule: 200, message: 4000, creneau: 80 };

export default {
  async fetch(req, env, ctx) {
    const origine = req.headers.get("Origin") || "";
    const cors = enTetesCors(origine);
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/contact")) {
      return json({ ok: true, service: "belfort-contact" }, 200, cors);
    }
    if (url.pathname !== "/contact") return json({ ok: false, error: "Introuvable." }, 404, cors);
    if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée." }, 405, cors);

    // Un navigateur envoie toujours Origin sur un POST inter-origines : on exige qu'il soit connu.
    if (origine && !ORIGINE_OK.test(origine)) return json({ ok: false, error: "Origine non autorisée." }, 403, cors);

    let champs;
    try { champs = await lireChamps(req); }
    catch { return json({ ok: false, error: "Corps de requête illisible." }, 400, cors); }
    const formulaireClassique = !/application\/json/i.test(req.headers.get("Content-Type") || "");

    // 2. Pot-de-miel : un humain ne voit pas ce champ.
    if (champs.website) return repondre({ ok: true }, 200, cors, formulaireClassique);

    // 3. Limitation de débit par IP.
    const ip = req.headers.get("CF-Connecting-IP") || "inconnue";
    const limite = parseInt(env.LIMITE_PAR_HEURE || "10", 10) || 10;
    if (await tropDeRequetes(env.RATE, ip, limite)) {
      return repondre({ ok: false, error: "Trop de messages envoyés depuis votre connexion. Réessayez dans une heure, ou appelez-moi." }, 429, cors, formulaireClassique);
    }

    // 4. Turnstile (facultatif).
    if (env.TURNSTILE_SECRET) {
      const jeton = champs["cf-turnstile-response"] || champs.turnstile || "";
      if (!(await verifierTurnstile(env.TURNSTILE_SECRET, jeton, ip))) {
        return repondre({ ok: false, error: "La vérification anti-robot a échoué. Rechargez la page et réessayez." }, 400, cors, formulaireClassique);
      }
    }

    // 5. Validation.
    const d = nettoyer(champs);
    const erreur = valider(d);
    if (erreur) return repondre({ ok: false, error: erreur }, 400, cors, formulaireClassique);

    // 6. Enregistrement en D1.
    let id = null;
    try {
      const r = await env.DB.prepare(
        "INSERT INTO contacts (nom, email, tel, sujet, formule, message, creneau, origine, ip, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id"
      ).bind(d.nom, d.email, d.tel || null, d.sujet || null, d.formule || null, d.message, d.creneau || null,
        origine || null, ip, (req.headers.get("User-Agent") || "").slice(0, 300)).first();
      id = r && r.id;
    } catch (e) {
      console.error("D1 : enregistrement impossible", e && e.message);
      return repondre({ ok: false, error: "Le service est momentanément indisponible. Réessayez dans quelques minutes." }, 503, cors, formulaireClassique);
    }

    // 7. E-mail (ne bloque pas la réponse si le binding manque ou si l'envoi échoue).
    if (env.MAIL && typeof env.MAIL.send === "function") {
      ctx.waitUntil(envoyerMail(env, d, id).catch((e) => console.error("E-mail non envoyé (demande #" + id + " bien enregistrée)", e && e.message)));
    } else {
      console.warn("Binding send_email « MAIL » absent : demande #" + id + " enregistrée sans e-mail.");
    }

    return repondre({ ok: true, id }, 200, cors, formulaireClassique);
  },
};

// --- CORS -------------------------------------------------------------------------------------
function enTetesCors(origine) {
  const h = { "Vary": "Origin", "Cache-Control": "no-store" };
  if (origine && ORIGINE_OK.test(origine)) {
    h["Access-Control-Allow-Origin"] = origine;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Accept";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

// --- Lecture, nettoyage, validation ---------------------------------------------------------
async function lireChamps(req) {
  const type = req.headers.get("Content-Type") || "";
  if (/application\/json/i.test(type)) {
    const o = await req.json();
    return o && typeof o === "object" ? o : {};
  }
  const fd = await req.formData();
  const o = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

function nettoyer(champs) {
  const d = {};
  for (const [k, max] of Object.entries(LONGUEURS)) {
    const v = champs[k];
    d[k] = (typeof v === "string" ? v : "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
  }
  return d;
}

function valider(d) {
  if (!d.nom) return "Indiquez votre nom.";
  if (!d.email || !EMAIL_OK.test(d.email)) return "Indiquez une adresse e-mail valide.";
  if (!d.message || d.message.length < 10) return "Écrivez un message d'au moins quelques mots.";
  if (d.tel && !/^[+0-9 ().-]{6,30}$/.test(d.tel)) return "Le numéro de téléphone semble incorrect.";
  if (d.creneau && !/^[\p{L}\p{N} :,'./h-]{3,80}$/u.test(d.creneau)) return "Le créneau demandé semble incorrect.";
  return null;
}

// --- Limitation de débit (KV) ---------------------------------------------------------------
async function tropDeRequetes(kv, ip, limite) {
  if (!kv) return false; // sans KV, pas de limitation (mieux vaut recevoir que bloquer)
  const heure = Math.floor(Date.now() / 3600000);
  const cle = "contact:" + ip + ":" + heure;
  try {
    const n = parseInt((await kv.get(cle)) || "0", 10) || 0;
    if (n >= limite) return true;
    await kv.put(cle, String(n + 1), { expirationTtl: 3600 });
  } catch (e) {
    console.error("KV indisponible, limitation ignorée", e && e.message);
  }
  return false;
}

// --- Turnstile --------------------------------------------------------------------------------
async function verifierTurnstile(secret, jeton, ip) {
  if (!jeton) return false;
  try {
    const fd = new FormData();
    fd.append("secret", secret);
    fd.append("response", jeton);
    if (ip && ip !== "inconnue") fd.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
    const j = await r.json();
    return Boolean(j && j.success);
  } catch (e) {
    console.error("Turnstile injoignable", e && e.message);
    return false;
  }
}

// --- E-mail (Email Workers) -------------------------------------------------------------------
async function envoyerMail(env, d, id) {
  const de = env.MAIL_DE || "contact@belfort-systems.fr";
  const a = env.MAIL_A || "damien@belfort-systems.fr";
  const sujet = "[Site] " + (d.sujet || "Contact") + " — " + d.nom;
  const lignes = [
    "Nouvelle demande depuis belfort-systems.fr (n° " + id + ")",
    "",
    "Nom : " + d.nom,
    "E-mail : " + d.email,
    d.tel ? "Téléphone : " + d.tel : null,
    d.sujet ? "Sujet : " + d.sujet : null,
    d.formule ? "Formule envisagée : " + d.formule : null,
    d.creneau ? "Créneau souhaité : " + d.creneau : null,
    "",
    "Message :",
    d.message,
    "",
    "— Répondre directement à ce mail répond au visiteur (Reply-To).",
  ].filter((l) => l !== null);
  const brut = mime({ de, a, replyTo: d.email, sujet, texte: lignes.join("\n") });
  await env.MAIL.send(new EmailMessage(de, a, brut));
}

// Construit un message MIME minimal (texte brut UTF-8, base64) sans dépendance.
function mime({ de, a, replyTo, sujet, texte }) {
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  const enc = (s) => "=?UTF-8?B?" + b64(s) + "?=";
  const corps = b64(texte).replace(/(.{76})/g, "$1\r\n");
  const id = "<" + crypto.randomUUID() + "@belfort-systems.fr>";
  return [
    "From: " + enc("Site belfort-systems.fr") + " <" + de + ">",
    "To: <" + a + ">",
    "Reply-To: <" + replyTo.replace(/[\r\n<>]/g, "") + ">",
    "Subject: " + enc(sujet),
    "Message-ID: " + id,
    "Date: " + new Date().toUTCString(),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    corps,
  ].join("\r\n");
}

// --- Réponses ---------------------------------------------------------------------------------
function json(obj, statut, enTetes) {
  return new Response(JSON.stringify(obj), { status: statut, headers: { "Content-Type": "application/json; charset=utf-8", ...enTetes } });
}

// Formulaire envoyé sans JavaScript : on renvoie le visiteur sur le site avec le résultat.
function repondre(obj, statut, enTetes, classique) {
  if (!classique) return json(obj, statut, enTetes);
  const u = new URL("https://belfort-systems.fr/");
  u.searchParams.set("contact", obj.ok ? "ok" : "erreur");
  if (!obj.ok && obj.error) u.searchParams.set("motif", obj.error);
  u.hash = "contact";
  return new Response(null, { status: 303, headers: { Location: u.toString(), ...enTetes } });
}
