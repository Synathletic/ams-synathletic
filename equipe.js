/* Équipe : le staff crée des athlètes sans compte et saisit à leur place (bien-être et séances).
   Chargé après app.js : utilise ses fonctions (el, enTete, demarrer, dateLocale, nouvelId, messageErreur, afficherMessage). */

const SPORTS_EQUIPE = [["athletisme", "Athlétisme"], ["football", "Football"], ["handball", "Handball"], ["basketball", "Basketball"], ["autre", "Autre"]];

function typesSeancePour(sport) { return !sport || sport === "athletisme" ? CATEGORIES_ATHLE : CATEGORIES_AUTRES; }
function optionsListe(paires, vide) { return [vide ? el("option", { value: "", text: vide }) : null, ...paires.map(([v, t]) => el("option", { value: v, text: t }))].filter(Boolean); }

/* ---------- Ajouter un athlète (profil géré par le staff, sans compte) ---------- */
function ecranAjoutAthlete(profilStaff) {
  racine.replaceChildren();
  const nom = el("input", { id: "aj-nom", type: "text", maxlength: "60", autocomplete: "off", placeholder: "Prénom Nom" });
  const groupe = el("input", { id: "aj-groupe", type: "text", maxlength: "40", list: "aj-groupes", autocomplete: "off", value: "Pole Sprint Haies" });
  const groupes = el("datalist", { id: "aj-groupes" });
  const sport = el("select", { id: "aj-sport" }, optionsListe(SPORTS_EQUIPE));
  const sexe = el("select", { id: "aj-sexe" }, optionsListe([["F", "Femme"], ["M", "Homme"]], "Non précisé"));
  const consent = el("input", { type: "checkbox", id: "aj-consent" });
  const bouton = el("button", { class: "btn", type: "button", text: "Créer l'athlète" });

  racine.append(
    enTete("Ajouter un athlète", demarrer),
    el("section", { class: "carte" }, [
      el("p", { class: "petit", text: "Crée le profil d'un athlète qui n'a pas de compte : tu saisis ensuite son bien-être et ses séances depuis « Saisie équipe ». S'il s'inscrit plus tard, contacte Syn'Athlétic pour rattacher son historique." }),
      el("label", { for: "aj-nom", text: "Nom de l'athlète" }), nom,
      el("label", { for: "aj-groupe", text: "Groupe" }), groupe, groupes,
      el("label", { for: "aj-sport", text: "Sport principal" }), sport,
      el("label", { for: "aj-sexe", text: "Sexe (facultatif)" }), sexe,
      el("label", { class: "ligne-case", for: "aj-consent" }, [consent, el("span", { text: "J'ai recueilli le consentement de cet athlète (ou de son représentant légal s'il est mineur) pour le suivi de ses données de forme et d'entraînement." })]),
      bouton
    ]),
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" })
  );
  (async () => {   // suggestions de groupes existants
    try {
      const { data } = await sb.from("profiles").select("groupe").eq("role", "athlete");
      groupes.replaceChildren(...[...new Set((data || []).map((x) => x.groupe).filter(Boolean))].map((g) => el("option", { value: g })));
    } catch (_) { /* facultatif */ }
  })();

  bouton.addEventListener("click", async () => {
    const n = nom.value.trim();
    if (n.length < 2) { afficherMessage("Entre le nom de l'athlète.", "erreur"); return; }
    if (!consent.checked) { afficherMessage("Coche la case de consentement : sans accord de l'athlète, le profil ne peut pas être créé.", "erreur"); return; }
    bouton.disabled = true;
    try {
      const { data: memes } = await sb.from("profiles").select("id, nom").eq("role", "athlete");
      if ((memes || []).some((x) => (x.nom || "").trim().toLowerCase() === n.toLowerCase())) { afficherMessage("Un athlète porte déjà ce nom. Ajoute un nom de famille ou une initiale.", "erreur"); bouton.disabled = false; return; }
      const { error } = await sb.from("profiles").insert({
        nom: n, groupe: groupe.value.trim() || null, sport_principal: sport.value, sexe: sexe.value || null,
        gere_par_staff: true, consentement_at: new Date().toISOString(), consentement_version: "staff-a-confirmer"
      });
      if (error) throw error;
      afficherMessage("Athlète créé : " + n + ".", "succes");
      ecranSaisieEquipe(profilStaff);
    } catch (err) { afficherMessage(messageErreur(err), "erreur"); bouton.disabled = false; }
  });
  window.scrollTo(0, 0);
}

/* ---------- Saisie équipe : bien-être + séance de plusieurs athlètes pour un jour ---------- */
function ecranSaisieEquipe(profilStaff) {
  racine.replaceChildren();
  const champDate = el("input", { type: "date", id: "eq-date", value: dateLocale(), max: dateLocale() });
  const selGroupe = el("select", { id: "eq-groupe" });
  const zone = el("div", {}, [el("p", { class: "petit", text: "Chargement…" })]);
  const bouton = el("button", { class: "btn", type: "button", text: "Enregistrer la saisie" });
  const ajout = el("button", { class: "btn btn-secondaire", type: "button", text: "Ajouter un athlète", onclick: () => ecranAjoutAthlete(profilStaff) });

  racine.append(
    enTete("Saisie équipe", demarrer),
    el("section", { class: "carte" }, [
      el("p", { class: "petit", text: "Une ligne par athlète : bien-être du matin (1 à 5, 5 = le meilleur état) puis séance. Laisse vide ce que tu ne veux pas saisir. Connexion internet nécessaire." }),
      el("label", { for: "eq-date", text: "Date" }), champDate,
      el("label", { for: "eq-groupe", text: "Groupe" }), selGroupe
    ]),
    zone, bouton, el("div", { style: "height:10px" }), ajout,
    el("p", { class: "signature", text: "Syn'Athlétic / Alexandre GERBER" })
  );

  let cartes = [];
  const cles = ["sommeil", "energie", "douleurs", "stress", "humeur"];
  const abrev = ["Somm.", "Énerg.", "Doul.", "Stress", "Humeur"];

  function construire(a) {
    const sel5 = (lib) => el("select", { "aria-label": lib + " de " + a.nom }, optionsListe([1, 2, 3, 4, 5].map((n) => [String(n), String(n)]), "–"));
    const be = Object.fromEntries(cles.map((c, i) => [c, sel5(abrev[i])]));
    const type = el("select", { "aria-label": "Type de séance de " + a.nom }, optionsListe(typesSeancePour(a.sport_principal), "Pas de séance"));
    const duree = el("input", { type: "number", inputmode: "numeric", min: "1", max: "480", placeholder: "min", "aria-label": "Durée en minutes de " + a.nom });
    const rpe = el("select", { "aria-label": "RPE de " + a.nom }, optionsListe(Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]), "RPE"));
    const info = el("p", { class: "petit eq-info" });
    const noeud = el("div", { class: "ligne-athlete eq-carte" }, [
      el("div", { class: "ligne-haut" }, [el("strong", { text: a.nom || "Sans nom" }), el("span", { class: "petit", text: [a.groupe, a.gere_par_staff ? "sans compte" : null].filter(Boolean).join(" · ") })]),
      el("div", { class: "eq-grille5" }, cles.map((c, i) => el("label", { class: "eq-mini" }, [abrev[i], be[c]]))),
      el("div", { class: "eq-seance" }, [type, duree, rpe]),
      info
    ]);
    return { a, be, type, duree, rpe, info, noeud, bienEtreExiste: false, seances: [] };
  }

  async function charger() {
    const date = champDate.value;
    try {
      const [rp, rb, rs] = await Promise.all([
        sb.from("profiles").select("id, nom, groupe, sport_principal, consentement_at, gere_par_staff").eq("role", "athlete").order("nom"),
        sb.from("bien_etre").select("athlete_id, sommeil, energie, douleurs, stress, humeur").eq("date", date),
        sb.from("seances").select("athlete_id, categorie, duree_min, rpe").eq("date", date)
      ]);
      for (const r of [rp, rb, rs]) if (r.error) throw r.error;
      const athletes = (rp.data || []).filter((x) => x.consentement_at);
      const groupes = [...new Set(athletes.map((x) => x.groupe).filter(Boolean))].sort();
      const courant = selGroupe.value;
      selGroupe.replaceChildren(el("option", { value: "", text: "Tous les groupes" }), ...groupes.map((g) => el("option", { value: g, text: g })));
      selGroupe.value = groupes.includes(courant) ? courant : "";
      cartes = athletes.map(construire);
      for (const c of cartes) {
        const b = (rb.data || []).find((x) => x.athlete_id === c.a.id);
        if (b) { c.bienEtreExiste = true; for (const k of cles) c.be[k].value = String(b[k]); }
        c.seances = (rs.data || []).filter((x) => x.athlete_id === c.a.id);
        const libelles = Object.fromEntries([...CATEGORIES_ATHLE, ...CATEGORIES_AUTRES]);
        const txt = [b ? "Bien-être déjà saisi (modifiable)" : null,
          ...c.seances.map((s) => "Séance déjà saisie : " + (libelles[s.categorie] || s.categorie) + (s.duree_min ? ", " + s.duree_min + " min, RPE " + s.rpe : ""))].filter(Boolean);
        c.info.textContent = txt.join(" · ");
        c.info.classList.toggle("cache", !txt.length);
      }
      zone.replaceChildren(...(cartes.length ? cartes.map((c) => c.noeud) : [el("p", { class: "petit", text: "Aucun athlète. Utilise « Ajouter un athlète »." })]));
      filtrer();
    } catch (err) { zone.replaceChildren(el("p", { class: "petit", text: messageErreur(err) })); }
  }
  function filtrer() { for (const c of cartes) c.noeud.classList.toggle("cache", !!selGroupe.value && c.a.groupe !== selGroupe.value); }
  selGroupe.addEventListener("change", filtrer);
  champDate.addEventListener("change", () => { if (champDate.value && champDate.value <= dateLocale()) charger(); });

  bouton.addEventListener("click", async () => {
    const date = champDate.value;
    if (!date || date > dateLocale()) { afficherMessage("Choisis une date valide (pas dans le futur).", "erreur"); return; }
    const be = [], se = [], erreurs = [];
    for (const c of cartes) {
      if (c.noeud.classList.contains("cache")) continue;
      const v = Object.fromEntries(cles.map((k) => [k, c.be[k].value]));
      const remplis = cles.filter((k) => v[k]).length;
      if (remplis && remplis < 5) erreurs.push(c.a.nom + " : bien-être incomplet (5 réponses nécessaires)");
      else if (remplis === 5) be.push({ athlete_id: c.a.id, date, ...Object.fromEntries(cles.map((k) => [k, Number(v[k])])) });
      if (c.type.value) {
        const repos = c.type.value === "repos";
        const d = Number(c.duree.value), r = Number(c.rpe.value);
        if (!repos && (!(d >= 1 && d <= 480) || !(r >= 1 && r <= 10))) { erreurs.push(c.a.nom + " : durée (1 à 480 min) et RPE (1 à 10) nécessaires"); continue; }
        const dd = repos ? 0 : Math.round(d), rr = repos ? 0 : r;
        if (c.seances.some((s) => s.categorie === c.type.value && Number(s.duree_min) === dd && Number(s.rpe) === rr)) continue;   // déjà enregistrée
        se.push({ id: nouvelId(), athlete_id: c.a.id, date, sport: c.a.sport_principal || "athletisme", categorie: c.type.value, duree_min: dd, rpe: rr });
      }
    }
    if (erreurs.length) { afficherMessage(erreurs.slice(0, 3).join(" · ") + (erreurs.length > 3 ? " …" : ""), "erreur"); return; }
    if (!be.length && !se.length) { afficherMessage("Rien de nouveau à enregistrer.", "info"); return; }
    bouton.disabled = true;
    try {
      if (be.length) { const { error } = await sb.from("bien_etre").upsert(be, { onConflict: "athlete_id,date" }); if (error) throw error; }
      if (se.length) { const { error } = await sb.from("seances").insert(se); if (error) throw error; }
      afficherMessage("Enregistré : " + be.length + " bien-être, " + se.length + " séance(s).", "succes");
      await charger();
    } catch (err) { afficherMessage(messageErreur(err), "erreur"); }
    bouton.disabled = false;
  });

  charger();
  window.scrollTo(0, 0);
}
