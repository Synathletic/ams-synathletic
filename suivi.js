// AMS Syn'Athlétic : étapes 5 et 6
// Analyses (charge, ACWR, alertes), graphiques SVG, export CSV, vue « Mon suivi » et tableau de bord staff.
// Chargé AVANT app.js : tout ce qui touche à l'interface n'est appelé qu'après le démarrage de l'application.
// Signé Syn'Athlétic / Alexandre GERBER
"use strict";

/* ---------- Seuils (repères de discussion, pas des prédictions de blessure) ---------- */
const SEUILS = {
  acwrVertMin: 0.8,      // en dessous : orange (charge récente basse)
  acwrVertMax: 1.3,      // au-dessus : orange
  acwrRouge: 1.5,        // au-dessus : rouge
  hausseOrange: 1.1,     // charge des 7 jours entre +10 % et +30 % vs semaine précédente : orange
  hausseRouge: 1.3,      // au-delà de +30 % : rouge (0 à +10 % : vert)
  scoreRouge: 12,        // score de bien-être (sur 25) <= 12 : rouge
  scoreOrange: 15,       // 13 à 15 : orange
  scoreJaune: 19,        // 16 à 19 : jaune ; 20 et plus : vert
  douleurOrange: 2,      // douleurs (5 = aucune douleur) <= 2 : orange
  douleurRouge: 1,       // = 1 : rouge
  energieBasse: 2,       // énergie <= 2 pendant 3 saisies de suite : orange
  baisseRelative: 0.2,   // moyenne des 3 derniers jours inférieure de 20 % à la base : orange
  joursSansSaisie: 3,    // pas de bien-être depuis 3 jours : information
  minJoursHistorique: 21,// ACWR calculé seulement après 3 semaines d'historique
  fenetreJours: 120      // période chargée pour les calculs et les graphiques
};
const COULEURS = { vert: "#1a8a3c", jaune: "#f2c200", orange: "#ff7f0a", rouge: "#e30613", bleu: "#4a7bd0", insuffisant: "#8a93a6" };

/* ---------- Dates (chaînes AAAA-MM-JJ, calculées en UTC pour éviter les décalages d'heure) ---------- */
function partiesDate(iso) { const [a, m, j] = iso.split("-").map(Number); return [a, m - 1, j]; }
function jourPlus(iso, n) { const [a, m, j] = partiesDate(iso); return new Date(Date.UTC(a, m, j + n)).toISOString().slice(0, 10); }
function ecartJours(debut, fin) { const [a, m, j] = partiesDate(debut), [a2, m2, j2] = partiesDate(fin); return Math.round((Date.UTC(a2, m2, j2) - Date.UTC(a, m, j)) / 864e5); }
function lundiDe(iso) { const [a, m, j] = partiesDate(iso); return jourPlus(iso, -((new Date(Date.UTC(a, m, j)).getUTCDay() + 6) % 7)); }
function dateCourte(iso) { const p = iso.split("-"); return p[2] + "/" + p[1]; }
function fr(x, d = 2) { return x === null || x === undefined || Number.isNaN(x) ? "–" : Number(x).toFixed(d).replace(".", ","); }

/* ---------- Charge et ACWR ---------- */
function chargesParJour(seances) {
  const m = new Map();
  for (const s of seances) m.set(s.date, (m.get(s.date) || 0) + (s.charge_ua || 0));
  return m;
}
function somme(map, fin, nbJours) { let t = 0; for (let i = 0; i < nbJours; i++) t += map.get(jourPlus(fin, -i)) || 0; return t; }
function niveauACWR(x) {
  if (x > SEUILS.acwrRouge) return "rouge";
  if (x > SEUILS.acwrVertMax) return "orange";
  if (x < SEUILS.acwrVertMin) return "orange";
  return "vert";
}
function niveauScore(v) {
  if (v <= SEUILS.scoreRouge) return "rouge";
  if (v <= SEUILS.scoreOrange) return "orange";
  if (v <= SEUILS.scoreJaune) return "jaune";
  return "vert";
}
// ACWR = charge des 7 derniers jours ÷ charge hebdomadaire moyenne des 28 derniers jours
function acwrDuJour(map, jour, premiere) {
  const aigue = somme(map, jour, 7);
  const chronique = somme(map, jour, 28) / 4;
  const histo = premiere ? ecartJours(premiere, jour) + 1 : 0;
  if (histo < SEUILS.minJoursHistorique || chronique <= 0) return { aigue, chronique, acwr: null, niveau: "insuffisant" };
  const acwr = aigue / chronique;
  return { aigue, chronique, acwr, niveau: niveauACWR(acwr) };
}
function premiereDate(seances) { let p = null; for (const s of seances) if (!p || s.date < p) p = s.date; return p; }

/* ---------- Alertes et pistes de décision ---------- */
const ORDRE_NIVEAU = { rouge: 4, orange: 3, jaune: 2, info: 1 };
function analyser(seances, bienEtres, aujourdhui) {
  const map = chargesParJour(seances);
  const a = acwrDuJour(map, aujourdhui, premiereDate(seances));
  const precedente = somme(map, jourPlus(aujourdhui, -7), 7);
  const al = [];
  const ajouter = (niveau, code, titre, detail, piste) => al.push({ niveau, code, titre, detail, piste });

  if (a.niveau === "rouge") ajouter("rouge", "acwr_haut", "ACWR très élevé : " + fr(a.acwr),
    "La charge des 7 derniers jours dépasse nettement la charge habituelle des 4 dernières semaines.",
    "Discuter d'un ajustement de la charge des 2 à 3 prochaines séances (volume ou intensité) ; vérifier sommeil, douleurs et contexte (reprise, compétition, stage). Repère à interpréter avec ton jugement, pas un diagnostic.");
  else if (a.niveau === "orange" && a.acwr > 1) ajouter("orange", "acwr_moyen", "ACWR en hausse : " + fr(a.acwr),
    "La charge des 7 derniers jours est supérieure à la charge habituelle.",
    "Surveiller : éviter d'ajouter une nouvelle hausse de charge sans récupération et confirmer le plan prévu avec l'athlète.");
  else if (a.niveau === "orange") ajouter("orange", "acwr_bas", "ACWR bas : " + fr(a.acwr),
    "La charge des 7 derniers jours est inférieure à la charge habituelle.",
    "Vérifier si la baisse est voulue (affûtage, repos, absence, gêne). Une reprise trop rapide après une baisse expose à un pic de charge : prévoir une remontée progressive.");

  const rapport = precedente > 0 ? a.aigue / precedente : null;
  if (rapport !== null && rapport > SEUILS.hausseOrange) {
    const fort = rapport > SEUILS.hausseRouge;
    ajouter(fort ? "rouge" : "orange", fort ? "hausse_rouge" : "hausse",
      "Charge de la semaine : +" + Math.round((rapport - 1) * 100) + " %",
      "7 derniers jours : " + a.aigue + " UA, contre " + precedente + " UA la semaine précédente.",
      fort ? "Hausse forte : vérifier qu'elle est voulue et envisager d'alléger les prochaines séances pour lisser la charge."
        : "Vérifier que cette hausse est prévue dans la planification ; sinon, lisser la charge sur la semaine.");
  }

  const be = [...bienEtres].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const dernier = be.length ? be[be.length - 1] : null;
  if (!dernier) {
    ajouter("info", "aucune_saisie", "Aucun bien-être saisi pour l'instant", "", "Inviter l'athlète à saisir son bien-être chaque matin.");
  } else {
    const age = ecartJours(dernier.date, aujourdhui);
    if (age >= SEUILS.joursSansSaisie) ajouter("info", "sans_saisie", "Pas de bien-être depuis " + age + " jours",
      "Dernière saisie le " + dateFr(dernier.date) + ".", "Prendre des nouvelles et vérifier que l'athlète peut utiliser l'application.");
    if (age <= 3) {
      if (dernier.score_total <= SEUILS.scoreRouge) ajouter("rouge", "score_rouge", "Bien-être très bas : " + dernier.score_total + "/25",
        "Saisie du " + dateFr(dernier.date) + ".", "Échanger rapidement avec l'athlète (sommeil, stress, douleur, maladie, vie personnelle) et adapter la séance du jour si besoin.");
      else if (dernier.score_total <= SEUILS.scoreOrange) ajouter("orange", "score_orange", "Bien-être bas : " + dernier.score_total + "/25",
        "Saisie du " + dateFr(dernier.date) + ".", "Prendre des nouvelles ; si la tendance se confirme, alléger ou adapter la prochaine séance.");
      else if (dernier.score_total <= SEUILS.scoreJaune) ajouter("jaune", "score_jaune", "Bien-être moyen : " + dernier.score_total + "/25",
        "Saisie du " + dateFr(dernier.date) + ".", "Surveiller l'évolution sur les prochains jours ; prendre des nouvelles si la tendance baisse.");
      if (dernier.douleurs <= SEUILS.douleurRouge) ajouter("rouge", "douleur_rouge", "Douleurs importantes signalées",
        "Saisie du " + dateFr(dernier.date) + " : douleurs = " + dernier.douleurs + "/5.",
        "Interroger l'athlète sur la localisation et l'évolution ; éviter de charger la zone concernée et orienter vers un professionnel de santé si la douleur persiste ou est inhabituelle.");
      else if (dernier.douleurs <= SEUILS.douleurOrange) ajouter("orange", "douleur_orange", "Douleurs signalées",
        "Saisie du " + dateFr(dernier.date) + " : douleurs = " + dernier.douleurs + "/5.",
        "Demander où et depuis quand ; adapter la séance si la gêne limite le geste.");
      const trois = be.slice(-3);
      if (trois.length === 3 && trois.every((x) => x.energie <= SEUILS.energieBasse) && ecartJours(trois[0].date, dernier.date) <= 5)
        ajouter("orange", "energie", "Énergie basse sur 3 saisies de suite", "Du " + dateFr(trois[0].date) + " au " + dateFr(dernier.date) + ".",
          "Fatigue persistante : vérifier sommeil, alimentation, charge cumulée et contexte ; envisager une séance allégée ou un jour de récupération.");
      const recents = be.filter((x) => ecartJours(x.date, aujourdhui) <= 3);
      const base = be.filter((x) => { const e = ecartJours(x.date, aujourdhui); return e >= 4 && e <= 17; });
      if (recents.length >= 2 && base.length >= 5) {
        const mR = recents.reduce((t, x) => t + x.score_total, 0) / recents.length;
        const mB = base.reduce((t, x) => t + x.score_total, 0) / base.length;
        if (mR < mB * (1 - SEUILS.baisseRelative) && !al.some((x) => x.code === "score_rouge" || x.code === "score_orange"))
          ajouter("orange", "baisse", "Bien-être en baisse sur les derniers jours",
            "Moyenne récente " + fr(mR, 1) + "/25 contre " + fr(mB, 1) + "/25 les deux semaines d'avant.",
            "Tendance à la baisse : en parler avec l'athlète et la croiser avec la charge récente.");
      }
    }
  }
  al.sort((x, y) => ORDRE_NIVEAU[y.niveau] - ORDRE_NIVEAU[x.niveau]);
  const niveau = al.some((x) => x.niveau === "rouge") ? "rouge" : al.some((x) => x.niveau === "orange") ? "orange" : al.some((x) => x.niveau === "jaune") ? "jaune" : "ok";
  return { aujourdhui, acwr: a, charge7: a.aigue, precedente, rapport, dernier, alertes: al, niveau, map };
}

/* ---------- Séries pour les graphiques ---------- */
function serieHebdo(map, aujourdhui, n = 8) {
  const lundi = lundiDe(aujourdhui), out = [];
  for (let w = n - 1; w >= 0; w--) {
    const debut = jourPlus(lundi, -7 * w);
    out.push({ lib: dateCourte(debut), val: somme(map, jourPlus(debut, 6), 7) });
  }
  return out;
}
function serieACWR(map, premiere, aujourdhui, n = 42) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const j = jourPlus(aujourdhui, -i), r = acwrDuJour(map, j, premiere);
    out.push({ lib: dateCourte(j), val: r.acwr === null ? null : Math.round(r.acwr * 100) / 100, niveau: r.niveau });
  }
  return out;
}
function serieBienEtre(be, aujourdhui, champ, n = 30) {
  const m = new Map(be.map((x) => [x.date, x[champ]]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const j = jourPlus(aujourdhui, -i); out.push({ lib: dateCourte(j), val: m.has(j) ? m.get(j) : null }); }
  return out;
}

/* ---------- Graphiques SVG (sans bibliothèque : fonctionnent hors connexion) ---------- */
const NS_SVG = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, enfants = []) {
  const n = document.createElementNS(NS_SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const e of [].concat(enfants)) n.append(e instanceof Node ? e : document.createTextNode(e));
  return n;
}
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return ([1, 2, 2.5, 5, 10].find((k) => k * p >= v) || 10) * p; }

function enveloppeGraphique(titre, svg, legende, donnees, decimales = 0) {
  const c = el("section", { class: "carte" }, [el("h2", { text: titre }), svg]);
  if (legende && legende.length) {
    c.append(el("div", { class: "legende" }, legende.map((l) => {
      const pastille = el("i"); pastille.style.background = l.couleur;
      return el("span", {}, [pastille, l.texte]);
    })));
  }
  const lignes = donnees.map((d) => el("tr", {}, [el("td", { text: d.lib }), el("td", { text: d.val === null || d.val === undefined ? "–" : fr(d.val, decimales) })]));
  c.append(el("details", {}, [el("summary", { text: "Voir les valeurs" }), el("table", {}, [el("tr", {}, [el("th", { text: "Date" }), el("th", { text: "Valeur" })]), ...lignes])]));
  return c;
}

function graphBarres(titre, donnees, legende) {
  const W = 360, H = 200, g = { l: 40, r: 10, t: 16, b: 26 }, pw = W - g.l - g.r, ph = H - g.t - g.b;
  const haut = niceMax(Math.max(1, ...donnees.map((d) => d.val)));
  const Y = (v) => g.t + ph - (v / haut) * ph;
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "graphique", role: "img", "aria-label": titre + " : " + donnees.map((d) => d.lib + " " + d.val).join(", ") });
  for (const t of [0, haut / 2, haut]) {
    svg.append(svgEl("line", { x1: g.l, x2: W - g.r, y1: Y(t), y2: Y(t), stroke: "#d6dcea", "stroke-width": 1 }));
    svg.append(svgEl("text", { x: g.l - 4, y: Y(t) + 3, "text-anchor": "end", "font-size": 9, fill: "#5b6577" }, String(Math.round(t))));
  }
  const bw = pw / donnees.length;
  donnees.forEach((d, i) => {
    const x = g.l + i * bw + bw * 0.15, h = (d.val / haut) * ph;
    svg.append(svgEl("rect", { x, y: Y(d.val), width: bw * 0.7, height: Math.max(h, 0), rx: 3, fill: "#003087" }));
    if (d.val > 0) svg.append(svgEl("text", { x: x + bw * 0.35, y: Y(d.val) - 3, "text-anchor": "middle", "font-size": 8.5, fill: "#14213d" }, String(d.val)));
    svg.append(svgEl("text", { x: x + bw * 0.35, y: H - 9, "text-anchor": "middle", "font-size": 9, fill: "#5b6577" }, d.lib));
  });
  return enveloppeGraphique(titre, svg, legende, donnees, 0);
}

// o : { min, max, graduations: [..], bandes: [{de, a, couleur}], decimales }
function graphLigne(titre, points, o, legende) {
  const W = 360, H = 200, g = { l: 36, r: 12, t: 12, b: 26 }, pw = W - g.l - g.r, ph = H - g.t - g.b, n = points.length;
  const X = (i) => g.l + (n <= 1 ? pw / 2 : (i * pw) / (n - 1));
  const Y = (v) => g.t + ph - ((Math.min(Math.max(v, o.min), o.max) - o.min) / (o.max - o.min)) * ph;
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "graphique", role: "img",
    "aria-label": titre + " : " + points.filter((p) => p.val !== null).slice(-5).map((p) => p.lib + " " + fr(p.val, o.decimales || 0)).join(", ") });
  for (const b of o.bandes || []) svg.append(svgEl("rect", { x: g.l, y: Y(b.a), width: pw, height: Math.max(0, Y(b.de) - Y(b.a)), fill: b.couleur }));
  for (const t of o.graduations) {
    svg.append(svgEl("line", { x1: g.l, x2: W - g.r, y1: Y(t), y2: Y(t), stroke: "#c6cee0", "stroke-width": 0.7 }));
    svg.append(svgEl("text", { x: g.l - 4, y: Y(t) + 3, "text-anchor": "end", "font-size": 9, fill: "#5b6577" }, String(t).replace(".", ",")));
  }
  let seg = [];
  const fin = () => {
    if (seg.length > 1) svg.append(svgEl("polyline", { points: seg.join(" "), fill: "none", stroke: "#003087", "stroke-width": 2, "stroke-linejoin": "round" }));
    seg = [];
  };
  points.forEach((p, i) => { if (p.val === null || p.val === undefined) fin(); else seg.push(X(i).toFixed(1) + "," + Y(p.val).toFixed(1)); });
  fin();
  points.forEach((p, i) => {
    if (p.val === null || p.val === undefined) return;
    svg.append(svgEl("circle", { cx: X(i).toFixed(1), cy: Y(p.val).toFixed(1), r: 3, fill: COULEURS[p.niveau] || "#003087", stroke: "#fff", "stroke-width": 1 }));
  });
  const pas = Math.max(1, Math.ceil(n / 6));
  points.forEach((p, i) => {
    const montrer = i % pas === 0 || (i === n - 1 && (n - 1) % pas >= pas * 0.6);
    if (montrer) svg.append(svgEl("text", { x: X(i), y: H - 9, "text-anchor": "middle", "font-size": 9, fill: "#5b6577" }, p.lib));
  });
  return enveloppeGraphique(titre, svg, legende, points, o.decimales || 0);
}

/* ---------- Export CSV (séparateur « ; » et BOM UTF-8 : s'ouvre correctement dans Excel en français) ---------- */
function cellule(v) {
  if (v === null || v === undefined) return "";
  let t = typeof v === "number" ? String(v).replace(".", ",") : String(v);
  if (/^[=+\-@\t\r]/.test(t) && typeof v !== "number") t = "'" + t; // neutralise les formules injectées dans un commentaire
  return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
function construireCsv(lignes, colonnes) {
  const entete = colonnes.map(([, titre]) => cellule(titre)).join(";");
  return "﻿" + [entete, ...lignes.map((l) => colonnes.map(([cle]) => cellule(typeof cle === "function" ? cle(l) : l[cle])).join(";"))].join("\r\n");
}
function telecharger(nom, contenu) {
  const url = URL.createObjectURL(new Blob([contenu], { type: "text/csv;charset=utf-8" }));
  const a = el("a", { href: url, download: nom });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/* ---------- Lecture des données (par pages de 1000 lignes : limite de Supabase) ---------- */
async function lireTout(table, colonnes, depuis, athleteId) {
  const lignes = [], pas = 1000;
  for (let d = 0; ; d += pas) {
    let q = sb.from(table).select(colonnes).order("date", { ascending: true }).order("id", { ascending: true }).range(d, d + pas - 1);
    if (depuis) q = q.gte("date", depuis);
    if (athleteId) q = q.eq("athlete_id", athleteId);
    const { data, error } = await q;
    if (error) throw error;
    lignes.push(...data);
    if (data.length < pas) break;
  }
  return lignes;
}
async function chargerDonneesAthlete(id) {
  const depuis = jourPlus(dateLocale(), -SEUILS.fenetreJours);
  const [seances, be, tests] = await Promise.all([
    lireTout("seances", "date, sport, categorie, duree_min, rpe, charge_ua, commentaire", depuis, id),
    lireTout("bien_etre", "date, sommeil, energie, douleurs, stress, humeur, score_total, commentaire", depuis, id),
    lireTout("tests", "date, type_test, valeur, valeur2", depuis, id).catch(() => [])
  ]);
  return { seances, be, tests };
}

/* ---------- Affichage des alertes ---------- */
function carteAlerte(a, avecPiste) {
  return el("div", { class: "alerte-niv niv-" + a.niveau }, [
    el("strong", { text: a.titre }),
    a.detail ? el("div", { class: "petit", text: a.detail }) : "",
    avecPiste && a.piste ? el("div", { class: "piste", text: "Piste : " + a.piste }) : ""
  ]);
}
function pastilleNiveau(niveau, texte) { return el("span", { class: "pastille-niv niv-" + niveau, text: texte }); }

// Bloc d'alertes de l'accueil
async function chargerAlertes(profil, zone) {
  try {
    const d = await chargerDonneesAthlete(profil.id);
    const aujourdhui = dateLocale(), an = analyserTout(d.seances, d.be, d.tests, aujourdhui);
    const blocs = [];
    if (!an.dernier || an.dernier.date !== aujourdhui) blocs.push(el("div", { class: "avertissement", text: "Pense à saisir ton bien-être du matin." }));
    const vraies = an.alertes.filter((x) => x.code !== "aucune_saisie");
    for (const a of vraies.slice(0, 3)) blocs.push(carteAlerte(a, false));
    if (vraies.some((x) => x.niveau !== "info")) blocs.push(el("p", { class: "petit", text: "Ces repères ne sont pas un diagnostic. Si cela te préoccupe ou si une douleur dure, parles-en à ton staff ou consulte un professionnel de santé." }));
    zone.replaceChildren(...blocs);
  } catch (err) { zone.replaceChildren(); }
}

/* ---------- Écran : suivi d'un athlète (graphiques, alertes, export) ---------- */
// afficher : profil de l'athlète ; utilisateur : profil connecté ; retour : fonction de retour ; vueStaff : affiche les pistes de décision
async function ecranSuivi(afficher, utilisateur, retour, vueStaff = false) {
  racine.replaceChildren(enTete(vueStaff ? afficher.nom || "Athlète" : "Mon suivi", retour), el("p", { class: "chargement", text: "Chargement des données…" }));
  let d;
  try { d = await chargerDonneesAthlete(afficher.id); }
  catch (err) {
    racine.replaceChildren(enTete("Mon suivi", retour), el("div", { class: "carte" }, [
      el("p", { text: erreurReseau(err) ? "Pas de connexion : le suivi a besoin du réseau." : messageErreur(err) }),
      el("button", { class: "btn", type: "button", text: "Réessayer", onclick: () => ecranSuivi(afficher, utilisateur, retour, vueStaff) })
    ]));
    return;
  }
  const aujourdhui = dateLocale(), an = analyserTout(d.seances, d.be, d.tests, aujourdhui), premiere = premiereDate(d.seances);
  const ecran = [enTete(vueStaff ? (afficher.nom || "Athlète") : "Mon suivi", retour)];

  // Résumé
  const a = an.acwr;
  const tuileChiffre = (titre, valeur, sous, niveau) => el("div", { class: "chiffre" + (niveau ? " niv-" + niveau : "") }, [
    el("small", { text: titre }), el("strong", { text: valeur }), el("small", { text: sous })]);
  ecran.push(el("section", { class: "carte" }, [
    vueStaff ? el("p", { class: "petit", text: [afficher.groupe, afficher.sport_principal].filter(Boolean).join(" · ") }) : "",
    el("div", { class: "grille-chiffres" }, [
      tuileChiffre("ACWR", fr(a.acwr), a.niveau === "insuffisant" ? "pas assez d'historique" : a.acwr < SEUILS.acwrVertMin ? "bas" : { vert: "zone habituelle", orange: "en hausse", rouge: "très élevé" }[a.niveau], a.niveau),
      tuileChiffre("Charge 7 jours", String(an.charge7) + " UA", "cumul des 7 derniers jours"),
      tuileChiffre("Vs semaine d'avant", an.rapport === null ? "–" : (an.rapport >= 1 ? "+" : "") + Math.round((an.rapport - 1) * 100) + " %", "semaine d'avant : " + an.precedente + " UA",
        an.rapport === null ? "" : an.rapport > SEUILS.hausseRouge ? "rouge" : an.rapport > SEUILS.hausseOrange ? "orange" : "vert"),
      tuileChiffre("Charge habituelle", fr(a.chronique, 0) + " UA", "moyenne par semaine sur 28 jours"),
      tuileChiffre("Dernier bien-être", an.dernier ? an.dernier.score_total + "/25" : "–", an.dernier ? dateFr(an.dernier.date) : "aucune saisie", an.dernier ? niveauScore(an.dernier.score_total) : ""),
      tuileChiffre("Douleurs", an.dernier ? an.dernier.douleurs + "/5" : "–", "5 = aucune douleur", an.dernier ? (an.dernier.douleurs <= SEUILS.douleurRouge ? "rouge" : an.dernier.douleurs <= SEUILS.douleurOrange ? "orange" : "vert") : "")
    ]),
    el("p", { class: "petit", text: "ACWR = charge des 7 derniers jours ÷ charge hebdomadaire moyenne des 28 derniers jours (charge = durée × RPE). Il faut au moins 3 semaines de saisies. Repères de discussion, pas un diagnostic ni une prédiction de blessure." })
  ]));

  // Alertes
  const carteAl = el("section", { class: "carte" }, [el("h2", { text: "Alertes" })]);
  if (!an.alertes.length) carteAl.append(el("p", { class: "petit", text: "Aucune alerte pour le moment." }));
  for (const al of an.alertes) carteAl.append(carteAlerte(al, vueStaff));
  if (!vueStaff && an.alertes.some((x) => x.niveau !== "info")) carteAl.append(el("p", { class: "petit", text: "Si cela te préoccupe ou si une douleur dure, parles-en à ton staff ou consulte un professionnel de santé." }));
  ecran.push(carteAl);
  ecran.push(...sectionTests(an.tests, aujourdhui, vueStaff));

  // Graphiques
  ecran.push(graphBarres("Charge hebdomadaire (UA, 8 semaines)", serieHebdo(an.map, aujourdhui), []));
  ecran.push(graphLigne("ACWR (6 dernières semaines)", serieACWR(an.map, premiere, aujourdhui), {
    min: 0, max: 2.5, graduations: [0, 0.8, 1.3, 1.5, 2.5], decimales: 2,
    bandes: [
      { de: 0, a: 0.8, couleur: "#fff0de" }, { de: 0.8, a: 1.3, couleur: "#e3f4e8" },
      { de: 1.3, a: 1.5, couleur: "#fff0de" }, { de: 1.5, a: 2.5, couleur: "#fde3e5" }
    ]
  }, [{ couleur: COULEURS.orange, texte: "< 0,8 bas" }, { couleur: COULEURS.vert, texte: "0,8 à 1,3" }, { couleur: COULEURS.orange, texte: "1,3 à 1,5" }, { couleur: COULEURS.rouge, texte: "> 1,5" }]));

  const zoneBE = el("div");
  const selIndic = el("select", { id: "indic" }, [
    ["score_total", "Score total (sur 25)"], ["sommeil", "Sommeil"], ["energie", "Énergie"], ["douleurs", "Douleurs (5 = aucune)"], ["stress", "Stress (5 = aucun)"], ["humeur", "Humeur"]
  ].map(([v, t]) => el("option", { value: v, text: t })));
  function dessinerBE() {
    const champ = selIndic.value, total = champ === "score_total";
    zoneBE.replaceChildren(graphLigne("Bien-être (30 derniers jours)", serieBienEtre(d.be, aujourdhui, champ), total
      ? { min: 5, max: 25, graduations: [5, 10, 15, 20, 25], decimales: 0, bandes: [{ de: 5, a: 12.5, couleur: "#fde3e5" }, { de: 12.5, a: 15.5, couleur: "#fff0de" }, { de: 15.5, a: 19.5, couleur: "#fff9db" }, { de: 19.5, a: 25, couleur: "#e3f4e8" }] }
      : { min: 1, max: 5, graduations: [1, 2, 3, 4, 5], decimales: 0, bandes: [{ de: 1, a: 2, couleur: "#fff0de" }, { de: 2, a: 5, couleur: "#e3f4e8" }] },
      total ? [{ couleur: COULEURS.rouge, texte: "≤ 12" }, { couleur: COULEURS.orange, texte: "13 à 15" }, { couleur: COULEURS.jaune, texte: "16 à 19" }, { couleur: COULEURS.vert, texte: "≥ 20" }] : [{ couleur: COULEURS.vert, texte: "5 = le mieux" }]));
  }
  selIndic.addEventListener("change", dessinerBE);
  dessinerBE();
  ecran.push(el("section", { class: "carte" }, [el("label", { for: "indic", text: "Indicateur de bien-être affiché" }), selIndic]), zoneBE);

  // Commentaires récents
  const coms = [...d.be.map((x) => ({ date: x.date, type: "Bien-être", texte: x.commentaire })), ...d.seances.map((x) => ({ date: x.date, type: "Séance", texte: x.commentaire }))]
    .filter((x) => x.texte).sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 6);
  if (coms.length) ecran.push(el("section", { class: "carte" }, [el("h2", { text: "Derniers commentaires" }),
    el("ul", { class: "liste" }, coms.map((x) => el("li", { text: dateFr(x.date) + " (" + x.type + ") : " + x.texte })))]));

  // Export
  const nomFichier = (base) => base + (vueStaff ? "_" + (afficher.nom || "athlete").replace(/[^a-z0-9]+/gi, "-").toLowerCase() : "") + "_" + aujourdhui + ".csv";
  const carteExport = el("section", { class: "carte" }, [el("h2", { text: "Exporter (CSV)" }),
    el("p", { class: "petit", text: "Fichiers complets (toute la période), lisibles dans Excel." }),
    boutonExport("Exporter les séances", () => exporterAthlete("seances", afficher, nomFichier("seances"))),
    boutonExport("Exporter le bien-être", () => exporterAthlete("bien_etre", afficher, nomFichier("bien-etre"))),
    boutonExport("Exporter les tests", () => exporterAthlete("tests", afficher, nomFichier("tests")))]);
  if (!vueStaff && afficher.sexe === "F") carteExport.append(boutonExport("Exporter mon cycle", () => exporterAthlete("cycle_menstruel", afficher, nomFichier("cycle"))));
  ecran.push(carteExport);
  racine.replaceChildren(...ecran);
  window.scrollTo(0, 0);
}

function boutonExport(texte, action) {
  const b = el("button", { class: "btn btn-secondaire", type: "button", text: texte });
  b.addEventListener("click", async () => {
    b.disabled = true;
    try { await action(); afficherMessage("Fichier prêt.", "succes"); }
    catch (err) { afficherMessage(erreurReseau(err) ? "Pas de connexion : export impossible." : messageErreur(err), "erreur"); }
    b.disabled = false;
  });
  return b;
}

const COLONNES_EXPORT = {
  seances: [["date", "Date"], ["sport", "Sport"], ["categorie", "Type de séance"], ["duree_min", "Durée (min)"], ["rpe", "RPE"], ["charge_ua", "Charge (UA)"], ["volume_course_m", "Volume course (m)"], ["commentaire", "Commentaire"]],
  bien_etre: [["date", "Date"], ["sommeil", "Sommeil"], ["energie", "Énergie"], ["douleurs", "Douleurs"], ["stress", "Stress"], ["humeur", "Humeur"], ["score_total", "Score total"], ["commentaire", "Commentaire"]],
  cycle_menstruel: [["date", "Date"], ["phase", "Phase"], ["gene_symptomes", "Gêne (5 = aucune)"]],
  tests: [["date", "Date"], [(l) => LIB_TESTS[l.type_test] || l.type_test, "Test"], ["valeur", "Résultat (CMJ cm · RMSSD ms · sprint s)"],
    ["valeur2", "Valeur 2 (moyenne essais · FC repos bpm)"], [(l) => UNITE_TESTS[l.type_test] || "", "Unité"], [(l) => (l.details ? JSON.stringify(l.details) : ""), "Détails"], ["commentaire", "Commentaire"]]
};
async function exporterAthlete(table, athlete, nom) {
  const cols = table === "tests" ? "date, type_test, valeur, valeur2, details, commentaire" : COLONNES_EXPORT[table].map(([c]) => c).join(", ");
  const lignes = await lireTout(table, cols, null, athlete.id);
  telecharger(nom, construireCsv(lignes, COLONNES_EXPORT[table]));
}

/* ---------- Tableau de bord staff ---------- */
let donneesStaff = null;
async function chargerDonneesStaff(forcer = false) {
  if (!forcer && donneesStaff && Date.now() - donneesStaff.t < 120000) return donneesStaff;
  const depuis = jourPlus(dateLocale(), -SEUILS.fenetreJours);
  const [prof, se, be, te] = await Promise.all([
    sb.from("profiles").select("id, nom, groupe, sport_principal, sexe, consentement_at").eq("role", "athlete").order("nom"),
    lireTout("seances", "athlete_id, date, charge_ua", depuis),
    lireTout("bien_etre", "athlete_id, date, sommeil, energie, douleurs, stress, humeur, score_total", depuis),
    lireTout("tests", "athlete_id, date, type_test, valeur, valeur2", depuis).catch(() => [])
  ]);
  if (prof.error) throw prof.error;
  const grouper = (l) => { const m = new Map(); for (const x of l) { if (!m.has(x.athlete_id)) m.set(x.athlete_id, []); m.get(x.athlete_id).push(x); } return m; };
  const mS = grouper(se), mB = grouper(be), mT = grouper(te), aujourdhui = dateLocale();
  const athletes = prof.data.filter((p) => p.consentement_at).map((p) => {
    const seances = mS.get(p.id) || [], bien = mB.get(p.id) || [], tst = mT.get(p.id) || [];
    return { ...p, seances, be: bien, tests: tst, analyse: analyserTout(seances, bien, tst, aujourdhui) };
  });
  donneesStaff = { t: Date.now(), athletes, seances: se, be, aujourdhui };
  return donneesStaff;
}

async function ecranTableauStaff(profil, forcer = false) {
  racine.replaceChildren(enTete("Tableau de bord staff", demarrer), el("p", { class: "chargement", text: "Chargement de l'équipe…" }));
  let D;
  try { D = await chargerDonneesStaff(forcer); }
  catch (err) {
    racine.replaceChildren(enTete("Tableau de bord staff", demarrer), el("div", { class: "carte" }, [
      el("p", { text: erreurReseau(err) ? "Pas de connexion : le tableau de bord a besoin du réseau." : messageErreur(err) }),
      el("button", { class: "btn", type: "button", text: "Réessayer", onclick: () => ecranTableauStaff(profil, true) })
    ]));
    return;
  }
  const { athletes, aujourdhui } = D;
  const rouges = athletes.filter((x) => x.analyse.niveau === "rouge").length;
  const oranges = athletes.filter((x) => x.analyse.niveau === "orange").length;
  const jaunes = athletes.filter((x) => x.analyse.niveau === "jaune").length;
  const sansAlerte = athletes.filter((x) => x.analyse.niveau === "ok").length;
  const sansSaisie = athletes.filter((x) => x.analyse.alertes.some((a) => a.code === "sans_saisie" || a.code === "aucune_saisie")).length;
  const tuile = (titre, v, niveau) => el("div", { class: "chiffre" + (niveau ? " niv-" + niveau : "") }, [el("small", { text: titre }), el("strong", { text: String(v) })]);
  const ecran = [enTete("Tableau de bord staff", demarrer),
    el("section", { class: "carte" }, [
      el("div", { class: "grille-chiffres" }, [tuile("Athlètes suivis", athletes.length), tuile("Rouge", rouges, rouges ? "rouge" : ""), tuile("Orange", oranges, oranges ? "orange" : ""), tuile("Jaune", jaunes, jaunes ? "jaune" : ""), tuile("Sans alerte", sansAlerte, sansAlerte ? "vert" : ""), tuile("Sans bien-être ≥ 3 j", sansSaisie)]),
      el("p", { class: "petit", text: "Mis à jour à " + new Date(D.t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) + ". Repères de discussion, pas des diagnostics." }),
      el("button", { class: "btn btn-secondaire", type: "button", text: "Actualiser", onclick: () => ecranTableauStaff(profil, true) })
    ])];

  // Filtres et liste
  const groupes = [...new Set(athletes.map((x) => x.groupe).filter(Boolean))].sort();
  const selGroupe = el("select", { id: "f-groupe" }, [el("option", { value: "", text: "Tous les groupes" }), ...groupes.map((g) => el("option", { value: g, text: g }))]);
  const caseAl = el("input", { type: "checkbox", id: "f-alertes" });
  const liste = el("div");
  const rang = { rouge: 0, orange: 1, jaune: 2, ok: 3 };
  function dessinerListe() {
    const vus = athletes.filter((x) => (!selGroupe.value || x.groupe === selGroupe.value) && (!caseAl.checked || x.analyse.niveau !== "ok"))
      .sort((x, y) => rang[x.analyse.niveau] - rang[y.analyse.niveau] || (x.nom || "").localeCompare(y.nom || "", "fr"));
    if (!vus.length) { liste.replaceChildren(el("p", { class: "petit", text: athletes.length ? "Aucun athlète ne correspond." : "Aucun athlète n'a encore accepté le consentement." })); return; }
    liste.replaceChildren(...vus.map((x) => {
      const an = x.analyse, nbAl = an.alertes.filter((a) => a.niveau !== "info").length;
      const b = el("button", { type: "button", class: "ligne-athlete niv-" + an.niveau }, [
        el("div", { class: "ligne-haut" }, [el("strong", { text: x.nom || "Sans nom" }), pastilleNiveau(an.acwr.niveau, "ACWR " + fr(an.acwr.acwr))]),
        el("div", { class: "petit", text: [x.groupe, x.sport_principal].filter(Boolean).join(" · ") }),
        el("div", { class: "petit", text: "7 j : " + an.charge7 + " UA · bien-être " + (an.dernier ? an.dernier.score_total + "/25 (" + dateFr(an.dernier.date) + ")" : "aucune saisie") + (an.tests && an.tests.resume ? " · " + an.tests.resume : "") + (nbAl ? " · " + nbAl + " alerte(s)" : "") })
      ]);
      b.addEventListener("click", () => ecranSuivi(x, profil, () => ecranTableauStaff(profil), true));
      return b;
    }));
  }
  selGroupe.addEventListener("change", dessinerListe); caseAl.addEventListener("change", dessinerListe);
  dessinerListe();
  ecran.push(el("section", { class: "carte" }, [el("h2", { text: "Athlètes" }), el("label", { for: "f-groupe", text: "Groupe" }), selGroupe,
    el("div", { class: "ligne-case" }, [caseAl, el("label", { for: "f-alertes", text: "Afficher seulement les athlètes en alerte" })]), liste]));

  // Tendances collectives
  const actifs = athletes.filter((x) => x.seances.length).length || 1;
  const toutes = athletes.flatMap((x) => x.seances), mapCol = chargesParJour(toutes);
  ecran.push(graphBarres("Charge hebdomadaire moyenne par athlète (UA)", serieHebdo(mapCol, aujourdhui).map((p) => ({ lib: p.lib, val: Math.round(p.val / actifs) })), []));
  const parJour = new Map();
  for (const x of athletes.flatMap((a) => a.be)) { const e = parJour.get(x.date) || { t: 0, n: 0 }; e.t += x.score_total; e.n++; parJour.set(x.date, e); }
  const serieCol = serieBienEtre([], aujourdhui, "score_total").map((p, i, arr) => {
    const j = jourPlus(aujourdhui, -(arr.length - 1 - i)), e = parJour.get(j);
    return { lib: p.lib, val: e ? Math.round((e.t / e.n) * 10) / 10 : null };
  });
  ecran.push(graphLigne("Bien-être moyen du groupe (score sur 25, 30 jours)", serieCol, { min: 5, max: 25, graduations: [5, 10, 15, 20, 25], decimales: 1,
    bandes: [{ de: 5, a: 12.5, couleur: "#fde3e5" }, { de: 12.5, a: 15.5, couleur: "#fff0de" }, { de: 15.5, a: 19.5, couleur: "#fff9db" }, { de: 19.5, a: 25, couleur: "#e3f4e8" }] }, []));

  // Exports collectifs
  const noms = new Map(athletes.map((x) => [x.id, x]));
  const colAth = [[(l) => (noms.get(l.athlete_id) || {}).nom, "Athlète"], [(l) => (noms.get(l.athlete_id) || {}).groupe, "Groupe"]];
  const exportTout = async (table, nom, titreCycle) => {
    const cols = ["athlete_id", ...COLONNES_EXPORT[table].map(([c]) => c)].join(", ");
    const lignes = await lireTout(table, cols, null, null);
    telecharger(nom + "_" + aujourdhui + ".csv", construireCsv(lignes, [...colAth, ...COLONNES_EXPORT[table]]));
  };
  ecran.push(el("section", { class: "carte" }, [el("h2", { text: "Exporter toute l'équipe (CSV)" }),
    el("p", { class: "petit", text: "Fichiers complets, lisibles dans Excel. Le cycle n'apparaît que pour les athlètes qui ont activé le partage." }),
    boutonExport("Résumé du jour (ACWR et alertes)", async () => {
      const lignes = athletes.map((x) => ({ x, an: x.analyse }));
      telecharger("resume_equipe_" + aujourdhui + ".csv", construireCsv(lignes, [
        [(l) => l.x.nom, "Athlète"], [(l) => l.x.groupe, "Groupe"], [(l) => l.x.sport_principal, "Sport"],
        [(l) => (l.an.acwr.acwr === null ? "" : Math.round(l.an.acwr.acwr * 100) / 100), "ACWR"], [(l) => l.an.acwr.niveau, "Niveau ACWR"],
        [(l) => l.an.charge7, "Charge 7 j (UA)"], [(l) => Math.round(l.an.acwr.chronique), "Charge hebdo moyenne 28 j (UA)"],
        [(l) => (l.an.dernier ? l.an.dernier.score_total : ""), "Dernier bien-être (/25)"], [(l) => (l.an.dernier ? l.an.dernier.date : ""), "Date dernier bien-être"],
        [(l) => l.an.alertes.map((a) => a.titre).join(" | "), "Alertes"]]));
    }),
    boutonExport("Toutes les séances", () => exportTout("seances", "seances_equipe")),
    boutonExport("Tout le bien-être", () => exportTout("bien_etre", "bien-etre_equipe")),
    boutonExport("Cycle (athlètes qui partagent)", () => exportTout("cycle_menstruel", "cycle_partage_equipe"))]));
  racine.replaceChildren(...ecran);
  window.scrollTo(0, 0);
}
