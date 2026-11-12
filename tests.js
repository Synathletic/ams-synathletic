/* =====================================================================
   Athlete Monitoring System Syn'Athlétic — Tests de forme : CMJ, HRV + FC de repos, sprint 30 m
   et lecture croisée avec la charge (ACWR) et le bien-être.
   Les seuils ci-dessous sont modifiables. Ce sont des repères de travail
   à ajuster avec vos propres données, pas des diagnostics.
   Signé Syn'Athlétic / Alexandre GERBER
   ===================================================================== */
const SEUILS_TESTS = {
  // HRV (RMSSD, analysé en logarithme népérien)
  hrvMinRef: 10,          // mesures nécessaires pour fixer la référence personnelle (60 jours avant la semaine en cours)
  hrvMinSemaine: 3,       // mesures minimum sur les 7 derniers jours pour calculer la moyenne de la semaine
  hrvFenetreRef: 60,      // durée de la référence, en jours
  swcFacteur: 0.5,        // changement notable = 0,5 × écart-type personnel du ln(RMSSD)
  fcHausseBpm: 5,         // FC de repos au moins 5 bpm au-dessus de la référence = signal
  // CMJ : écart de la dernière hauteur par rapport à la moyenne des 5 tests précédents
  cmjJaune: -0.05, cmjOrange: -0.10, cmjNbRef: 5,
  // Sprint 30 m : écart du dernier temps (plus lent = positif)
  sprintJaune: 0.02, sprintOrange: 0.04, sprintNbRef: 5,
  // Ancienneté maximale (jours) pour qu'un test déclenche une alerte
  fraicheur: { hrv: 3, cmj: 14, sprint: 21 },
  // Lecture croisée : nombre de signaux qui convergent
  convOrange: 2, convRouge: 3,
  joursBienEtre: 2        // le bien-être compte s'il date d'au plus 2 jours
};
const LIB_TESTS = { cmj_cm: "CMJ", hrv_rmssd_ms: "HRV + FC de repos", sprint_30m_s: "Sprint 30 m", autre: "Autre" };
const UNITE_TESTS = { cmj_cm: "cm", hrv_rmssd_ms: "ms", sprint_30m_s: "s", autre: "" };

/* ---------- Petits outils ---------- */
function moy(t) { return t.length ? t.reduce((a, b) => a + b, 0) / t.length : null; }
function ecartType(t) { if (t.length < 2) return null; const m = moy(t); return Math.sqrt(t.reduce((a, b) => a + (b - m) * (b - m), 0) / (t.length - 1)); }
function pct(x) { return (x >= 0 ? "+" : "−") + Math.abs(Math.round(x * 100)) + " %"; }
function arrondi(x, d) { const k = Math.pow(10, d); return Math.round(x * k) / k; }
// Lit un nombre saisi avec une virgule ou un point. Renvoie null si vide, NaN si invalide.
function parseNombre(t) { const s = String(t === undefined || t === null ? "" : t).trim().replace(",", "."); if (s === "") return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; }
function texteTest(t) {
  if (t.type_test === "cmj_cm") return "CMJ " + fr(Number(t.valeur), 1) + " cm";
  if (t.type_test === "hrv_rmssd_ms") return "HRV " + fr(Number(t.valeur), 0) + " ms · FC " + (t.valeur2 == null ? "–" : fr(Number(t.valeur2), 0)) + " bpm";
  if (t.type_test === "sprint_30m_s") return "Sprint 30 m " + fr(Number(t.valeur), 2) + " s";
  return "Test " + fr(Number(t.valeur), 2);
}

/* ---------- Analyse ---------- */
// Regroupe les tests par jour : une valeur par date et par type
function seriesTests(tests) {
  const par = (type) => {
    const m = new Map();
    for (const t of tests) if (t.type_test === type) { if (!m.has(t.date)) m.set(t.date, []); m.get(t.date).push(t); }
    return [...m.keys()].sort().map((d) => {
      const l = m.get(d);
      return { date: d, valeur: moy(l.map((x) => Number(x.valeur))), valeur2: moy(l.filter((x) => x.valeur2 !== null && x.valeur2 !== undefined).map((x) => Number(x.valeur2))) };
    });
  };
  return { hrv: par("hrv_rmssd_ms"), cmj: par("cmj_cm"), sprint: par("sprint_30m_s") };
}

function analyserHRV(h, auj) {
  if (!h.length) return null;
  const S = SEUILS_TESTS;
  const pts = h.map((x) => ({ date: x.date, rmssd: x.valeur, fc: x.valeur2, ln: Math.log(x.valeur) }));
  const dernier = pts[pts.length - 1], age = ecartJours(dernier.date, auj);
  const sem = pts.filter((x) => { const e = ecartJours(x.date, auj); return e >= 0 && e <= 6; });
  const ref = pts.filter((x) => { const e = ecartJours(x.date, auj); return e >= 7 && e <= 6 + S.hrvFenetreRef; });
  const r = { pts, dernier, age, nSem: sem.length, nRef: ref.length, statut: "indetermine", lnSem: null, lnRef: null, swc: null, sd: null, ecartPct: null, fcRef: null, fcEcart: null, fcHaute: null };
  if (sem.length >= S.hrvMinSemaine) r.lnSem = moy(sem.map((x) => x.ln));
  if (ref.length >= S.hrvMinRef) {
    r.sd = Math.max(ecartType(ref.map((x) => x.ln)), 0.03);
    r.lnRef = moy(ref.map((x) => x.ln));
    r.swc = S.swcFacteur * r.sd;
  }
  if (r.lnSem !== null && r.lnRef !== null) {
    const d = r.lnSem - r.lnRef;
    r.statut = d < -r.swc ? "bas" : d > r.swc ? "haut" : "normal";
    r.ecartPct = Math.exp(d) - 1;
  }
  const fcs = ref.map((x) => x.fc).filter((v) => v !== null && v !== undefined);
  if (fcs.length >= S.hrvMinRef) {
    r.fcRef = moy(fcs);
    if (dernier.fc !== null && dernier.fc !== undefined) {
      r.fcEcart = dernier.fc - r.fcRef;
      r.fcHaute = age <= S.fraicheur.hrv && r.fcEcart >= S.fcHausseBpm;
    }
  }
  return r;
}

// sens = +1 : plus grand = mieux (CMJ) ; sens = -1 : plus petit = mieux (sprint)
function analyserPerf(pts, auj, nbRef, sens) {
  if (!pts.length) return null;
  const dernier = pts[pts.length - 1], precedents = pts.slice(0, -1).slice(-nbRef), vals = pts.map((p) => p.valeur);
  const r = { pts, dernier, age: ecartJours(dernier.date, auj), ref: null, ecart: null, nRef: precedents.length, meilleur: sens > 0 ? Math.max(...vals) : Math.min(...vals) };
  if (precedents.length >= 2) { r.ref = moy(precedents.map((p) => p.valeur)); r.ecart = dernier.valeur / r.ref - 1; }
  return r;
}

// Lecture croisée : combien d'indicateurs indépendants vont dans le même sens ?
function lectureCroisee(R, be, an, auj) {
  const S = SEUILS_TESTS, sig = [];
  const { hrv, cmj, sprint } = R;
  if (hrv && hrv.statut !== "indetermine" && hrv.age <= S.fraicheur.hrv + 4) sig.push({ cle: "hrv", texte: "HRV en baisse sur 7 jours", actif: hrv.statut === "bas", bon: "HRV stable ou en hausse" });
  if (hrv && hrv.fcHaute !== null) sig.push({ cle: "fc", texte: "FC de repos élevée", actif: !!hrv.fcHaute, bon: "FC de repos normale" });
  if (cmj && cmj.ecart !== null && cmj.age <= S.fraicheur.cmj) sig.push({ cle: "cmj", texte: "CMJ en baisse (" + pct(cmj.ecart) + ")", actif: cmj.ecart <= S.cmjJaune, bon: "CMJ stable" });
  if (sprint && sprint.ecart !== null && sprint.age <= S.fraicheur.sprint) sig.push({ cle: "sprint", texte: "Sprint 30 m plus lent (" + pct(sprint.ecart) + ")", actif: sprint.ecart >= S.sprintJaune, bon: "Sprint 30 m stable" });
  const dernierBE = be.length ? be[be.length - 1] : null;
  if (dernierBE && ecartJours(dernierBE.date, auj) <= S.joursBienEtre) sig.push({ cle: "be", texte: "Bien-être bas (" + dernierBE.score_total + "/25)", actif: dernierBE.score_total <= SEUILS.scoreOrange, bon: "Bien-être correct" });
  const chargeHaute = (an.acwr.acwr !== null && an.acwr.acwr > SEUILS.acwrVertMax) || (an.rapport !== null && an.rapport > SEUILS.hausseRouge);
  const monoHaute = !!(an.mono && (an.mono.niveau === "orange" || an.mono.niveau === "rouge"));
  const actifs = sig.filter((x) => x.actif), n = actifs.length, m = sig.length;
  const aTest = sig.some((x) => x.actif && x.cle !== "be");
  const r = { signaux: sig, n, m, chargeHaute, monoHaute, niveau: "insuffisant", titre: "", detail: "", piste: "" };
  if (m < 2) {
    r.titre = "Pas encore assez de données croisées";
    r.detail = "Il faut au moins deux indicateurs récents (HRV, FC de repos, CMJ, sprint, bien-être) pour croiser les informations.";
    return r;
  }
  const liste = actifs.map((x) => x.texte).join(", ");
  if (n === 0) {
    r.niveau = "vert"; r.titre = "Aucun signal de fatigue sur les indicateurs mesurés";
    r.detail = sig.map((x) => x.bon).join(" · ") + ".";
    r.piste = chargeHaute ? "La charge récente est élevée mais les indicateurs de récupération restent bons : maintenir le plan en surveillant la suite." : "Les indicateurs sont cohérents : le plan prévu peut être poursuivi.";
  } else if (n === 1) {
    r.niveau = "jaune"; r.titre = "Un signal à surveiller";
    r.detail = "Signal : " + liste + ". Les autres indicateurs restent normaux.";
    r.piste = "Un signal isolé n'est pas alarmant (la mesure du jour varie naturellement). Refaire la mesure et vérifier s'il se confirme.";
  } else {
    r.niveau = n >= S.convRouge ? "rouge" : "orange";
    r.titre = n + " indicateurs sur " + m + " vont dans le même sens : fatigue probable";
    r.detail = "Signaux : " + liste + ".";
    const neuro = actifs.some((x) => x.cle === "cmj" || x.cle === "sprint"), auto = actifs.some((x) => x.cle === "hrv" || x.cle === "fc");
    let p = n >= S.convRouge
      ? "Plusieurs indicateurs indépendants convergent : envisager d'alléger la prochaine séance intense (volume ou intensité), de privilégier sommeil et récupération, puis de refaire les tests dans 24 à 48 h."
      : "Deux indicateurs convergent : en parler avec l'athlète et refaire la mesure le lendemain avant de modifier le plan.";
    if (neuro && !auto) p += " Profil plutôt neuromusculaire (force, vitesse) : limiter la plyométrie et les sprints maximaux.";
    if (auto && !neuro) p += " Profil plutôt général (stress, sommeil, maladie, charge cumulée) : vérifier les symptômes d'infection et la qualité du sommeil.";
    if (chargeHaute) p += " La charge récente est élevée, ce qui peut expliquer ces signaux.";
    if (actifs.some((x) => x.cle === "hrv") && actifs.some((x) => x.cle === "fc")) p += " En cas de fièvre ou de symptômes inhabituels, pas d'effort intense et avis médical.";
    r.piste = p;
  }
  if (monoHaute && n >= 1) r.piste += " La charge des 7 derniers jours est très uniforme (monotonie " + fr(an.mono.monotonie) + ") : varier davantage jours durs, faciles et repos peut aider la récupération.";
  else if (monoHaute && n === 0) r.piste += " Attention cependant : la monotonie de la charge est élevée (" + fr(an.mono.monotonie) + "), à corriger en variant les jours durs et faciles.";
  r.alerte = aTest && n >= S.convOrange;
  return r;
}

function analyserTests(tests, be, an, auj) {
  const S = SEUILS_TESTS, s = seriesTests(tests || []);
  const hrv = analyserHRV(s.hrv, auj), cmj = analyserPerf(s.cmj, auj, S.cmjNbRef, 1), sprint = analyserPerf(s.sprint, auj, S.sprintNbRef, -1);
  const alertes = [];
  const ajouter = (niveau, code, titre, detail, piste) => alertes.push({ niveau, code, titre, detail, piste });
  if (hrv && hrv.statut === "bas") ajouter("jaune", "hrv_bas", "HRV en baisse sur 7 jours",
    "RMSSD moyen de la semaine : " + fr(Math.exp(hrv.lnSem), 0) + " ms contre " + fr(Math.exp(hrv.lnRef), 0) + " ms de référence (" + pct(hrv.ecartPct) + ").",
    "Regarder sommeil, stress, maladie, alcool et charge récente. Une baisse isolée n'est pas alarmante : voir si elle se confirme et si la FC de repos monte.");
  if (hrv && hrv.fcHaute) ajouter("jaune", "fc_haute", "FC de repos élevée : " + fr(hrv.dernier.fc, 0) + " bpm",
    "Référence personnelle : " + fr(hrv.fcRef, 0) + " bpm (+" + fr(hrv.fcEcart, 0) + " bpm).",
    "Une FC de repos plus haute peut accompagner fatigue, manque de sommeil ou début d'infection. Refaire la mesure le lendemain.");
  if (cmj && cmj.ecart !== null && cmj.age <= S.fraicheur.cmj && cmj.ecart <= S.cmjJaune) {
    const fort = cmj.ecart <= S.cmjOrange;
    ajouter(fort ? "orange" : "jaune", fort ? "cmj_orange" : "cmj_jaune", "CMJ en baisse : " + pct(cmj.ecart),
      "Dernier saut " + fr(cmj.dernier.valeur, 1) + " cm contre " + fr(cmj.ref, 1) + " cm en moyenne sur les tests précédents.",
      "Baisse de la puissance des jambes : vérifier la fatigue neuromusculaire, adapter la plyométrie et les séances très intenses, retester dans quelques jours dans les mêmes conditions.");
  }
  if (sprint && sprint.ecart !== null && sprint.age <= S.fraicheur.sprint && sprint.ecart >= S.sprintJaune) {
    const fort = sprint.ecart >= S.sprintOrange;
    ajouter(fort ? "orange" : "jaune", fort ? "sprint_orange" : "sprint_jaune", "Sprint 30 m plus lent : " + pct(sprint.ecart),
      "Dernier temps " + fr(sprint.dernier.valeur, 2) + " s contre " + fr(sprint.ref, 2) + " s en moyenne sur les tests précédents.",
      "Vérifier que les conditions de test étaient identiques (départ, chronométrage, surface, échauffement) avant d'en conclure à de la fatigue.");
  }
  const croise = lectureCroisee({ hrv, cmj, sprint }, be || [], an, auj);
  if (croise.alerte) ajouter(croise.niveau, "convergence", croise.titre, croise.detail, croise.piste);
  const bouts = [];
  if (hrv && hrv.statut !== "indetermine") bouts.push("HRV " + (hrv.statut === "bas" ? "↓" : hrv.statut === "haut" ? "↑" : "="));
  if (hrv && hrv.fcHaute) bouts.push("FC ↑");
  if (cmj && cmj.ecart !== null && cmj.age <= S.fraicheur.cmj) bouts.push("CMJ " + pct(cmj.ecart));
  return { hrv, cmj, sprint, croise, alertes, resume: bouts.join(" · "), aucun: !tests || !tests.length };
}

// Analyse complète : charge + bien-être + tests, alertes fusionnées
function analyserTout(seances, be, tests, auj) {
  const an = analyser(seances, be, auj);
  an.tests = analyserTests(tests, be, an, auj);
  if (an.tests.alertes.length) {
    an.alertes = an.alertes.concat(an.tests.alertes).sort((x, y) => ORDRE_NIVEAU[y.niveau] - ORDRE_NIVEAU[x.niveau]);
    an.niveau = an.alertes.some((x) => x.niveau === "rouge") ? "rouge" : an.alertes.some((x) => x.niveau === "orange") ? "orange" : an.alertes.some((x) => x.niveau === "jaune") ? "jaune" : "ok";
  }
  return an;
}

/* ---------- Affichage dans « Mon suivi » (athlète et staff) ---------- */
function echelleAuto(vals) {
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mn === mx) { mn -= 1; mx += 1; }
  const marge = (mx - mn) * 0.15; mn -= marge; mx += marge;
  const brut = (mx - mn) / 4, p = Math.pow(10, Math.floor(Math.log10(brut)));
  const pas = ([1, 2, 2.5, 5, 10].find((k) => k * p >= brut) || 10) * p;
  const a = Math.floor(mn / pas) * pas, b = Math.ceil(mx / pas) * pas, g = [];
  for (let v = a; v <= b + pas / 1e6 && g.length < 12; v += pas) g.push(Math.round(v * 1000) / 1000);
  return { min: a, max: b, graduations: g };
}

function sectionTests(at, auj, vueStaff) {
  const out = [], c = at.croise;
  const classe = c.niveau === "insuffisant" ? "insuffisant" : c.niveau;
  const carte = el("section", { class: "carte" }, [el("h2", { text: "Forme : lecture croisée" })]);
  carte.append(el("div", { class: "alerte-niv niv-" + classe }, [
    el("strong", { text: c.titre }),
    c.detail ? el("div", { class: "petit", text: c.detail }) : "",
    c.piste && (vueStaff || c.niveau !== "insuffisant") ? el("div", { class: "piste", text: (vueStaff ? "Piste : " : "") + c.piste }) : ""
  ]));
  if (c.signaux.length) carte.append(el("ul", { class: "liste" }, c.signaux.map((x) => el("li", { text: (x.actif ? "⚠ " : "✓ ") + (x.actif ? x.texte : x.bon) }))));
  carte.append(el("p", { class: "petit", text: "Plusieurs indicateurs indépendants qui vont dans le même sens sont plus fiables qu'une mesure isolée. Repères de discussion, pas un diagnostic." }));
  out.push(carte);
  if (at.aucun) {
    out.push(el("section", { class: "carte" }, [el("h2", { text: "Tests de forme" }), el("p", { class: "petit", text: "Aucun test enregistré pour le moment (CMJ, HRV + FC de repos, sprint 30 m)." })]));
    return out;
  }
  const tuile = (titre, valeur, sous, niveau) => el("div", { class: "chiffre" + (niveau ? " niv-" + niveau : "") }, [el("small", { text: titre }), el("strong", { text: valeur }), el("small", { text: sous })]);
  const t = [], h = at.hrv, cm = at.cmj, sp = at.sprint;
  if (h) {
    const base = h.lnSem !== null ? fr(Math.exp(h.lnSem), 0) + " ms" : fr(h.dernier.rmssd, 0) + " ms";
    const sous = h.lnRef === null ? "référence en cours (" + h.nRef + "/" + SEUILS_TESTS.hrvMinRef + " mesures)" : h.lnSem === null ? "moins de " + SEUILS_TESTS.hrvMinSemaine + " mesures cette semaine" : "réf. " + fr(Math.exp(h.lnRef), 0) + " ms · " + pct(h.ecartPct);
    t.push(tuile(h.lnSem !== null ? "HRV (RMSSD, moy. 7 j)" : "HRV (dernière mesure)", base, sous, h.statut === "bas" ? "jaune" : h.statut === "normal" ? "vert" : ""));
    t.push(tuile("FC de repos", h.dernier.fc == null ? "–" : fr(h.dernier.fc, 0) + " bpm", h.fcRef === null ? "référence en cours" : "réf. " + fr(h.fcRef, 0) + " bpm", h.fcHaute ? "jaune" : h.fcRef !== null && h.age <= SEUILS_TESTS.fraicheur.hrv ? "vert" : ""));
  }
  if (cm) t.push(tuile("CMJ", fr(cm.dernier.valeur, 1) + " cm", cm.ecart === null ? "meilleur : " + fr(cm.meilleur, 1) + " cm" : pct(cm.ecart) + " vs tests précédents", cm.ecart === null ? "" : cm.ecart <= SEUILS_TESTS.cmjOrange ? "orange" : cm.ecart <= SEUILS_TESTS.cmjJaune ? "jaune" : "vert"));
  if (sp) t.push(tuile("Sprint 30 m", fr(sp.dernier.valeur, 2) + " s", sp.ecart === null ? "meilleur : " + fr(sp.meilleur, 2) + " s" : pct(sp.ecart) + " vs tests précédents", sp.ecart === null ? "" : sp.ecart >= SEUILS_TESTS.sprintOrange ? "orange" : sp.ecart >= SEUILS_TESTS.sprintJaune ? "jaune" : "vert"));
  const carteT = el("section", { class: "carte" }, [el("h2", { text: "Tests de forme" }), el("div", { class: "grille-chiffres" }, t)]);
  const dates = [];
  if (h) dates.push("HRV " + dateFr(h.dernier.date));
  if (cm) dates.push("CMJ " + dateFr(cm.dernier.date));
  if (sp) dates.push("sprint " + dateFr(sp.dernier.date));
  carteT.append(el("p", { class: "petit", text: "Dernières mesures : " + dates.join(" · ") + ". Les écarts sont calculés par rapport à la référence personnelle de l'athlète, jamais à celle des autres." }));
  out.push(carteT);

  // Graphiques (une valeur par jour de test)
  if (h && h.pts.length >= 2) {
    const pts = h.pts.slice(-30), vals = pts.map((x) => x.rmssd), bandes = [], leg = [];
    if (h.lnRef !== null) {
      const bas = Math.exp(h.lnRef - h.swc), haut = Math.exp(h.lnRef + h.swc);
      vals.push(bas, haut); bandes.push({ de: bas, a: haut, couleur: "#e3f4e8" });
      leg.push({ couleur: COULEURS.vert, texte: "zone de référence (± changement notable)" });
    }
    const e = echelleAuto(vals);
    out.push(graphLigne("HRV : RMSSD (ms)", pts.map((x) => ({ lib: dateCourte(x.date), val: arrondi(x.rmssd, 1) })), { ...e, bandes, decimales: 0 }, leg));
    const fcp = pts.filter((x) => x.fc != null);
    if (fcp.length >= 2) {
      const fv = fcp.map((x) => x.fc), fb = [], fl = [];
      if (h.fcRef !== null) { fv.push(h.fcRef + SEUILS_TESTS.fcHausseBpm); fb.push({ de: h.fcRef - 20, a: h.fcRef + SEUILS_TESTS.fcHausseBpm, couleur: "#e3f4e8" }); fl.push({ couleur: COULEURS.vert, texte: "jusqu'à +" + SEUILS_TESTS.fcHausseBpm + " bpm de la référence" }); }
      out.push(graphLigne("FC de repos (bpm)", fcp.map((x) => ({ lib: dateCourte(x.date), val: arrondi(x.fc, 0) })), { ...echelleAuto(fv), bandes: fb, decimales: 0 }, fl));
    }
  }
  const graphPerf = (titre, d, dec, sens) => {
    if (!d || d.pts.length < 2) return;
    const pts = d.pts.slice(-20), vals = pts.map((x) => x.valeur), bandes = [], leg = [];
    if (d.ref !== null) {
      const lim = sens > 0 ? d.ref * (1 + SEUILS_TESTS.cmjJaune) : d.ref * (1 + SEUILS_TESTS.sprintJaune);
      vals.push(lim, d.ref);
      const e0 = echelleAuto(vals);
      if (sens > 0) bandes.push({ de: lim, a: e0.max, couleur: "#e3f4e8" }, { de: e0.min, a: lim, couleur: "#fff9db" });
      else bandes.push({ de: e0.min, a: lim, couleur: "#e3f4e8" }, { de: lim, a: e0.max, couleur: "#fff9db" });
      leg.push({ couleur: COULEURS.vert, texte: "dans la référence personnelle" }, { couleur: COULEURS.jaune, texte: "à surveiller" });
    }
    out.push(graphLigne(titre, pts.map((x) => ({ lib: dateCourte(x.date), val: arrondi(x.valeur, dec) })), { ...echelleAuto(vals), bandes, decimales: dec }, leg));
  };
  graphPerf("CMJ : hauteur de saut (cm)", cm, 1, 1);
  graphPerf("Sprint 30 m (secondes)", sp, 2, -1);
  return out;
}

/* ---------- Saisie des tests ---------- */
function ecranTests(profil) {
  racine.replaceChildren();
  const tuile = (titre, sous, action) => el("button", { class: "tuile", type: "button", onclick: action }, [titre, el("small", { text: sous })]);
  const recents = el("section", { class: "carte" }, [el("h2", { text: "Mes derniers tests" }), el("p", { class: "petit", text: "Chargement…" })]);
  racine.append(
    enTete(profil._pour ? "Tests de " + (profil.nom || "l'athlète") : "Tests de forme", profil._pour ? () => ecranChoixAthleteTest(profil._staff) : demarrer),
    ...(profil._pour ? [el("div", { class: "avertissement", text: "Tu saisis à la place de " + (profil.nom || "l'athlète") + ". Ces résultats sont notés « saisi par le staff »." })] : []),
    el("section", { class: "carte" }, [
      el("p", { class: "petit", text: "Ces tests servent à suivre ta forme dans le temps, en les comparant à tes propres valeurs. Fais-les toujours dans les mêmes conditions." }),
      el("div", { class: "grille" }, [
        tuile("HRV + FC de repos", "au réveil, 1 à 5 min", () => ecranTestHRV(profil)),
        tuile("Saut CMJ", "puissance des jambes", () => ecranTestCMJ(profil)),
        tuile("Sprint 30 m", "vitesse (facultatif)", () => ecranTestSprint(profil)),
        tuile("Comprendre les tests", "science et repères", () => ecranSciences(() => ecranTests(profil)))
      ])
    ]),
    recents,
    el("div", { class: "avertissement", text: "Ces tests ne remplacent pas un avis médical. Malaise, palpitations ou douleur à la poitrine : arrête et consulte un professionnel de santé." }),
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" })
  );
  (async () => {
    try {
      const { data, error } = await sb.from("tests").select("date, type_test, valeur, valeur2").eq("athlete_id", profil.id).order("date", { ascending: false }).limit(8);
      if (error) throw error;
      recents.replaceChildren(el("h2", { text: "Mes derniers tests" }), data.length
        ? el("ul", { class: "liste" }, data.map((t) => el("li", { text: dateFr(t.date) + " : " + texteTest(t) })))
        : el("p", { class: "petit", text: "Aucun test enregistré." }));
    } catch (err) { recents.replaceChildren(el("h2", { text: "Mes derniers tests" }), el("p", { class: "petit", text: "Liste indisponible hors connexion." })); }
  })();
  window.scrollTo(0, 0);
}

/* Choix de l'athlète (staff) pour saisir un test à sa place */
function ecranChoixAthleteTest(profilStaff) {
  racine.replaceChildren();
  const zone = el("section", { class: "carte" }, [el("h2", { text: "Athlètes" }), el("p", { class: "petit", text: "Chargement…" })]);
  racine.append(
    enTete("Saisir un test pour un athlète", demarrer),
    el("p", { class: "petit", text: "Choisis l'athlète testé. Seuls les athlètes ayant donné leur consentement apparaissent comme sélectionnables. Il faut une connexion internet." }),
    zone,
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" })
  );
  (async () => {
    try {
      const { data, error } = await sb.from("profiles").select("id, nom, groupe, consentement_at").eq("role", "athlete").order("nom");
      if (error) throw error;
      zone.replaceChildren(el("h2", { text: "Athlètes" }), data.length
        ? el("div", { class: "grille" }, data.map((a) => {
          const attrs = { type: "button", class: "tuile" };
          if (a.consentement_at) attrs.onclick = () => ecranTests({ ...profilStaff, id: a.id, nom: a.nom, _pour: true, _staff: profilStaff });
          else attrs.disabled = "";
          return el("button", attrs, [a.nom || "Sans nom", el("small", { text: a.consentement_at ? (a.groupe || "athlète") : "consentement manquant" })]);
        }))
        : el("p", { class: "petit", text: "Aucun athlète inscrit pour l'instant." }));
    } catch (err) { zone.replaceChildren(el("h2", { text: "Athlètes" }), el("p", { class: "petit", text: erreurReseau(err) ? "Liste indisponible hors connexion." : messageErreur(err) })); }
  })();
  window.scrollTo(0, 0);
}

async function sauverTest(profil, type, date, valeur, valeur2, details, commentaire, bouton) {
  bouton.disabled = true;
  if (profil._pour) {   // saisie par le staff : en ligne uniquement, pas de file d'attente
    try {
      await envoyerLigne("tests", {
        id: nouvelId(), athlete_id: profil.id, date, type_test: type, valeur: arrondi(valeur, 3),
        valeur2: valeur2 === null ? null : arrondi(valeur2, 3), details: { ...details, saisi_par: "staff" }, commentaire: commentaire || null
      }, "id");
      if (typeof donneesStaff !== "undefined") donneesStaff = null;
      afficherMessage("Test enregistré pour " + (profil.nom || "l'athlète") + ".", "succes");
      ecranTests(profil);
    } catch (err) { afficherMessage(erreurReseau(err) ? "Pas de réseau : la saisie pour un athlète n'est possible qu'en ligne." : messageErreur(err), "erreur"); bouton.disabled = false; }
    return;
  }
  try {
    const etat = await enregistrer("tests", {
      id: nouvelId(), athlete_id: profil.id, date, type_test: type, valeur: arrondi(valeur, 3),
      valeur2: valeur2 === null ? null : arrondi(valeur2, 3), details, commentaire: commentaire || null
    }, "id");
    if (etat === "envoye") afficherMessage("Test enregistré.", "succes");
    else afficherMessage("Pas de réseau : test gardé sur ton téléphone, envoi automatique au retour du réseau.", "info");
    await demarrer();
  } catch (err) { afficherMessage(messageErreur(err), "erreur"); bouton.disabled = false; }
}

function optionsSelect(liste) { return liste.map(([v, t]) => el("option", { value: v, text: t })); }
function champNombre(id, placeholder) { return el("input", { id, type: "text", inputmode: "decimal", autocomplete: "off", placeholder }); }

function ecranTestCMJ(profil) {
  racine.replaceChildren();
  const date = el("input", { type: "date", id: "d-cmj", value: dateLocale(), max: dateLocale() });
  const methode = el("select", { id: "m-cmj" }, optionsSelect([["hauteur", "Hauteur en cm (application, plateforme, tapis)"], ["vol", "Temps de vol en ms (tapis, application)"]]));
  const bras = el("select", { id: "b-cmj" }, optionsSelect([["hanches", "Mains sur les hanches (recommandé)"], ["libres", "Bras libres"]]));
  const essais = [1, 2, 3].map((k) => champNombre("e" + k + "-cmj", k === 1 ? "Essai 1" : "Essai " + k + " (facultatif)"));
  const unite = el("span", { text: "cm" });
  const resume = el("div", { class: "resume-charge cache" });
  const com = el("textarea", { id: "c-cmj", maxlength: "500", rows: "2", placeholder: "Facultatif : chaussures, surface, sensations…" });
  const bouton = el("button", { class: "btn", type: "submit", text: "Enregistrer le test" });
  const enCm = (v) => methode.value === "vol" ? 0.000122625 * v * v : v;   // h = g × t² / 8 (t en s) → cm
  function lireEssais() {
    const hs = []; let bad = false;
    for (const c of essais) {
      const v = parseNombre(c.value);
      if (v === null) continue;
      if (Number.isNaN(v) || v <= 0) { bad = true; continue; }
      hs.push(enCm(v));
    }
    return { hs, bad };
  }
  function maj() {
    unite.textContent = methode.value === "vol" ? "ms" : "cm";
    const { hs } = lireEssais();
    resume.classList.toggle("cache", !hs.length);
    if (hs.length) resume.textContent = "Meilleur saut : " + fr(Math.max(...hs), 1) + " cm" + (hs.length > 1 ? " · moyenne : " + fr(moy(hs), 1) + " cm" : "");
  }
  methode.addEventListener("change", maj);
  essais.forEach((c) => c.addEventListener("input", maj));
  const form = el("form", { class: "carte", novalidate: "" }, [
    el("h2", { text: "Saut vertical avec contre-mouvement (CMJ)" }),
    el("p", { class: "petit", text: "Après un échauffement : mains sur les hanches, descends rapidement puis saute le plus haut possible. 3 essais, 30 à 60 s de repos entre chaque. Le meilleur saut est retenu. Fais le test au même moment de la journée, avec les mêmes chaussures." }),
    el("label", { for: "d-cmj", text: "Date" }), date,
    el("label", { for: "m-cmj", text: "Mesure fournie par ton outil" }), methode,
    el("label", { for: "b-cmj", text: "Bras" }), bras,
    el("label", { for: "e1-cmj" }, ["Résultat de chaque essai (", unite, ")"]), ...essais,
    resume,
    el("label", { for: "c-cmj", text: "Commentaire" }), com, bouton
  ]);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const { hs, bad } = lireEssais();
    if (bad || !hs.length) return afficherMessage("Saisis au moins un essai avec un nombre valide.", "erreur");
    if (hs.some((h) => h < 5 || h > 100)) return afficherMessage(methode.value === "vol" ? "Temps de vol : entre 200 et 900 ms." : "Hauteur : entre 5 et 100 cm.", "erreur");
    sauverTest(profil, "cmj_cm", date.value || dateLocale(), Math.max(...hs), hs.length > 1 ? moy(hs) : null,
      { methode: methode.value, bras: bras.value, essais_cm: hs.map((h) => arrondi(h, 1)) }, com.value.trim(), bouton);
  });
  racine.append(enTete("Test CMJ", () => ecranTests(profil)), form,
    el("p", { class: "petit", text: "Repère indicatif : la hauteur dépend fortement de l'outil de mesure. Compare-toi surtout à toi-même (voir « Comprendre les tests »)." }));
  window.scrollTo(0, 0);
}

function ecranTestHRV(profil) {
  racine.replaceChildren();
  const date = el("input", { type: "date", id: "d-hrv", value: dateLocale(), max: dateLocale() });
  const position = el("select", { id: "p-hrv" }, optionsSelect([["couche", "Allongé (recommandé)"], ["assis", "Assis"], ["debout", "Debout"]]));
  const duree = el("select", { id: "du-hrv" }, optionsSelect([["1", "1 minute"], ["2", "2 minutes"], ["3", "3 minutes"], ["5", "5 minutes"]]));
  const outil = el("select", { id: "o-hrv" }, optionsSelect([["ceinture", "Ceinture cardiaque"], ["montre", "Montre / bracelet"], ["camera", "Application caméra du téléphone"], ["autre", "Autre"]]));
  const rmssd = champNombre("r-hrv", "Ex : 62");
  const fc = champNombre("f-hrv", "Ex : 54");
  const rr = el("textarea", { id: "rr-hrv", rows: "3", placeholder: "Colle ici les intervalles RR en ms (ex : 1012 998 1034 …)" });
  const info = el("p", { class: "petit" });
  const resume = el("div", { class: "resume-charge cache" });
  const com = el("textarea", { id: "c-hrv", maxlength: "500", rows: "2", placeholder: "Facultatif : sommeil, café, alcool, maladie, stress…" });
  const bouton = el("button", { class: "btn", type: "submit", text: "Enregistrer le test" });
  function maj() {
    const r = parseNombre(rmssd.value);
    resume.classList.toggle("cache", !(r > 0));
    if (r > 0) resume.textContent = "ln(RMSSD) = " + fr(Math.log(r), 2) + " (valeur utilisée pour suivre ta tendance)";
  }
  rmssd.addEventListener("input", maj);
  const btnRR = el("button", { class: "btn btn-secondaire", type: "button", text: "Calculer RMSSD et FC depuis les intervalles RR", onclick: () => {
    const nombres = (rr.value.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(",", ".")));
    const valides = nombres.filter((x) => x >= 300 && x <= 2000);
    if (valides.length < 30) { info.textContent = "Il faut au moins 30 intervalles valides (300 à 2000 ms) : " + valides.length + " trouvés."; return; }
    const diffs = []; let ecartes = 0;
    for (let i = 1; i < valides.length; i++) {
      if (Math.abs(valides[i] - valides[i - 1]) / valides[i - 1] > 0.2) { ecartes++; continue; } // battement artéfact probable
      diffs.push(valides[i] - valides[i - 1]);
    }
    if (diffs.length < 20) { info.textContent = "Trop d'artéfacts dans cette série : refais la mesure."; return; }
    rmssd.value = fr(Math.sqrt(moy(diffs.map((d) => d * d))), 1).replace(",", ".");
    fc.value = String(Math.round(60000 / moy(valides)));
    info.textContent = valides.length + " intervalles utilisés, " + ecartes + " écart(s) supprimé(s) comme artéfact(s).";
    maj();
  }});
  const form = el("form", { class: "carte", novalidate: "" }, [
    el("h2", { text: "HRV + FC de repos" }),
    el("p", { class: "petit", text: "Mesure le matin au réveil, avant le café et le téléphone, allongé et au calme, 1 à 5 minutes. Fais-la 3 à 7 fois par semaine, toujours dans la même position et avec le même outil : c'est la tendance qui compte." }),
    el("label", { for: "d-hrv", text: "Date" }), date,
    el("label", { for: "p-hrv", text: "Position" }), position,
    el("label", { for: "du-hrv", text: "Durée de la mesure" }), duree,
    el("label", { for: "o-hrv", text: "Outil" }), outil,
    el("label", { for: "r-hrv", text: "HRV : RMSSD (ms)" }), rmssd,
    el("label", { for: "f-hrv", text: "FC de repos (bpm)" }), fc,
    resume,
    el("details", {}, [el("summary", { text: "J'ai les intervalles RR (facultatif)" }), rr, btnRR, info]),
    el("label", { for: "c-hrv", text: "Commentaire" }), com, bouton
  ]);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const r = parseNombre(rmssd.value), f = parseNombre(fc.value);
    if (!(r >= 3 && r <= 300)) return afficherMessage("RMSSD : un nombre entre 3 et 300 ms.", "erreur");
    if (!(f >= 25 && f <= 130)) return afficherMessage("FC de repos : un nombre entre 25 et 130 bpm.", "erreur");
    sauverTest(profil, "hrv_rmssd_ms", date.value || dateLocale(), r, f,
      { position: position.value, duree_min: Number(duree.value), outil: outil.value }, com.value.trim(), bouton);
  });
  racine.append(enTete("Test HRV", () => ecranTests(profil)), form,
    el("p", { class: "petit", text: "Une seule mesure ne dit presque rien : l'application compare ta moyenne des 7 derniers jours à ta référence personnelle (60 jours). Il faut environ " + SEUILS_TESTS.hrvMinRef + " mesures pour la fixer." }));
  window.scrollTo(0, 0);
}

function ecranTestSprint(profil) {
  racine.replaceChildren();
  const date = el("input", { type: "date", id: "d-sp", value: dateLocale(), max: dateLocale() });
  const depart = el("select", { id: "dep-sp" }, optionsSelect([["debout", "Départ debout"], ["trois_appuis", "Départ trois appuis"], ["blocs", "Départ des blocs"]]));
  const chrono = el("select", { id: "ch-sp" }, optionsSelect([["cellules", "Cellules photoélectriques"], ["video", "Vidéo / application"], ["manuel", "Chronomètre manuel"]]));
  const surface = el("select", { id: "su-sp" }, optionsSelect([["piste", "Piste synthétique"], ["herbe", "Herbe / terrain"], ["autre", "Autre surface"]]));
  const essais = [1, 2, 3].map((k) => champNombre("e" + k + "-sp", k === 1 ? "Essai 1 (secondes)" : "Essai " + k + " (facultatif)"));
  const resume = el("div", { class: "resume-charge cache" });
  const com = el("textarea", { id: "c-sp", maxlength: "500", rows: "2", placeholder: "Facultatif : vent, état de forme, échauffement…" });
  const bouton = el("button", { class: "btn", type: "submit", text: "Enregistrer le test" });
  function lire() { const t = [], r = { bad: false }; for (const c of essais) { const v = parseNombre(c.value); if (v === null) continue; if (Number.isNaN(v)) r.bad = true; else t.push(v); } return { t, bad: r.bad }; }
  function maj() { const { t } = lire(); resume.classList.toggle("cache", !t.length); if (t.length) resume.textContent = "Meilleur temps : " + fr(Math.min(...t), 2) + " s" + (t.length > 1 ? " · moyenne : " + fr(moy(t), 2) + " s" : ""); }
  essais.forEach((c) => c.addEventListener("input", maj));
  const form = el("form", { class: "carte", novalidate: "" }, [
    el("h2", { text: "Sprint 30 m" }),
    el("p", { class: "petit", text: "Échauffement complet, puis 2 à 3 sprints maximaux avec 3 à 5 minutes de récupération. Le meilleur temps est retenu. Garde le même départ, le même chronométrage et la même surface d'un test à l'autre, sinon les temps ne sont pas comparables." }),
    el("label", { for: "d-sp", text: "Date" }), date,
    el("label", { for: "dep-sp", text: "Départ" }), depart,
    el("label", { for: "ch-sp", text: "Chronométrage" }), chrono,
    el("label", { for: "su-sp", text: "Surface" }), surface,
    el("label", { for: "e1-sp", text: "Temps de chaque essai (secondes)" }), ...essais,
    resume,
    el("label", { for: "c-sp", text: "Commentaire" }), com, bouton
  ]);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const { t, bad } = lire();
    if (bad || !t.length) return afficherMessage("Saisis au moins un temps valide.", "erreur");
    if (t.some((x) => x < 2.5 || x > 12)) return afficherMessage("Temps : entre 2,5 et 12 secondes.", "erreur");
    sauverTest(profil, "sprint_30m_s", date.value || dateLocale(), Math.min(...t), t.length > 1 ? moy(t) : null,
      { depart: depart.value, chrono: chrono.value, surface: surface.value, essais_s: t.map((x) => arrondi(x, 2)) }, com.value.trim(), bouton);
  });
  racine.append(enTete("Test sprint 30 m", () => ecranTests(profil)), form);
  window.scrollTo(0, 0);
}

/* ---------- Explications scientifiques et repères ---------- */
function ecranSciences(retour) {
  racine.replaceChildren();
  const S = SEUILS_TESTS;
  const p = (t) => el("p", { text: t });
  const ul = (l) => el("ul", { class: "liste" }, l.map((x) => el("li", { text: x })));
  const bloc = (titre, enfants, ouvert) => el("details", ouvert ? { open: "" } : {}, [el("summary", { text: titre }), ...enfants]);
  const carte = (titre, blocs) => el("section", { class: "carte" }, [el("h2", { text: titre }), ...blocs]);
  racine.append(
    enTete("Comprendre les tests", retour),
    carte("Pourquoi croiser plusieurs mesures ?", [
      bloc("Le principe", [
        p("Aucun indicateur n'est parfait. Le CMJ reflète l'état neuromusculaire (la capacité des muscles à produire de la puissance), la HRV et la FC de repos reflètent l'état du système nerveux autonome (stress, récupération), le bien-être reflète le ressenti, et l'ACWR mesure la charge d'entraînement récente."),
        p("Une seule mesure varie naturellement d'un jour à l'autre. Quand plusieurs indicateurs indépendants vont dans le même sens, le signal devient plus fiable. L'application compte donc ces signaux et les compare à la référence personnelle de chaque athlète."),
        p("Ce sont des repères de discussion pour le staff, jamais un diagnostic ni une prédiction de blessure.")
      ], true)
    ]),
    carte("Test de saut CMJ", [
      bloc("À quoi il sert", [
        p("Le saut avec contre-mouvement (CMJ) est l'un des tests de terrain les plus utilisés pour suivre l'état neuromusculaire. Une méta-analyse (Claudino et al., 2017) conclut que la hauteur de saut est un indicateur utile mais qu'il faut le suivre dans le temps, avec un protocole constant."),
        p("Une baisse durable de la hauteur, par rapport à la moyenne personnelle, peut traduire une fatigue neuromusculaire. Une hausse accompagne souvent une bonne adaptation à l'entraînement.")
      ]),
      bloc("Protocole", [ul([
        "Échauffement identique à chaque test, test avant la séance, jamais après un effort intense.",
        "Mains sur les hanches pour supprimer l'effet des bras. Descente rapide puis poussée maximale, réception jambes tendues.",
        "3 essais, 30 à 60 s de repos, on garde le meilleur. Même heure, mêmes chaussures, même surface.",
        "Temps de vol : hauteur = g × t² / 8, avec t en secondes et g = 9,81 m/s² (méthode de Bosco). L'application fait ce calcul si tu saisis le temps de vol."
      ])]),
      bloc("Comment l'application l'interprète", [
        p("Le dernier saut est comparé à la moyenne des " + S.cmjNbRef + " tests précédents (au moins 2 nécessaires). Baisse de " + Math.abs(S.cmjJaune * 100) + " % ou plus : signal jaune. Baisse de " + Math.abs(S.cmjOrange * 100) + " % ou plus : signal orange. Ces seuils sont modifiables en tête du fichier tests.js.")
      ]),
      bloc("Repères indicatifs (à prendre avec prudence)", [
        p("La hauteur dépend beaucoup de l'outil (tapis, plateforme de force, application) et du protocole (bras libres ou non). Les valeurs ne sont pas comparables d'un outil à l'autre."),
        p("Ordre de grandeur courant chez des sportifs entraînés, mains sur les hanches : environ 35 à 50 cm chez les hommes et 25 à 38 cm chez les femmes, avec des valeurs plus hautes chez des sprinters ou sauteurs confirmés. Ce sont des ordres de grandeur, pas des normes officielles : ce qui compte, c'est l'évolution de chaque athlète par rapport à lui-même.")
      ])
    ]),
    carte("HRV (variabilité cardiaque) et FC de repos", [
      bloc("Ce que mesure la HRV", [
        p("Le cœur ne bat pas avec une régularité parfaite : le temps entre deux battements (intervalle RR) varie. Le RMSSD, exprimé en millisecondes, mesure les variations entre battements successifs. Il reflète surtout l'activité parasympathique (le « frein » du système nerveux autonome), liée à la récupération."),
        p("On utilise le logarithme népérien du RMSSD, noté ln(RMSSD), car sa distribution est plus régulière et se compare mieux dans le temps (Plews et al., 2013). L'application calcule ce logarithme pour toi.")
      ], true),
      bloc("Protocole de mesure", [ul([
        "Le matin au réveil, avant café, téléphone et lever, allongé, au calme, respiration naturelle.",
        "1 à 5 minutes. Des mesures courtes d'environ 1 minute sont utilisées chez les sportifs (Esco et Flatt, 2014), à condition de garder toujours la même durée.",
        "Même position, même outil, même moment. Une ceinture cardiaque est plus fiable qu'une montre ou qu'une application caméra.",
        "Sans mesure fiable (mouvements, parole, battements ectopiques), refais-la : les artéfacts faussent le RMSSD."
      ])]),
      bloc("Référence personnelle et changement notable", [
        p("La HRV varie beaucoup d'une personne à l'autre : seule la comparaison à soi-même a un sens. L'application calcule ta moyenne de ln(RMSSD) sur les 7 derniers jours (au moins " + S.hrvMinSemaine + " mesures) et la compare à ta référence des " + S.hrvFenetreRef + " jours précédents (au moins " + S.hrvMinRef + " mesures)."),
        p("Le « changement notable » est fixé à " + S.swcFacteur + " × l'écart-type personnel du ln(RMSSD), une approche proposée dans la littérature (Plews et al., 2013 ; Buchheit, 2014). Moyenne de la semaine sous la zone de référence : HRV « en baisse ». Au-dessus : HRV « en hausse »."),
        p("Plews et al. recommandent de suivre la moyenne sur plusieurs jours plutôt qu'une valeur isolée : c'est ce que fait l'application.")
      ]),
      bloc("FC de repos", [
        p("Une FC de repos plus élevée que d'habitude peut accompagner fatigue, déshydratation, manque de sommeil ou début d'infection. L'application signale une FC de repos supérieure d'au moins " + S.fcHausseBpm + " bpm à ta référence. Combinée à une HRV en baisse, elle renforce le signal (Buchheit, 2014)."),
        p("Attention : certaines situations produisent une HRV haute avec une sensation de fatigue (fatigue profonde, surentraînement chez certains profils d'endurance). C'est pourquoi la HRV se lit toujours avec le ressenti, le CMJ et la charge.")
      ]),
      bloc("Repères indicatifs", [
        p("Chez l'adulte sain, une revue de la littérature (Nunan et al., 2010) rapporte un RMSSD de courte durée d'environ 42 ms en moyenne, avec un écart-type d'environ 15 ms. Les sportifs d'endurance ont souvent des valeurs plus élevées, et le RMSSD diminue avec l'âge."),
        p("FC de repos : environ 60 à 100 bpm dans la population générale (valeurs usuelles), et souvent 40 à 60 bpm chez des sportifs entraînés. Ce sont des ordres de grandeur. Une FC de repos durablement inférieure à 40 bpm ou supérieure à 100 bpm, ou des palpitations, malaises ou douleurs à la poitrine, justifient un avis médical."),
        p("Pas de « bonne » ou de « mauvaise » HRV en valeur absolue : une HRV de 40 ms peut être normale pour l'un et basse pour l'autre.")
      ])
    ]),
    carte("Sprint 30 m", [
      bloc("À quoi il sert", [
        p("Le temps sur 30 m renseigne sur l'accélération. Il est sensible à la fatigue neuromusculaire, mais aussi à la technique, au vent, à la surface et surtout au mode de chronométrage (Haugen et Buchheit, 2016)."),
        p("Le chronométrage manuel est en général plus rapide que les cellules, souvent d'environ 0,2 s avec une grande variabilité : ne compare pas un temps manuel à un temps électronique.")
      ]),
      bloc("Comment l'application l'interprète", [
        p("Le dernier temps est comparé à la moyenne des " + S.sprintNbRef + " tests précédents. Plus lent de " + (S.sprintJaune * 100) + " % ou plus : signal jaune. Plus lent de " + (S.sprintOrange * 100) + " % ou plus : signal orange. Garde exactement le même protocole.")
      ]),
      bloc("Repères indicatifs", [
        p("Ordre de grandeur sur 30 m départ debout, chez des sportifs entraînés : environ 4,2 à 5,0 s. Des sprinters confirmés partant des blocs, avec cellules, descendent autour de 3,9 à 4,3 s. Ces valeurs varient fortement selon le départ et l'outil : elles servent à te situer, pas à te classer.")
      ])
    ]),
    carte("Lecture croisée : les règles utilisées", [
      bloc("Signaux comptés", [ul([
        "HRV : moyenne 7 jours sous la zone de référence personnelle.",
        "FC de repos : au moins " + S.fcHausseBpm + " bpm au-dessus de la référence (mesure de moins de " + S.fraicheur.hrv + " jours).",
        "CMJ : baisse d'au moins " + Math.abs(S.cmjJaune * 100) + " % (test de moins de " + S.fraicheur.cmj + " jours).",
        "Sprint 30 m : plus lent d'au moins " + (S.sprintJaune * 100) + " % (test de moins de " + S.fraicheur.sprint + " jours).",
        "Bien-être : score de " + SEUILS.scoreOrange + "/25 ou moins (saisie de moins de " + (S.joursBienEtre + 1) + " jours)."
      ]), p("La charge d'entraînement élevée (ACWR au-dessus de " + fr(SEUILS.acwrVertMax, 1) + " ou hausse de plus de 30 % de la semaine) n'est pas comptée comme un signal de fatigue : elle sert de contexte pour expliquer les autres signaux.")]),
      bloc("Niveaux", [ul([
        "0 signal : vert. 1 signal : jaune, à surveiller.",
        S.convOrange + " signaux : orange (alerte au staff). " + S.convRouge + " signaux ou plus : rouge.",
        "Il faut au moins 2 indicateurs récents pour croiser. Sinon l'application affiche « pas encore assez de données »."
      ])])
    ]),
    carte("Limites et précautions", [
      ul([
        "Ces repères ne remplacent ni un avis médical ni le jugement de l'entraîneur.",
        "HRV et FC sont influencées par le sommeil, l'alcool, la caféine, la maladie, les médicaments, le stress, la température, et chez les athlètes féminines peuvent varier avec le cycle.",
        "Plus il y a de mesures régulières, plus la référence personnelle est fiable. Les premières semaines sont une phase de calibrage.",
        "Les seuils sont des valeurs de départ, à ajuster avec l'expérience du groupe (fichier tests.js)."
      ])
    ]),
    carte("Sources", [
      el("ul", { class: "liste" }, [
        "Bosco C, Luhtanen P, Komi PV. A simple method for measurement of mechanical power in jumping. Eur J Appl Physiol 1983;50:273-282.",
        "Task Force of the ESC and NASPE. Heart rate variability: standards of measurement, physiological interpretation and clinical use. Circulation 1996;93:1043-1065.",
        "Nunan D, Sandercock GRH, Brodie DA. A quantitative systematic review of normal values for short-term heart rate variability in healthy adults. Pacing Clin Electrophysiol 2010;33:1407-1417.",
        "Plews DJ, Laursen PB, Stanley J, Kilding AE, Buchheit M. Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring. Sports Med 2013;43:773-781.",
        "Buchheit M. Monitoring training status with HR measures: do all roads lead to Rome? Front Physiol 2014;5:73.",
        "Esco MR, Flatt AA. Ultra-short-term heart rate variability indexes at rest and post-exercise in athletes. J Sports Sci Med 2014;13:535-541.",
        "Haugen T, Buchheit M. Sprint running performance monitoring: methodological and practical considerations. Sports Med 2016;46:641-656.",
        "Claudino JG, et al. The countermovement jump to monitor neuromuscular status: a meta-analysis. J Sci Med Sport 2017;20:397-402."
      ].map((x) => el("li", { text: x }))),
      el("p", { class: "petit", text: "Références citées de mémoire par l'assistant : vérifie les détails avant toute publication. Les « repères indicatifs » sont des ordres de grandeur, pas des normes officielles." })
    ]),
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" })
  );
  window.scrollTo(0, 0);
}
