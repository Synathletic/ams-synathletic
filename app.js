// AMS Syn'Athlétic : étape 4
// Connexion, consentement, accueil, bien-être du matin, saisie de séance (RPE), historique
// et saisie hors connexion (file d'attente locale envoyée au retour du réseau).
// Signé Syn'Athlétic / Alexandre GERBER
"use strict";

const cfg = window.AMS_CONFIG;
const racine = document.getElementById("app");
const zoneMessage = document.getElementById("message");
const boutonDeconnexion = document.getElementById("btn-menu-deconnexion");

// Client Supabase : la session est conservée dans le navigateur
let sb = null;
try {
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
} catch (e) {
  racine.textContent = "Impossible de charger l'application. Vérifie ta connexion internet puis recharge la page.";
}

/* ---------- Petits utilitaires ---------- */

// Création d'un élément DOM sans innerHTML (protège contre l'injection de code)
function el(tag, attrs = {}, enfants = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const e of [].concat(enfants)) n.append(e instanceof Node ? e : document.createTextNode(e));
  return n;
}

let minuteurMessage = null;
function afficherMessage(texte, type = "info") {
  zoneMessage.textContent = texte;
  zoneMessage.className = "message " + type;
  clearTimeout(minuteurMessage);
  minuteurMessage = setTimeout(() => zoneMessage.classList.add("cache"), 6000);
}

// Traduit les erreurs techniques en messages clairs pour l'utilisateur
function messageErreur(err) {
  const m = (err && err.message ? err.message : "").toLowerCase();
  if (!navigator.onLine || m.includes("failed to fetch") || m.includes("network"))
    return "Pas de connexion internet. Réessaie dès que le réseau revient.";
  if (m.includes("invalid login")) return "Email ou mot de passe incorrect.";
  if (m.includes("email not confirmed")) return "Confirme d'abord ton email (regarde ta boîte de réception et les spams).";
  if (m.includes("already registered")) return "Un compte existe déjà avec cet email. Utilise l'onglet Connexion.";
  if (m.includes("password")) return "Mot de passe trop court : 8 caractères minimum.";
  if (m.includes("rate limit")) return "Trop de tentatives. Patiente quelques minutes.";
  return "Une erreur est survenue. Réessaie, et préviens Syn'Athlétic si elle persiste.";
}

function emailValide(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

/* ---------- Saisie hors connexion : file d'attente locale ---------- */
// Si le réseau manque, la saisie est gardée sur le téléphone puis envoyée automatiquement.
const CLE_FILE = "ams_file_attente_v1";
const CLE_ECHECS = "ams_echecs_v1";
const CLE_PROFIL = "ams_profil_cache_v1";

function lire(cle, defaut) {
  try { const v = JSON.parse(localStorage.getItem(cle)); return v === null || v === undefined ? defaut : v; } catch (e) { return defaut; }
}
function ecrire(cle, v) {
  try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch (e) { return false; }
}
function erreurReseau(err) {
  const m = (err && err.message ? err.message : "").toLowerCase();
  return !navigator.onLine || m.includes("fetch") || m.includes("network") || m.includes("load failed");
}
function nouvelId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const o = crypto.getRandomValues(new Uint8Array(16));
  o[6] = (o[6] & 0x0f) | 0x40; o[8] = (o[8] & 0x3f) | 0x80;
  const h = [...o].map((b) => b.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}
function nbEnAttente(userId) { return lire(CLE_FILE, []).filter((x) => x.valeur.athlete_id === userId).length; }

// Envoi d'une ligne. Séances : insertion avec identifiant fixé par le téléphone, donc un renvoi ne crée pas de doublon.
async function envoyerLigne(table, valeur, onConflict) {
  const { error } = onConflict === "id"
    ? await sb.from(table).insert(valeur)
    : await sb.from(table).upsert(valeur, { onConflict });
  if (error && error.code !== "23505") throw error; // 23505 = déjà enregistrée : c'est bon
}

// Enregistre en ligne, sinon met en file d'attente. Renvoie "envoye" ou "en_attente".
async function enregistrer(table, valeur, onConflict) {
  try {
    await envoyerLigne(table, valeur, onConflict);
    return "envoye";
  } catch (err) {
    if (!erreurReseau(err)) throw err;
    const cles = onConflict.split(",");
    // Une saisie plus récente du même jour remplace la précédente en attente
    const file = lire(CLE_FILE, []).filter((x) => !(x.table === table && cles.every((c) => x.valeur[c] === valeur[c])));
    file.push({ qid: nouvelId(), table, valeur, onConflict });
    if (!ecrire(CLE_FILE, file)) throw new Error("Mémoire du téléphone pleine : libère de la place.");
    return "en_attente";
  }
}

let synchroEnCours = false;
async function synchroniser() {
  if (!sb || synchroEnCours || !navigator.onLine || !lire(CLE_FILE, []).length) return;
  synchroEnCours = true;
  let envoyes = 0, refuses = 0;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const traites = new Set();
    for (const it of lire(CLE_FILE, [])) {
      if (it.valeur.athlete_id !== session.user.id) continue;
      try {
        await envoyerLigne(it.table, it.valeur, it.onConflict);
        traites.add(it.qid); envoyes++;
      } catch (err) {
        if (erreurReseau(err)) break; // le réseau a de nouveau coupé : on réessaiera
        traites.add(it.qid); refuses++;
        const echecs = lire(CLE_ECHECS, []);
        echecs.push({ ...it, motif: String(err.message || "").slice(0, 120) });
        ecrire(CLE_ECHECS, echecs);
      }
    }
    // On relit la file : une saisie ajoutée pendant l'envoi n'est pas perdue
    ecrire(CLE_FILE, lire(CLE_FILE, []).filter((x) => !traites.has(x.qid)));
  } catch (e) { /* nouvel essai au prochain passage */ }
  finally { synchroEnCours = false; }
  if (envoyes) afficherMessage(envoyes + " saisie(s) envoyée(s) au serveur.", "succes");
  if (refuses) afficherMessage(refuses + " saisie(s) refusée(s) par le serveur.", "erreur");
  if ((envoyes || refuses) && document.getElementById("zone-attente")) demarrer();
}

// Bloc affiché sur l'accueil : saisies en attente et saisies refusées
function zoneAttente(profil) {
  const z = el("div", { id: "zone-attente" });
  const n = nbEnAttente(profil.id);
  if (n) {
    z.append(el("div", { class: "avertissement" }, [
      n + " saisie(s) en attente : enregistrée(s) sur ce téléphone, envoi automatique dès que le réseau revient.",
      el("button", { class: "btn btn-secondaire", type: "button", text: "Envoyer maintenant", onclick: () => {
        if (!navigator.onLine) return afficherMessage("Toujours pas de réseau.", "info");
        synchroniser();
      } })
    ]));
  }
  const echecs = lire(CLE_ECHECS, []).filter((x) => x.valeur.athlete_id === profil.id);
  if (echecs.length) {
    z.append(el("div", { class: "alerte-rouge" }, [
      echecs.length + " saisie(s) n'ont pas pu être enregistrées (données refusées par le serveur). Refais-les si besoin.",
      el("button", { class: "btn btn-secondaire", type: "button", text: "Effacer ce message", onclick: () => {
        ecrire(CLE_ECHECS, lire(CLE_ECHECS, []).filter((x) => x.valeur.athlete_id !== profil.id));
        demarrer();
      } })
    ]));
  }
  return z;
}

/* ---------- Texte de l'avertissement de santé (affiché avant consentement) ---------- */
function blocAvertissement() {
  const b = el("div", { class: "texte-long", tabindex: "0", role: "region", "aria-label": "Avertissement de santé" });
  b.innerHTML = `
    <h3>1. À quoi sert cet outil</h3>
    <p>L'AMS Syn'Athlétic est un outil de <strong>suivi de l'entraînement</strong> : il t'aide, ainsi que ton staff, à suivre ta charge de travail, ta récupération et ton état de forme.</p>
    <p>Ce n'est <strong>pas un dispositif médical</strong>. Il ne pose <strong>aucun diagnostic</strong> et ne remplace ni un médecin, ni un kinésithérapeute, ni un professionnel de santé. Les indicateurs et codes couleur sont des repères pour en discuter, ils ne prédisent pas une blessure.</p>
    <h3>2. Ta santé passe avant l'application</h3>
    <p>En cas de douleur persistante ou inhabituelle, de malaise, de vertige, de douleur thoracique ou d'essoufflement anormal : <strong>arrête l'effort et consulte un professionnel de santé</strong>. En cas d'urgence, appelle les secours de ton pays. Une couleur verte ne signifie pas « aucun risque » ; une couleur rouge ne signifie pas « blessure certaine ».</p>
    <h3>3. Tes données sont sensibles</h3>
    <p>L'application collecte des données de santé et de forme : sommeil, énergie, douleurs, stress, humeur, séances, tests physiques et, uniquement si tu le souhaites, ton cycle menstruel.</p>
    <table>
      <tr><th>Donnée</th><th>Toi</th><th>Staff</th></tr>
      <tr><td>Bien-être, séances, tests</td><td>Oui</td><td>Oui</td></tr>
      <tr><td>Cycle menstruel</td><td>Oui</td><td><strong>Non par défaut</strong>. Visible seulement si tu actives le partage (retirable à tout moment)</td></tr>
    </table>
    <p>Tes données ne sont ni vendues, ni utilisées pour de la publicité, ni transmises à des tiers (club, fédération, employeur, sponsor) sans ton accord explicite. Elles sont hébergées chez un prestataire technique (Supabase) dont les serveurs peuvent se trouver hors de ton pays : cela peut constituer un transfert international de données.</p>
    <h3>4. Tes choix et tes droits</h3>
    <p>Participer est un choix libre, refuser n'entraîne aucune sanction. Tu peux ne pas répondre à la question sur le cycle. Tu peux retirer ton consentement et demander l'accès, la correction, l'export ou la suppression de tes données à tout moment auprès de Syn'Athlétic / Alexandre GERBER. Pour un athlète de moins de 18 ans, l'accord écrit d'un parent ou tuteur légal est nécessaire.</p>
    <p class="petit">Ce texte est un modèle de bonne pratique, pas un avis juridique : il doit être validé par un professionnel du droit.</p>`;
  return b;
}

/* ---------- Écran : connexion / inscription ---------- */
function ecranAuth(modeInitial = "connexion") {
  let mode = modeInitial;
  racine.replaceChildren();

  const carte = el("section", { class: "carte" });
  const onglets = el("div", { class: "onglets", role: "tablist" });
  const formZone = el("div");

  function dessiner() {
    onglets.replaceChildren(
      el("button", { type: "button", role: "tab", "aria-selected": String(mode === "connexion"), text: "Connexion", onclick: () => { mode = "connexion"; dessiner(); } }),
      el("button", { type: "button", role: "tab", "aria-selected": String(mode === "inscription"), text: "Créer mon compte", onclick: () => { mode = "inscription"; dessiner(); } })
    );
    const form = el("form", { novalidate: "" });
    if (mode === "inscription") {
      form.append(el("label", { for: "nom", text: "Nom et prénom" }),
        el("input", { id: "nom", type: "text", autocomplete: "name", maxlength: "80", required: "" }));
    }
    form.append(
      el("label", { for: "email", text: "Email" }),
      el("input", { id: "email", type: "email", autocomplete: "email", inputmode: "email", required: "" }),
      el("label", { for: "mdp", text: "Mot de passe" + (mode === "inscription" ? " (8 caractères minimum)" : "") }),
      el("input", { id: "mdp", type: "password", autocomplete: mode === "inscription" ? "new-password" : "current-password", minlength: "8", required: "" }),
      el("button", { class: "btn", type: "submit", text: mode === "inscription" ? "Créer mon compte" : "Me connecter" })
    );
    if (mode === "connexion") {
      form.append(el("button", { class: "btn btn-secondaire", type: "button", text: "Mot de passe oublié ?", onclick: () => motDePasseOublie(form) }));
    }
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const email = form.querySelector("#email").value.trim();
      const mdp = form.querySelector("#mdp").value;
      const nom = mode === "inscription" ? form.querySelector("#nom").value.trim() : "";
      if (!emailValide(email)) return afficherMessage("Entre une adresse email valide.", "erreur");
      if (mdp.length < 8) return afficherMessage("Le mot de passe doit contenir au moins 8 caractères.", "erreur");
      if (mode === "inscription" && nom.length < 2) return afficherMessage("Entre ton nom et prénom.", "erreur");
      const bouton = form.querySelector(".btn[type=submit]");
      bouton.disabled = true;
      try {
        if (mode === "inscription") {
          const { data, error } = await sb.auth.signUp({ email, password: mdp, options: { data: { nom } } });
          if (error) throw error;
          if (!data.session) {
            afficherMessage("Compte créé. Confirme ton email (vérifie aussi les spams), puis connecte-toi.", "succes");
            mode = "connexion"; dessiner();
          }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password: mdp });
          if (error) throw error;
        }
      } catch (err) {
        afficherMessage(messageErreur(err), "erreur");
        bouton.disabled = false;
      }
    });
    formZone.replaceChildren(form);
  }

  carte.append(el("h1", { text: "Bienvenue" }),
    el("p", { class: "petit", text: "Suivi de forme et de charge d'entraînement Syn'Athlétic." }),
    onglets, formZone);
  racine.append(carte, el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" }));
  dessiner();
}

async function motDePasseOublie(form) {
  const email = form.querySelector("#email").value.trim();
  if (!emailValide(email)) return afficherMessage("Entre d'abord ton email ci-dessus.", "erreur");
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    afficherMessage("Si ce compte existe, un email de réinitialisation vient d'être envoyé.", "succes");
  } catch (err) { afficherMessage(messageErreur(err), "erreur"); }
}

/* ---------- Chargement du profil ---------- */
async function chargerProfil(userId) {
  const { data, error } = await sb.from("profiles")
    .select("id, nom, role, groupe, sexe, sport_principal, consentement_at, consentement_version, partage_cycle_staff")
    .eq("id", userId).single();
  if (error) throw error;
  return data;
}

/* ---------- Écran : avertissement + consentement + profil ---------- */
function ecranConsentement(profil) {
  racine.replaceChildren();
  const form = el("form", { class: "carte", novalidate: "" });
  const caseOk = el("input", { type: "checkbox", id: "ok" });
  const bouton = el("button", { class: "btn", type: "submit", text: "Continuer", disabled: "" });
  caseOk.addEventListener("change", () => { bouton.disabled = !caseOk.checked; });

  const selSexe = el("select", { id: "sexe" }, [
    el("option", { value: "", text: "Je préfère ne pas répondre" }),
    el("option", { value: "F", text: "Femme" }),
    el("option", { value: "M", text: "Homme" })
  ]);
  const selSport = el("select", { id: "sport" }, [
    ["athletisme", "Athlétisme"], ["football", "Football"], ["handball", "Handball"],
    ["basketball", "Basketball"], ["autre", "Autre sport"]
  ].map(([v, t]) => el("option", { value: v, text: t })));
  const champGroupe = el("input", { id: "groupe", type: "text", maxlength: "40", placeholder: "Ex : Sprint, Haies, U19…" });
  const champNom = el("input", { id: "nomprofil", type: "text", maxlength: "80", value: profil.nom || "" });

  form.append(
    el("h1", { text: "Avant de commencer" }),
    el("p", { text: "Lis cet avertissement : il explique quelles données sont collectées et qui les voit." }),
    blocAvertissement(),
    el("label", { for: "nomprofil", text: "Nom et prénom" }), champNom,
    el("label", { for: "sport", text: "Sport principal" }), selSport,
    el("label", { for: "groupe", text: "Groupe (facultatif)" }), champGroupe,
    el("label", { for: "sexe", text: "Sexe (sert uniquement à afficher la question sur le cycle)" }), selSexe,
    el("div", { class: "ligne-case" }, [caseOk, el("label", { for: "ok", text: "J'ai lu et j'accepte : mes données de bien-être, de séances et de tests sont enregistrées et consultables par le staff Syn'Athlétic. Mon cycle menstruel n'est visible du staff que si j'active moi-même le partage. Cet outil ne remplace pas un avis médical." })]),
    bouton
  );
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!caseOk.checked) return;
    const nom = champNom.value.trim();
    if (nom.length < 2) return afficherMessage("Entre ton nom et prénom.", "erreur");
    bouton.disabled = true;
    try {
      const { error } = await sb.from("profiles").update({
        nom,
        sport_principal: selSport.value,
        groupe: champGroupe.value.trim() || null,
        sexe: selSexe.value || null,
        consentement_at: new Date().toISOString(),
        consentement_version: cfg.VERSION_CONSENTEMENT
      }).eq("id", profil.id);
      if (error) throw error;
      afficherMessage("Consentement enregistré. Merci !", "succes");
      await demarrer();
    } catch (err) {
      afficherMessage(messageErreur(err), "erreur");
      bouton.disabled = false;
    }
  });
  racine.append(form, el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" }));
}

/* ---------- Écran : accueil ---------- */
function ecranAccueil(profil) {
  racine.replaceChildren();
  const estStaff = profil.role === "staff";

  const carteBienvenue = el("section", { class: "carte" }, [
    el("h1", { text: "Bonjour " + (profil.nom ? profil.nom.split(" ")[0] : "") }),
    el("span", { class: "badge" + (estStaff ? " badge-staff" : ""), text: estStaff ? "Staff" : "Athlète" }),
    el("p", { class: "petit", text: estStaff
      ? " Le tableau de bord de tous les athlètes arrive à l'étape 6. Tu peux déjà saisir tes propres données."
      : " Saisis ton bien-être du matin et tes séances ci-dessous." })
  ]);

  const tuile = (titre, sous, action) => action
    ? el("button", { class: "tuile", type: "button", onclick: action }, [titre, el("small", { text: sous })])
    : el("div", { class: "tuile bientot" }, [titre, el("small", { text: sous })]);
  const tuiles = el("section", { class: "carte" }, [
    el("h2", { text: "Ma saisie" }),
    el("div", { class: "grille" }, [
      tuile("Bien-être du matin", "1 minute", () => ecranBienEtre(profil)),
      tuile("Séance + RPE", "après l'entraînement", () => ecranSeance(profil)),
      tuile("ACWR et couleurs", "Étape 5"),
      tuile(estStaff ? "Tableau de bord staff" : "Mon historique", "Étape 6")
    ])
  ]);
  const zoneHisto = el("section", { class: "carte" }, [el("h2", { text: "Mes dernières saisies" }), el("p", { class: "petit", text: "Chargement…" })]);
  chargerHistorique(profil, zoneHisto);

  const reglages = el("section", { class: "carte" }, [el("h2", { text: "Mes réglages et mes droits" })]);

  if (profil.sexe === "F") {
    const caseCycle = el("input", { type: "checkbox", id: "partage" });
    caseCycle.checked = !!profil.partage_cycle_staff;
    caseCycle.addEventListener("change", async () => {
      caseCycle.disabled = true;
      try {
        const { error } = await sb.from("profiles").update({ partage_cycle_staff: caseCycle.checked }).eq("id", profil.id);
        if (error) throw error;
        profil.partage_cycle_staff = caseCycle.checked;
        afficherMessage(caseCycle.checked ? "Partage du cycle avec le staff activé." : "Partage du cycle avec le staff désactivé.", "succes");
      } catch (err) {
        caseCycle.checked = !caseCycle.checked;
        afficherMessage(messageErreur(err), "erreur");
      }
      caseCycle.disabled = false;
    });
    reglages.append(
      el("div", { class: "ligne-case" }, [caseCycle, el("label", { for: "partage", text: "Partager mon suivi du cycle avec le staff (désactivé par défaut, modifiable à tout moment)." })])
    );
  }

  const btnRetrait = el("button", { class: "btn btn-danger", type: "button", text: "Retirer mon consentement", onclick: async () => {
    if (!confirm("Retirer ton consentement ? Tu ne pourras plus saisir de données tant que tu n'auras pas accepté à nouveau. Pour supprimer tes données, contacte Syn'Athlétic.")) return;
    try {
      const { error } = await sb.from("profiles").update({ consentement_at: null, consentement_version: null, partage_cycle_staff: false }).eq("id", profil.id);
      if (error) throw error;
      afficherMessage("Consentement retiré.", "info");
      await demarrer();
    } catch (err) { afficherMessage(messageErreur(err), "erreur"); }
  }});
  reglages.append(
    el("p", { class: "petit", text: "Consentement accepté le " + new Date(profil.consentement_at).toLocaleDateString("fr-FR") + " (version " + (profil.consentement_version || "?") + ")." }),
    btnRetrait
  );

  racine.append(carteBienvenue, zoneAttente(profil), tuiles, zoneHisto, reglages,
    el("div", { class: "avertissement", text: "Cet outil sert au suivi de l'entraînement. Il ne remplace pas un avis médical : en cas de douleur ou de symptôme inquiétant, consulte un professionnel de santé." }),
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" }));
}

/* ---------- Saisie : outils communs ---------- */

// Date locale au format AAAA-MM-JJ (et non UTC, pour ne pas décaler la journée)
function dateLocale(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function dateFr(iso) { const [a, m, j] = iso.split("-"); return j + "/" + m + "/" + a; }

// Échelle de 1 à N avec un libellé aux deux extrémités ; renvoie { noeud, valeur() }
function echelle(id, question, texteBas, texteHaut, max = 5) {
  let valeur = null;
  const boutons = [];
  const rangee = el("div", { class: "echelle", role: "radiogroup", "aria-label": question });
  for (let i = 1; i <= max; i++) {
    const b = el("button", { type: "button", class: "pastille", role: "radio", "aria-checked": "false", text: String(i) });
    b.addEventListener("click", () => {
      valeur = i;
      boutons.forEach((x, k) => { x.setAttribute("aria-checked", String(k + 1 === i)); x.classList.toggle("choisi", k + 1 === i); });
    });
    boutons.push(b); rangee.append(b);
  }
  const noeud = el("div", { class: "bloc-echelle", id }, [
    el("p", { class: "question", text: question }), rangee,
    el("div", { class: "extremes" }, [el("span", { text: "1 = " + texteBas }), el("span", { text: max + " = " + texteHaut })])
  ]);
  return { noeud, valeur: () => valeur };
}

function enTete(titre, retour) {
  return el("div", { class: "barre-titre" }, [
    el("button", { type: "button", class: "btn-retour", text: "← Retour", onclick: retour }),
    el("h1", { text: titre })
  ]);
}

/* ---------- Écran : bien-être du matin ---------- */
function ecranBienEtre(profil) {
  racine.replaceChildren();
  const E = {
    sommeil: echelle("e-sommeil", "Comment as-tu dormi ?", "très mal", "très bien"),
    energie: echelle("e-energie", "Ton niveau d'énergie ce matin ?", "épuisé(e)", "plein(e) d'énergie"),
    douleurs: echelle("e-douleurs", "Douleurs ou courbatures ?", "très douloureux", "aucune douleur"),
    stress: echelle("e-stress", "Ton niveau de stress ?", "très stressé(e)", "aucun stress"),
    humeur: echelle("e-humeur", "Ton humeur ?", "très mauvaise", "très bonne")
  };
  const champDate = el("input", { type: "date", id: "date-be", value: dateLocale(), max: dateLocale() });
  const commentaire = el("textarea", { id: "com-be", maxlength: "500", rows: "3", placeholder: "Facultatif : une douleur précise, un souci particulier…" });
  const form = el("form", { class: "carte", novalidate: "" }, [
    el("p", { class: "petit", text: "5 = le mieux sur toutes les échelles. Réponds spontanément." }),
    el("label", { for: "date-be", text: "Date" }), champDate,
    ...Object.values(E).map((x) => x.noeud),
    el("label", { for: "com-be", text: "Commentaire" }), commentaire
  ]);

  // Question sur le cycle : uniquement pour les femmes, entièrement facultative
  let phase = null, gene = null;
  if (profil.sexe === "F") {
    const selPhase = el("select", { id: "phase" }, [
      ["", "Je ne réponds pas aujourd'hui"], ["regles", "Pendant mes règles"], ["folliculaire", "Après les règles (phase folliculaire)"],
      ["ovulation", "Autour de l'ovulation"], ["luteale", "Avant les règles (phase lutéale)"], ["je_ne_sais_pas", "Je ne sais pas"]
    ].map(([v, t]) => el("option", { value: v, text: t })));
    phase = selPhase;
    gene = echelle("e-gene", "Gêne liée au cycle (crampes, fatigue, etc.) ?", "très gênant", "aucune gêne");
    form.append(el("div", { class: "bloc-cycle" }, [
      el("h2", { text: "Cycle menstruel (facultatif)" }),
      el("p", { class: "petit", text: profil.partage_cycle_staff
        ? "Tu as choisi de partager cette information avec le staff." : "Cette information reste privée : le staff ne la voit pas (réglable sur l'accueil)." }),
      el("label", { for: "phase", text: "Où en es-tu ?" }), selPhase, gene.noeud
    ]));
  }
  const bouton = el("button", { class: "btn", type: "submit", text: "Enregistrer" });
  form.append(bouton);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    for (const [nom, x] of Object.entries(E)) if (!x.valeur()) return afficherMessage("Réponds à toutes les échelles (" + nom + ").", "erreur");
    const date = champDate.value || dateLocale();
    bouton.disabled = true;
    try {
      let etat = await enregistrer("bien_etre", {
        athlete_id: profil.id, date,
        sommeil: E.sommeil.valeur(), energie: E.energie.valeur(), douleurs: E.douleurs.valeur(),
        stress: E.stress.valeur(), humeur: E.humeur.valeur(),
        commentaire: commentaire.value.trim() || null
      }, "athlete_id,date");
      if (phase && phase.value) {
        const e2 = await enregistrer("cycle_menstruel", {
          athlete_id: profil.id, date, phase: phase.value, gene_symptomes: gene.valeur()
        }, "athlete_id,date");
        if (e2 === "en_attente") etat = "en_attente";
      }
      if (etat === "envoye") afficherMessage("Bien-être enregistré. Bonne séance !", "succes");
      else afficherMessage("Pas de réseau : enregistré sur ton téléphone, envoi automatique au retour du réseau.", "info");
      await demarrer();
    } catch (err) {
      afficherMessage(messageErreur(err), "erreur");
      bouton.disabled = false;
    }
  });
  racine.append(enTete("Bien-être du matin", demarrer), form);
  window.scrollTo(0, 0);
}

/* ---------- Écran : séance + RPE ---------- */
const CATEGORIES_ATHLE = [
  ["acceleration", "Accélération"], ["vitesse_max", "Vitesse max"], ["endurance_vitesse_rythmique", "Endurance vitesse / rythmique"],
  ["specifique", "Spécifique"], ["technique_sprint", "Technique sprint"], ["technique_haies", "Technique haies"],
  ["force_max", "Force max"], ["force_explosive", "Force explosive"], ["puissance", "Puissance"],
  ["endurance_force", "Endurance de force"], ["endurance_fondamentale", "Endurance fondamentale"], ["tempo_extensif", "Tempo extensif"],
  ["prevention_blessures", "Prévention des blessures"], ["mobilite_souplesse", "Mobilité / souplesse"],
  ["match_competition", "Compétition"], ["recuperation", "Récupération"], ["autre", "Autre"]
];
const CATEGORIES_AUTRES = [
  ["vitesse", "Vitesse"], ["endurance", "Endurance"], ["force", "Force"], ["souplesse", "Souplesse"],
  ["coordination", "Coordination"], ["technique_tactique", "Technique / tactique"], ["match_competition", "Match / compétition"],
  ["recuperation", "Récupération"], ["autre", "Autre"]
];
const TEXTE_RPE = ["", "Très facile", "Facile", "Modéré", "Un peu dur", "Dur", "Dur+", "Très dur", "Très très dur", "Presque max", "Maximal"];

function ecranSeance(profil) {
  racine.replaceChildren();
  const selSport = el("select", { id: "sport-s" }, [
    ["athletisme", "Athlétisme"], ["football", "Football"], ["handball", "Handball"], ["basketball", "Basketball"], ["autre", "Autre sport"]
  ].map(([v, t]) => el("option", { value: v, text: t })));
  selSport.value = profil.sport_principal || "athletisme";
  const selCat = el("select", { id: "cat-s" });
  const champVolume = el("input", { id: "vol-s", type: "number", inputmode: "numeric", min: "0", max: "100000", step: "10", placeholder: "Ex : 600" });
  const blocVolume = el("div", {}, [el("label", { for: "vol-s", text: "Volume de course en mètres (facultatif)" }), champVolume]);
  function majCategories() {
    const liste = selSport.value === "athletisme" ? CATEGORIES_ATHLE : CATEGORIES_AUTRES;
    selCat.replaceChildren(el("option", { value: "", text: "Choisis…" }), ...liste.map(([v, t]) => el("option", { value: v, text: t })));
    blocVolume.classList.toggle("cache", selSport.value !== "athletisme");
  }
  selSport.addEventListener("change", majCategories);
  majCategories();

  const champDate = el("input", { type: "date", id: "date-s", value: dateLocale(), max: dateLocale() });
  const champDuree = el("input", { id: "duree-s", type: "number", inputmode: "numeric", min: "1", max: "480", placeholder: "Ex : 90" });
  const rpe = echelle("e-rpe", "Effort ressenti (RPE) : à quel point la séance était-elle dure ?", "très facile", "maximal", 10);
  const aideRpe = el("p", { class: "petit", text: "Choisis une note de 1 à 10." });
  rpe.noeud.querySelectorAll(".pastille").forEach((b, k) => b.addEventListener("click", () => { aideRpe.textContent = (k + 1) + " : " + TEXTE_RPE[k + 1]; maj(); }));
  const commentaire = el("textarea", { id: "com-s", maxlength: "500", rows: "3", placeholder: "Facultatif : contenu, sensations, incident…" });
  const resume = el("div", { class: "resume-charge" });
  function maj() {
    const d = parseInt(champDuree.value, 10), r = rpe.valeur();
    resume.textContent = d > 0 && r ? "Charge de la séance : " + (d * r) + " UA (durée × RPE)" : "";
  }
  champDuree.addEventListener("input", maj);

  const bouton = el("button", { class: "btn", type: "submit", text: "Enregistrer la séance" });
  const form = el("form", { class: "carte", novalidate: "" }, [
    el("label", { for: "date-s", text: "Date" }), champDate,
    el("label", { for: "sport-s", text: "Sport" }), selSport,
    el("label", { for: "cat-s", text: "Type de séance" }), selCat,
    el("label", { for: "duree-s", text: "Durée totale (minutes)" }), champDuree,
    blocVolume, rpe.noeud, aideRpe, resume,
    el("label", { for: "com-s", text: "Commentaire" }), commentaire, bouton
  ]);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const duree = parseInt(champDuree.value, 10);
    if (!selCat.value) return afficherMessage("Choisis le type de séance.", "erreur");
    if (!(duree >= 1 && duree <= 480)) return afficherMessage("Durée : entre 1 et 480 minutes.", "erreur");
    if (!rpe.valeur()) return afficherMessage("Choisis ton effort ressenti (RPE).", "erreur");
    let volume = null;
    if (selSport.value === "athletisme" && champVolume.value !== "") {
      volume = parseInt(champVolume.value, 10);
      if (!(volume >= 0 && volume <= 100000)) return afficherMessage("Volume de course : entre 0 et 100000 m.", "erreur");
    }
    bouton.disabled = true;
    try {
      const etat = await enregistrer("seances", {
        id: nouvelId(), athlete_id: profil.id, date: champDate.value || dateLocale(), sport: selSport.value, categorie: selCat.value,
        duree_min: duree, rpe: rpe.valeur(), volume_course_m: volume, commentaire: commentaire.value.trim() || null
      }, "id");
      if (etat === "envoye") afficherMessage("Séance enregistrée (" + (duree * rpe.valeur()) + " UA).", "succes");
      else afficherMessage("Pas de réseau : séance gardée sur ton téléphone (" + (duree * rpe.valeur()) + " UA), envoi automatique au retour du réseau.", "info");
      await demarrer();
    } catch (err) {
      afficherMessage(messageErreur(err), "erreur");
      bouton.disabled = false;
    }
  });
  racine.append(enTete("Séance + RPE", demarrer), form);
  window.scrollTo(0, 0);
}

/* ---------- Historique personnel (7 dernières saisies de chaque type) ---------- */
async function chargerHistorique(profil, zone) {
  try {
    const [be, se] = await Promise.all([
      sb.from("bien_etre").select("date, score_total").eq("athlete_id", profil.id).order("date", { ascending: false }).limit(7),
      sb.from("seances").select("date, categorie, duree_min, rpe, charge_ua").eq("athlete_id", profil.id).order("date", { ascending: false }).order("created_at", { ascending: false }).limit(7)
    ]);
    if (be.error) throw be.error;
    if (se.error) throw se.error;
    const nomCat = Object.fromEntries([...CATEGORIES_ATHLE, ...CATEGORIES_AUTRES]);
    const lignes = (titre, items, rendu) => [el("h3", { text: titre }),
      items.length ? el("ul", { class: "liste" }, items.map((x) => el("li", { text: rendu(x) }))) : el("p", { class: "petit", text: "Rien pour l'instant." })];
    zone.replaceChildren(el("h2", { text: "Mes dernières saisies" }),
      ...lignes("Bien-être (score sur 25)", be.data, (x) => dateFr(x.date) + " : " + x.score_total + "/25"),
      ...lignes("Séances", se.data, (x) => dateFr(x.date) + " : " + (nomCat[x.categorie] || x.categorie) + ", " + x.duree_min + " min, RPE " + x.rpe + " = " + x.charge_ua + " UA"));
  } catch (err) {
    zone.replaceChildren(el("h2", { text: "Mes dernières saisies" }), el("p", { class: "petit", text: erreurReseau(err) ? "Historique indisponible sans réseau." : messageErreur(err) }));
  }
}

/* ---------- Démarrage : choisit l'écran selon la session ---------- */
async function demarrer() {
  if (!sb) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const cache = lire(CLE_PROFIL, null);
    let profil = null;
    if (!session) {
      // Sans réseau, la session ne peut pas être renouvelée : on ouvre le profil gardé sur le téléphone
      if (!navigator.onLine && cache) {
        afficherMessage("Mode hors connexion : tes saisies seront envoyées plus tard.", "info");
        profil = cache;
      } else {
        boutonDeconnexion.classList.add("cache");
        return ecranAuth();
      }
    } else {
      boutonDeconnexion.classList.remove("cache");
      try {
        profil = await chargerProfil(session.user.id);
        ecrire(CLE_PROFIL, profil);
      } catch (err) {
        if (erreurReseau(err) && cache && cache.id === session.user.id) {
          afficherMessage("Mode hors connexion : tes saisies seront envoyées plus tard.", "info");
          profil = cache;
        } else throw err;
      }
    }
    boutonDeconnexion.classList.remove("cache");
    if (!profil.consentement_at) return ecranConsentement(profil);
    ecranAccueil(profil);
    synchroniser();
  } catch (err) {
    racine.replaceChildren(el("div", { class: "carte" }, [
      el("h2", { text: "Impossible de charger tes données" }),
      el("p", { text: messageErreur(err) }),
      el("button", { class: "btn", type: "button", text: "Réessayer", onclick: demarrer })
    ]));
  }
}

boutonDeconnexion.addEventListener("click", async () => {
  const cache = lire(CLE_PROFIL, null);
  if (cache && nbEnAttente(cache.id) && !confirm("Des saisies ne sont pas encore envoyées. Elles partiront à ta prochaine connexion sur ce téléphone. Te déconnecter quand même ?")) return;
  try { await sb.auth.signOut({ scope: "local" }); } catch (e) { /* session locale déjà effacée */ }
  try { localStorage.removeItem(CLE_PROFIL); } catch (e) { /* sans importance */ }
  await demarrer();
});

if (sb) {
  // Réagit aux connexions/déconnexions (y compris dans un autre onglet)
  sb.auth.onAuthStateChange((evenement) => {
    if (evenement === "SIGNED_IN" || evenement === "SIGNED_OUT") demarrer();
  });
  demarrer();
  // Retour du réseau : envoi automatique des saisies en attente (et nouvel essai toutes les 60 s)
  window.addEventListener("online", synchroniser);
  setInterval(synchroniser, 60000);
}

// Service worker : permet l'installation et l'ouverture sans réseau de l'interface
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
