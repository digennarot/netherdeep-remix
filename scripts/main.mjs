/**
 * Call of the Netherdeep: remix.
 * - Corruzione da ruidium: effetto marcatore + 1d10 danni psichici a ogni variazione di indebolimento.
 * - Ruidium come componente materiale (1 oncia = 500 mo) e come metamagia (1 oncia per punto stregoneria).
 */

const MODULE_ID = "netherdeep-remix";
const DEFAULT_DC = 20;
const CORRUPTION_IMG = "icons/commodities/gems/gem-faceted-rough-red.webp";

/** Opzioni di metamagia (Manuale del Giocatore 2014 e Tasha) con il costo in punti stregoneria. */
const METAMAGIC = {
  careful: { label: "Incantesimo Accurato", cost: 1 },
  distant: { label: "Incantesimo Distante", cost: 1 },
  empowered: { label: "Incantesimo Potenziato", cost: 1 },
  extended: { label: "Incantesimo Esteso", cost: 1 },
  heightened: { label: "Incantesimo Intensificato", cost: 3 },
  quickened: { label: "Incantesimo Rapido", cost: 2 },
  seeking: { label: "Incantesimo Cercante", cost: 2 },
  subtle: { label: "Incantesimo Sottile", cost: 1 },
  transmuted: { label: "Incantesimo Trasmutato", cost: 1 },
  twinned: { label: "Incantesimo Gemello", cost: level => Math.max(1, level) }
};

/* -------------------------------------------- */
/*  Utility                                     */
/* -------------------------------------------- */

function exhaustionId() {
  return dnd5e.utils.staticID("dnd5eexhaustion");
}

function isExhaustion(effect) {
  return (effect.id === exhaustionId()) && (effect.parent instanceof Actor);
}

function getCorruptionEffect(actor) {
  return actor.effects.find(e => e.getFlag(MODULE_ID, "corruption"));
}

function isCorrupted(actor) {
  return !!getCorruptionEffect(actor);
}

/** L'oggetto ruidium dell'attore: prima quello marcato dal modulo, poi un loot che si chiama «Ruidium…». */
function getRuidiumItem(actor) {
  return actor.items.find(i => i.getFlag(MODULE_ID, "ruidium"))
    ?? actor.items.find(i => (i.type === "loot") && /^ruidium/i.test(i.name));
}

/** Testo libero (nomi scritti dal GM, nomi di attori) da inserire in HTML. */
const esc = s => foundry.utils.escapeHTML(String(s));

/** Un'opzione di <select>, già scelta se value è quello attuale. */
const selectOption = (value, label, current) =>
  `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;

/** Le opzioni di un <select> da un oggetto { valore: etichetta }. */
const selectOptions = (choices, current = "") => Object.entries(choices).map(([k, l]) => selectOption(k, l, current)).join("");

const queues = new Map();

/**
 * Una operazione alla volta su uno stato salvato (chiave: "cael", "factions", "netherdeep"): chi legge, aspetta
 * dei tiri e poi scrive non sovrascrive chi ha scritto nel frattempo. Un errore arriva al chiamante ma non blocca
 * le operazioni successive.
 */
function queued(key, fn) {
  const run = (queues.get(key) ?? Promise.resolve()).then(fn);
  queues.set(key, run.catch(() => {}));
  return run;
}

/** Callback di un pulsante di DialogV2.wait: restituisce l'azione e i campi del modulo. */
const dialogSubmit = action => (_event, button) => ({ action, form: new foundry.applications.ux.FormDataExtended(button.form).object });

function metamagicCost(key, spellLevel = 0) {
  const cost = METAMAGIC[key]?.cost;
  return typeof cost === "function" ? cost(spellLevel) : (cost ?? 0);
}

/* -------------------------------------------- */
/*  Corruzione e indebolimento                  */
/* -------------------------------------------- */

/** Rende corrotta una creatura, se non lo è già. */
async function corrupt(actor) {
  if ( isCorrupted(actor) ) return getCorruptionEffect(actor);
  return ActiveEffect.implementation.create({
    name: "Corruzione da ruidium",
    img: CORRUPTION_IMG,
    description: "<p>La creatura subisce 1d10 danni psichici ogni volta che il suo livello di indebolimento "
      + "aumenta o diminuisce di 1. Solo un incantesimo <em>desiderio</em> o un intervento divino pongono fine "
      + "alla corruzione: quando succede, elimina questo effetto.</p>",
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    flags: { [MODULE_ID]: { corruption: true } }
  }, { parent: actor });
}

/** Aggiunge livelli di indebolimento passando dall'effetto di condizione di dnd5e, come fa il sistema. */
async function addExhaustion(actor, levels = 1) {
  const effect = actor.effects.get(exhaustionId());
  if ( effect ) return effect.system.increase(levels);
  const base = await ActiveEffect.implementation.fromStatusEffect("exhaustion");
  const data = foundry.utils.mergeObject(base.toObject(), { _id: exhaustionId(), "system.level": levels });
  return ActiveEffect.implementation.create(data, { parent: actor, keepId: true });
}

/**
 * Tiro salvezza su Carisma contro la corruzione.
 * Se fallisce: +1 indebolimento, poi corruzione. L'ordine conta: il primo livello non infligge danni psichici.
 * @returns {Promise<{success: boolean, total: number}|null>}  null se il tiro è stato annullato.
 */
async function corruptionSave(actor, { dc = DEFAULT_DC } = {}) {
  const rolls = await actor.rollSavingThrow({ ability: "cha", target: dc }, { configure: false });
  const roll = rolls?.[0];
  if ( !roll ) return null;
  const success = roll.total >= dc;
  if ( !success ) {
    const wasCorrupted = isCorrupted(actor);
    await addExhaustion(actor, 1);
    if ( !wasCorrupted ) await corrupt(actor);
  }
  return { success, total: roll.total };
}

/** 1d10 danni psichici per ogni livello di indebolimento guadagnato o perso da una creatura corrotta. */
async function onExhaustionChange(actor, delta) {
  if ( !delta || !isCorrupted(actor) ) return;
  const steps = Math.abs(delta);
  const roll = await new Roll(`${steps}d10`).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: `Corruzione da ruidium: l'indebolimento ${delta > 0 ? "sale" : "scende"} di ${steps}, danni psichici`
  });
  await actor.applyDamage([{ value: roll.total, type: "psychic" }]);
}

/* -------------------------------------------- */
/*  Uso del ruidium                             */
/* -------------------------------------------- */

/**
 * Consuma ruidium e risolve i tiri salvezza.
 * @param {Actor} actor
 * @param {object} config
 * @param {string} config.mode         "component" oppure una chiave di METAMAGIC.
 * @param {number} [config.spellLevel] Livello dell'incantesimo (serve per Incantesimo Gemello).
 * @param {number} [config.dc]
 */
async function useRuidium(actor, { mode = "component", spellLevel = 0, dc = DEFAULT_DC } = {}) {
  const isComponent = mode === "component";
  if ( !isComponent && !(mode in METAMAGIC) ) throw new Error(`${MODULE_ID} | opzione sconosciuta: ${mode}`);
  const ounces = isComponent ? 1 : metamagicCost(mode, spellLevel);
  const label = isComponent ? "componente materiale (500 mo)" : METAMAGIC[mode].label;

  const item = getRuidiumItem(actor);
  const available = item?.system.quantity ?? 0;
  if ( available < ounces ) {
    ui.notifications.warn(`${actor.name} ha ${available} once di ruidium, ne servono ${ounces}.`);
    return null;
  }
  await item.update({ "system.quantity": available - ounces });

  // Un tiro salvezza per ogni oncia: la regola base ne chiede uno, la metamagia uno per oncia.
  const results = [];
  for ( let i = 0; i < ounces; i++ ) {
    const result = await corruptionSave(actor, { dc });
    if ( !result ) break;
    results.push(result);
  }

  // Tiro annullato: le once senza tiro salvezza tornano nell'inventario.
  const spent = results.length;
  if ( spent < ounces ) await item.update({ "system.quantity": available - spent });
  if ( !spent ) return null;

  const failures = results.filter(r => !r.success).length;
  const list = results.map((r, i) => `<li>Oncia ${i + 1}: ${r.total} ${r.success ? "superato" : "fallito"}</li>`).join("");
  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<h3>Ruidium: ${label}</h3>`
      + `<p>Once consumate: <strong>${spent}</strong> (ne restano ${available - spent}). CD ${dc}.</p>`
      + (spent < ounces ? `<p><em>Tiro annullato: ${ounces - spent} once restituite.</em></p>` : "")
      + `<ul>${list}</ul>`
      + (failures ? `<p><strong>${failures}</strong> livelli di indebolimento.</p>` : "<p>Nessuna conseguenza.</p>")
  });
  return { ounces: spent, results, failures };
}

/** Finestra per scegliere come usare il ruidium. */
async function promptRuidium(actor) {
  if ( !actor ) return ui.notifications.warn("Seleziona un token o assegna un personaggio al tuo utente.");
  const options = [`<option value="component">Componente materiale: 1 oncia, 1 tiro salvezza</option>`]
    .concat(Object.entries(METAMAGIC).map(([key, { label, cost }]) => {
      const text = typeof cost === "function" ? "once pari al livello dell'incantesimo" : `${cost} once`;
      return `<option value="${key}">${label}: ${text}</option>`;
    })).join("");
  const available = getRuidiumItem(actor)?.system.quantity ?? 0;

  const data = await foundry.applications.api.DialogV2.input({
    window: { title: `Usare il ruidium: ${actor.name}` },
    content: `
      <p>Ruidium disponibile: <strong>${available}</strong> once.</p>
      <div class="form-group"><label>Uso</label>
        <div class="form-fields"><select name="mode">${options}</select></div></div>
      <div class="form-group"><label>Livello dell'incantesimo</label>
        <div class="form-fields"><input type="number" name="spellLevel" value="1" min="0" max="9" step="1"></div></div>
      <div class="form-group"><label>CD</label>
        <div class="form-fields"><input type="number" name="dc" value="${DEFAULT_DC}" min="1" step="1"></div></div>
      <p class="hint">Il ruidium aggiunge una sola opzione di metamagia per incantesimo. Uno stregone può
      aggiungerne un'altra, diversa, pagandola con i propri punti stregoneria.</p>`,
    ok: { label: "Usa il ruidium" }
  });
  if ( !data ) return null;
  return useRuidium(actor, { mode: data.mode, spellLevel: Number(data.spellLevel), dc: Number(data.dc) });
}

/* -------------------------------------------- */
/*  Grande finale dell'Emerald Grotto           */
/* -------------------------------------------- */

/** Nome della squadra dei personaggi: il primo attore di tipo gruppo, se c'è. */
function partyName() {
  return game.actors.find(a => a.type === "group")?.name ?? "I personaggi";
}

const RIVALS_TEAM = "Ayo Jabe e compagni";

const LOTTERY_TEAMS = [
  ["Le compagne di Maryl Bronzefang", 3],
  ["La ciurma del Crooked Tail", 2],
  ["Le Lame del Jumble", 2],
  ["I fratelli Uzga", 1]
];

/**
 * Estrae le due squadre della grande finale. Un biglietto per medaglia.
 * Se truccata, le prime due estratte sono sempre i personaggi e i rivali, in ordine casuale.
 * @param {Array<{name: string, medals: number}>} teams  La prima è i personaggi, la seconda i rivali.
 */
async function finaleLottery(teams, { rigged = true } = {}) {
  // Truccata: personaggi e rivali devono esserci comunque, con un nome e almeno un biglietto.
  if ( rigged ) teams = teams.map((t, i) => (i < 2)
    ? { name: t.name || [partyName(), RIVALS_TEAM][i], medals: Math.max(1, t.medals) } : t);
  const finalists = teams.slice(0, 2);
  teams = teams.filter(t => t.name && (t.medals > 0));
  const total = teams.reduce((n, t) => n + t.medals, 0);
  if ( teams.length < 2 ) return ui.notifications.warn("Servono almeno due squadre con almeno una medaglia.");

  let drawn;
  if ( rigged ) {
    drawn = finalists;
    if ( Math.random() < 0.5 ) drawn.reverse();
  } else {
    // Estrazione pesata senza reimmissione: una squadra uscita non può uscire di nuovo.
    const pool = [...teams];
    drawn = [];
    for ( let k = 0; k < 2; k++ ) {
      let r = Math.random() * pool.reduce((n, t) => n + t.medals, 0);
      const i = pool.findIndex(t => (r -= t.medals) < 0);
      drawn.push(pool.splice(i, 1)[0]);
    }
  }

  const rows = teams.map(t => `<tr><td>${esc(t.name)}</td><td>${t.medals}</td><td>${Math.round(t.medals / total * 100)}%</td></tr>`).join("");
  await ChatMessage.implementation.create({
    speaker: { alias: "Anziano Colbu Kaz" },
    sound: "sounds/drums.wav",
    content: `<h3>La lotteria della grande finale</h3>
      <table><thead><tr><th>Squadra</th><th>Biglietti</th><th>Probabilità</th></tr></thead><tbody>${rows}</tbody></table>
      <p>Colbu Kaz fruga nel vaso e tira fuori il primo gettone: <strong>${esc(drawn[0].name)}</strong>!</p>
      <p>Il secondo gettone è... <strong>${esc(drawn[1].name)}</strong>!</p>`
  });
  // Promemoria solo per il GM.
  if ( rigged ) await whisperGM("<p><em>Estrazione truccata: personaggi e rivali escono sempre.</em></p>");
  return drawn;
}

/** Finestra per impostare le squadre e le medaglie della lotteria. */
async function promptFinaleLottery() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può condurre la lotteria.");
  const teams = [[partyName(), 1], [RIVALS_TEAM, 5], ...LOTTERY_TEAMS];
  const rows = teams.map(([name, medals], i) => `
    <div class="form-group"><label>${i === 0 ? "Personaggi" : i === 1 ? "Rivali" : `Squadra ${i - 1}`}</label>
      <div class="form-fields">
        <input type="text" name="name${i}" value="${esc(name)}">
        <input type="number" name="medals${i}" value="${medals}" min="0" step="1" style="flex: 0 0 4em">
      </div></div>`).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Grande finale: lotteria" },
    content: `<p>Nome della squadra e medaglie vinte (un biglietto per medaglia).</p>${rows}
      <div class="form-group"><label>Truccata</label>
        <div class="form-fields"><input type="checkbox" name="rigged" checked></div></div>
      <p class="hint">Truccata: personaggi e rivali escono comunque, ma la chat mostra un'estrazione credibile.</p>`,
    ok: { label: "Estrai" }
  });
  if ( !data ) return null;
  const list = teams.map((_, i) => ({ name: String(data[`name${i}`] ?? "").trim(), medals: Number(data[`medals${i}`]) || 0 }));
  return finaleLottery(list, { rigged: !!data.rigged });
}

/** La voce dell'Occhio di Smeraldo proclama i vincitori. */
async function emeraldAnnouncement(winner) {
  await ChatMessage.implementation.create({
    speaker: { alias: "L'Occhio di Smeraldo" },
    sound: "sounds/drums.wav",
    content: `<div style="text-align:center">
      <p style="font-size:1.6em;font-weight:bold;letter-spacing:0.05em;color:#1d7a3a">${esc(winner.toUpperCase())}</p>
      <p style="font-size:2em;font-weight:bold;letter-spacing:0.2em;color:#1d7a3a">VINCITORI</p>
      <p><em>La voce rimbomba nell'acqua fino alla riva. La parete sud della caverna frana: al suo posto, un passaggio inondato di luce dorata.</em></p>
    </div>`
  });
}

async function promptEmeraldAnnouncement() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può dare l'annuncio.");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Occhio di Smeraldo: l'annuncio" },
    content: `<div class="form-group"><label>Chi ha preso l'Occhio?</label>
      <div class="form-fields"><select name="who">
        <option value="party">${esc(partyName())}</option>
        <option value="rivals">I rivali</option>
        <option value="custom">Altro (scrivi sotto)</option>
      </select></div></div>
      <div class="form-group"><label>Nome della squadra</label>
        <div class="form-fields"><input type="text" name="custom" placeholder="Il nome che la voce proclama"></div></div>`,
    ok: { label: "Annuncia" }
  });
  if ( !data ) return;
  const custom = String(data.custom ?? "").trim();
  const winner = custom || ({ party: partyName(), rivals: RIVALS_TEAM })[data.who] || partyName();
  return emeraldAnnouncement(winner);
}

/* -------------------------------------------- */
/*  La visione dell'Apotheon                    */
/* -------------------------------------------- */

/** Ultima battuta di Alyxian: dalla più esplicita alla più enigmatica. */
const VISION_ENDINGS = {
  explicit: ["Esplicita", "Dovete trovarmi! Dovete portare il Gioiello alla Cisti di Avandra, dentro il Betrayers' Rise, sotto Bazzoxan!"],
  rise: ["Senza Bazzoxan", "Dovete trovarmi! Dovete portare il Gioiello alla Cisti di Avandra, dentro il Betrayers' Rise!"],
  cyst: ["Solo la Cisti", "Dovete trovarmi! Dovete portare il Gioiello alla Cisti di Avandra!"],
  jewel: ["Solo il Gioiello", "Dovete trovarmi! Portatemi il mio Gioiello!"]
};

/** Mostra a tutti la visione di E12, con l'ultima battuta scelta. */
async function apotheonVision(ending = "cyst") {
  const line = VISION_ENDINGS[ending]?.[1];
  if ( !line ) throw new Error(`${MODULE_ID} | finale della visione sconosciuto: ${ending}`);
  await ChatMessage.implementation.create({
    speaker: { alias: "Alyxian" },
    content: `<div style="font-style:italic">
      <p>La luce attorno al piedistallo si affievolisce mentre dall'amuleto si leva una figura spettrale, un uomo umano. Indossa un'armatura di cuoio e un mantello rosso a brandelli, e porta uno scudo. Il viso, incorniciato da capelli castani e ricci, ha un'espressione malinconica. Implora: «Sono prigioniero. Vi prego, aiutatemi.»</p>
      <p>All'improvviso il terreno sparisce sotto i vostri piedi e precipitate, rotolando in un vortice di luce dorata. Cadete sempre più giù, più giù, più giù, poi vi fermate di colpo. La luce dorata si spegne e vi ritrovate sospesi in una distesa nera come la pece. Sentite l'acqua che vi sostiene. In lontananza compare una luce vermiglia, che illumina il guerriero malinconico, incatenato al suolo da ripugnanti filamenti di una sostanza carnosa e cremisi.</p>
      <p>Alza lo sguardo al cielo e, tra i singhiozzi, riesce a dire: «Tessitrice della Luna, ti scongiuro. Guida chi ha il potere di salvarmi nel luogo dove ti pregai la prima volta.» Si guarda attorno, e i suoi occhi si posano su di voi. «Oh, dèi, eccovi! Il mio nome è Alyxian. Sono perduto nelle tenebre. <strong>${line}</strong>»</p>
      <p>Sentite la coscienza abbandonarvi, come se la pressione dell'acqua vi schiacciasse la vita fuori dal corpo. La voce di Alyxian è l'ultima cosa che udite prima di svenire. «Salvatemi. Vi prego.»</p>
    </div>`
  });
  // Promemoria solo per il GM.
  await whisperGM("<p><em>Visione universale: la vedono tutti quelli che sono nell'Emerald Grotto, rivali compresi. "
      + "Tutti svengono per 1 minuto; chi è sott'acqua non annega.</em></p>");
}

async function promptApotheonVision() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può mostrare la visione.");
  const options = Object.entries(VISION_ENDINGS).map(([key, [label]]) => selectOption(key, label, "cyst")).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Visione dell'Apotheon" },
    content: `<div class="form-group"><label>Ultima battuta</label>
      <div class="form-fields"><select name="ending">${options}</select></div></div>
      <p class="hint">Più è enigmatica, più ricerche dovranno fare i personaggi prima di partire per Bazzoxan.</p>`,
    ok: { label: "Mostra la visione" }
  });
  if ( !data ) return;
  return apotheonVision(data.ending);
}

/* -------------------------------------------- */
/*  Gli studiosi di Ank'Harel                   */
/* -------------------------------------------- */

const SCHOLARS = {
  prolix: { name: "Prolix Yusaf", faction: "Allegiance", table: "REMIXPROLIXDOVE1", actor: "ODY3ZTU3NDYxZjY4" },
  question: { name: "Question", faction: "Cobalt Soul", table: "REMIXQUESTDOVE01", actor: "OWE2OWE0ZWUxMTll" },
  aloysia: { name: "Aloysia Telfan", faction: "Consortium", table: "REMIXALOYSDOVE01", actor: "M2NhMTZkYTIwNGI0" }
};

const ATTITUDES = { friendly: "amichevole", indifferent: "indifferente", hostile: "ostile" };

/** Il colpo al Gioiello, un piano per ciascun ricercatore. «Dove» si tira a caso. */
const HEISTS = {
  prolix: {
    where: [
      "Al Ready Room, di notte, mentre i personaggi dormono.",
      "Al ritorno dal Betrayers' Rise, quando i personaggi sono stanchi e feriti."
    ],
    how: "Un furto. Un ordine falso di Verin, con il sigillo copiato, requisisce il Gioiello «per esame arcano»: due soldati in buona fede lo vengono a ritirare.",
    allies: "Soldati ingannati e i fratelli Allerton (Reynard per soldi, Sebastian perché non sa dire di no al fratello).",
    escape: "La sua tavoletta del teletrasporto. Lascia una lettera di scuse, sincere: «Non era niente di personale. Era l'Allegiance.»"
  },
  question: {
    where: [
      "Al tempio fatiscente, dove i personaggi si sentono al sicuro con lei.",
      "Al Wall of the Unforgotten, durante un'offerta per i caduti."
    ],
    how: "Chiede di disegnare il Gioiello un'ultima volta e lo scambia con una copia di carta e ottone. Nell'album, aperto sul tavolo, restano gli schizzi preparatori della copia.",
    allies: "I superstiti della spedizione del Cobalt Soul, se i personaggi li hanno salvati; Foghome, se lo convince; Kalym, che chiude un occhio.",
    escape: "Non ha una tavoletta: ruba quella di Prolix o lo convince a partire con lei. Se non ci riesce, scappa a piedi verso la costa."
  },
  aloysia: {
    where: [
      "Nel Betrayers' Rise, in R16 (la scena «Scontro per il gioiello» del libro).",
      "All'uscita dal Betrayers' Rise, prima che i personaggi tornino in città.",
      "A Bazzoxan in pieno giorno, durante il prossimo attacco delle bocche gorgoglianti, quando tutti guardano altrove."
    ],
    how: "Un assalto, preceduto da un'offerta che non si può rifiutare. Se i personaggi rifiutano, attacca.",
    allies: "Mercenari dello Xhorhas; se il primo tentativo fallisce, una squadra del Consortium da Ank'Harel (due o tre occult initiate).",
    escape: "La terza tavoletta del teletrasporto."
  }
};

/**
 * Che cosa fanno i rivali, a seconda di come stanno con il ricercatore.
 * Come in «Il nemico tra gli studiosi»: chi è indifferente si unisce se ce l'ha con i personaggi, o se viene pagato.
 */
const HEIST_RIVALS = {
  friendly: "I rivali stanno dalla sua parte: partecipano al colpo, o almeno coprono la fuga.",
  indifferent: "I rivali restano a guardare, a meno che non ce l'abbiano con i personaggi o che qualcuno li paghi. "
    + "Chi offre di più se li compra, da una parte o dall'altra.",
  hostile: "I rivali stanno dall'altra parte: possono avvertire i personaggi, o mettersi in mezzo per conto loro."
};

function gmIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}

/** Un messaggio in chat visibile solo ai GM; data aggiunge altri campi (per esempio i tiri). */
const whisperGM = (content, data = {}) => ChatMessage.implementation.create({ content, whisper: gmIds(), ...data });

/** Un atteggiamento valido, oppure indifferente. */
const attitudeOr = x => (x in ATTITUDES ? x : "indifferent");

/** Il link a un attore del mondo ({ actor, name }), o solo il nome se l'attore manca. */
const actorLink = ({ actor, name }) => (game.actors.get(actor) ? `@UUID[Actor.${actor}]{${name}}` : name);

function getScholarAttitudes() {
  const saved = game.settings.get(MODULE_ID, "scholarAttitudes") ?? {};
  return Object.fromEntries(Object.keys(SCHOLARS).map(key => [key, {
    party: attitudeOr(saved[key]?.party),
    rivals: attitudeOr(saved[key]?.rivals)
  }]));
}

const scholarLink = key => actorLink(SCHOLARS[key]);

/** Tira le tabelle «Dov'è…?» e manda al GM dove si trova ciascun ricercatore. */
async function scholarsWhereabouts() {
  const entries = Object.entries(SCHOLARS);
  const missing = entries.filter(([, { table }]) => !game.tables.get(table)).map(([, { name }]) => name.split(" ")[0]);
  if ( missing.length ) {
    ui.notifications.warn(`Mancano le tabelle di ${missing.join(", ")}: ${rebuildHint(5)}`);
    return null;
  }
  const rows = await Promise.all(entries.map(async ([key, { table }]) =>
    `<li><strong>${scholarLink(key)}</strong>: ${await drawText(table) ?? "?"}</li>`));
  await whisperGM(`<h3>Studiosi: dove sono adesso</h3><ul>${rows.join("")}</ul>`);
  return rows;
}

/** Riepilogo privato degli atteggiamenti: chi porta i personaggi ad Ank'Harel, chi tenterà il colpo. */
async function scholarAttitudesReport() {
  const attitudes = getScholarAttitudes();
  const rows = Object.entries(attitudes).map(([key, { party, rivals }]) =>
    `<tr><td>${scholarLink(key)} (${SCHOLARS[key].faction})</td><td>${ATTITUDES[party]}</td><td>${ATTITUDES[rivals]}</td></tr>`).join("");
  const keys = Object.keys(attitudes);
  const names = list => list.map(k => SCHOLARS[k].name).join(", ") || "nessuno";
  const friends = keys.filter(k => attitudes[k].party === "friendly");
  const enemies = keys.filter(k => attitudes[k].party === "hostile");
  const rivalFriends = keys.filter(k => attitudes[k].rivals === "friendly");
  await whisperGM(`<h3>Studiosi: atteggiamenti</h3>
      <table><thead><tr><th>Ricercatore</th><th>Personaggi</th><th>Rivali</th></tr></thead><tbody>${rows}</tbody></table>
      <p><strong>Possono portare i personaggi ad Ank'Harel:</strong> ${names(friends)}.</p>
      <p><strong>Possono portare i rivali:</strong> ${names(rivalFriends)}.</p>
      <p><strong>Candidati al colpo al Gioiello:</strong> ${names(enemies)}.</p>`);
}

async function promptScholarAttitudes() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può segnare gli atteggiamenti.");
  const attitudes = getScholarAttitudes();
  const select = (name, value) => `<select name="${name}">${selectOptions(ATTITUDES, value)}</select>`;
  const rows = Object.entries(SCHOLARS).map(([key, { name }]) => `
    <fieldset><legend>${name}</legend>
      <div class="form-group"><label>Verso i personaggi</label>
        <div class="form-fields">${select(`${key}.party`, attitudes[key].party)}</div></div>
      <div class="form-group"><label>Verso i rivali</label>
        <div class="form-fields">${select(`${key}.rivals`, attitudes[key].rivals)}</div></div>
    </fieldset>`).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Studiosi: atteggiamenti" },
    content: rows,
    ok: { label: "Salva" }
  });
  if ( !data ) return;
  const expanded = foundry.utils.expandObject(data);
  await game.settings.set(MODULE_ID, "scholarAttitudes", Object.fromEntries(Object.keys(SCHOLARS).map(key => [key, {
    party: expanded[key]?.party ?? "indifferent",
    rivals: expanded[key]?.rivals ?? "indifferent"
  }])));
  return scholarAttitudesReport();
}

/** Manda al GM un piano pronto per il colpo al Gioiello del ricercatore nemico. */
async function heistPlan(key) {
  const heist = HEISTS[key];
  if ( !heist ) throw new Error(`${MODULE_ID} | ricercatore sconosciuto: ${key}`);
  const rivals = getScholarAttitudes()[key].rivals;
  const where = heist.where[Math.floor(Math.random() * heist.where.length)];
  await whisperGM(`<h3>Il colpo al Gioiello: ${scholarLink(key)}</h3>
      <p><strong>Dove:</strong> ${where}</p>
      <p><strong>Come:</strong> ${heist.how}</p>
      <p><strong>Con chi:</strong> ${heist.allies}</p>
      <p><strong>I rivali</strong> (${ATTITUDES[rivals]}): ${HEIST_RIVALS[rivals]}</p>
      <p><strong>Come scappa:</strong> ${heist.escape}</p>
      <p class="hint">Se è più naturale, gioca il colpo ad Ank'Harel, appena arrivati.</p>`);
}

async function promptHeistPlan() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può preparare il colpo.");
  const attitudes = getScholarAttitudes();
  // Proposta: il primo ostile ai personaggi, altrimenti Aloysia come nel libro.
  const suggested = Object.keys(SCHOLARS).find(k => attitudes[k].party === "hostile") ?? "aloysia";
  const options = Object.entries(SCHOLARS).map(([key, { name }]) =>
    selectOption(key, `${name} (${ATTITUDES[attitudes[key].party]})`, suggested)).join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Studiosi: il colpo al Gioiello" },
    content: `<div class="form-group"><label>Il nemico</label>
      <div class="form-fields"><select name="enemy">${options}</select></div></div>
      <p class="hint">Tra parentesi l'atteggiamento verso i personaggi, da «Studiosi: atteggiamenti».</p>`,
    ok: { label: "Prepara il piano" }
  });
  if ( !data ) return;
  return heistPlan(data.enemy);
}

/* -------------------------------------------- */
/*  Blocco 6: Betrayers' Rise                   */
/* -------------------------------------------- */

const RISE_TABLE = "REMIXRIVALIRISE1";
const CROSSING_TABLE = "REMIXTRAVERSATA1";

/** Le cinque cose che i rivali possono fare in un dato momento (pagina «Gestire i rivali»). */
const RIVAL_MODES = {
  together: ["Lavorano con i personaggi", "Entrano con loro. Nessuna scena da preparare: fai discutere i rivali a ogni bivio "
    + "e lascia che uno di loro trovi un indizio prima dei personaggi."],
  follow: ["Li seguono per aiutarli", "Entrano dopo, convinti che i personaggi non ce la faranno da soli. "
    + "Si fanno vedere quando le cose si mettono male, e se ne vantano per settimane."],
  own: ["Cercano per conto loro", "Vogliono arrivare per primi al luogo di preghiera e parlare con Alyxian a modo loro. "
    + "Con i personaggi sono una gara, non una guerra."],
  leave: ["Se ne sono andati", "Non sono nel Rise. Al ritorno a Bazzoxan i personaggi trovano un biglietto, o una voce: "
    + "dove sono andati e perché."],
  take: ["Vogliono il Gioiello", "Entrano per prenderlo, con le buone o con le cattive. Tengono d'occhio i personaggi "
    + "e colpiscono quando sono stanchi: dopo un combattimento, o in R16 subito dopo la visione."]
};

/** Modalità in cui i rivali sono nel Rise per conto loro: solo qui servono un incontro e la guerra per procura. */
const RIVALS_APART = ["follow", "own", "take"];

/** Come guida ciascuno studioso nella traversata (opzione «La guida»). */
const GUIDES = {
  prolix: "Ha le mappe copiate all'Aurora Watch, tutte sbagliate in modo diverso, e le consulta a ogni bivio. "
    + "Conta i passi ad alta voce, si ferma a misurare tutto e chiede ai personaggi di fargli luce.",
  question: "Cammina davanti, disegna mentre cammina e sa dove sono morti i suoi compagni. Quando ci passano accanto "
    + "si ferma un momento, poi riparte senza dire niente. Racconta la battaglia dei Barbed Fields come se l'avesse vista.",
  aloysia: "Conosce la strada fino a dove è arrivata da sola, poi improvvisa e non lo ammette. Raccoglie ogni scheggia "
    + "rossa che trova. Tra la strada sicura e quella con il ruidium sceglie sempre la seconda."
};

/**
 * Pesca un risultato da una tabella del modulo, se serve solo tra quelli adatti a una modalità.
 * @returns {Promise<string|null>}  Il testo del risultato, oppure null se la tabella manca.
 */
async function drawText(tableId, { mode } = {}) {
  const table = game.tables.get(tableId);
  if ( !table ) return null;
  let results = table.results.contents;
  if ( mode ) results = results.filter(r => r.getFlag(MODULE_ID, "modes")?.includes(mode) ?? true);
  if ( !results.length ) return null;
  let pick = Math.random() * results.reduce((sum, r) => sum + r.weight, 0);
  const result = results.find(r => (pick -= r.weight) < 0) ?? results.at(-1);
  return result.description;
}

/** Come rimediare quando manca un pezzo di un blocco: rilanciare la macro del suo diario. */
const rebuildHint = block => `lancia «Remix: crea il diario del blocco ${block}».`;

/** Il testo da mostrare quando manca una tabella del modulo. */
function missingTable(name, block) {
  return `<em>Manca la tabella «${name}»: ${rebuildHint(block)}</em>`;
}

/** Manda al GM chi muove i rivali nel Betrayers' Rise, che cosa vogliono e dove si incontrano. */
async function risePlan(mode, employer) {
  if ( !(mode in RIVAL_MODES) ) throw new Error(`${MODULE_ID} | modalità sconosciuta: ${mode}`);
  const [label, advice] = RIVAL_MODES[mode];
  const lines = [`<p><strong>Che cosa fanno:</strong> ${label}. ${advice}</p>`];
  if ( mode !== "leave" ) {
    if ( employer in SCHOLARS ) {
      lines.push(`<p><strong>Per chi lavorano:</strong> ${scholarLink(employer)} (${SCHOLARS[employer].faction}).</p>`);
      const attitudes = getScholarAttitudes();
      const others = Object.keys(SCHOLARS).filter(k => (k !== employer) && (attitudes[k].party === "friendly"));
      if ( RIVALS_APART.includes(mode) && others.length ) lines.push("<p><strong>Guerra per procura:</strong> "
        + `i personaggi stanno con ${others.map(scholarLink).join(" e ")}. Due squadre, due committenti, un solo Gioiello.</p>`);
    }
    else lines.push("<p><strong>Per chi lavorano:</strong> per nessuno, o almeno così dicono.</p>");
  }
  if ( RIVALS_APART.includes(mode) ) {
    const where = await drawText(RISE_TABLE, { mode });
    lines.push(`<p><strong>Dove li incontrate:</strong> ${where ?? missingTable("Rivali nel Betrayers' Rise", 6)}</p>`);
  }
  await whisperGM(`<h3>Betrayers' Rise: i rivali</h3>${lines.join("")}`);
}

async function promptRisePlan() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const attitudes = getScholarAttitudes();
  // Proposta: chi è amico dei rivali ma non dei personaggi (così c'è la guerra per procura), poi qualunque amico dei rivali.
  const keys = Object.keys(SCHOLARS);
  const suggested = keys.find(k => (attitudes[k].rivals === "friendly") && (attitudes[k].party !== "friendly"))
    ?? keys.find(k => attitudes[k].rivals === "friendly") ?? "";
  const modes = Object.entries(RIVAL_MODES).map(([k, [label]]) => selectOption(k, label, "follow")).join("");
  const employers = [selectOption("", "Nessuno", suggested), ...Object.entries(SCHOLARS).map(([k, { name }]) =>
    selectOption(k, `${name} (${ATTITUDES[attitudes[k].rivals]} con i rivali)`, suggested))].join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Betrayers' Rise: i rivali" },
    content: `<div class="form-group"><label>Che cosa fanno</label>
        <div class="form-fields"><select name="mode">${modes}</select></div></div>
      <div class="form-group"><label>Per chi lavorano</label>
        <div class="form-fields"><select name="employer">${employers}</select></div></div>
      <p class="hint">Gli atteggiamenti vengono da «Studiosi: atteggiamenti».</p>`,
    ok: { label: "Prepara la scena" }
  });
  if ( !data ) return;
  return risePlan(data.mode, data.employer);
}

/** La traversata del Rise con una guida: tappe del montaggio pescate senza ripetizioni, mandate al GM. */
async function riseCrossing(guide, stops = 3) {
  const lines = [];
  if ( guide in GUIDES ) lines.push(`<p><strong>La guida:</strong> ${scholarLink(guide)}. ${GUIDES[guide]}</p>`);
  else lines.push("<p><strong>Senza guida:</strong> i personaggi si orientano con gli appunti rubati a uno studioso. "
    + "A ogni tappa, una prova di Saggezza (Sopravvivenza) con CD 15: se fallisce, la tappa costa un incontro in più "
    + "(tabella «Incontri nel Betrayers' Rise» del libro).</p>");
  const table = game.tables.get(CROSSING_TABLE);
  if ( table ) {
    const pool = table.results.contents.map(r => r.description);
    const picked = [];
    for ( let i = Math.clamp(stops, 1, pool.length); i > 0; i-- ) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    lines.push(`<ol>${picked.map(t => `<li>${t}</li>`).join("")}</ol>`);
  }
  else lines.push(`<p>${missingTable("Traversata del Betrayers' Rise", 6)}</p>`);
  lines.push("<p>Alla fine del montaggio si torna al tempo reale: i personaggi sono sul ponte di R1, "
    + "all'ingresso della Cisti di Avandra.</p>");
  await whisperGM(`<h3>Betrayers' Rise: la traversata</h3>${lines.join("")}`);
}

async function promptRiseCrossing() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const attitudes = getScholarAttitudes();
  // Proposta: il primo studioso amichevole verso i personaggi.
  const suggested = Object.keys(SCHOLARS).find(k => attitudes[k].party === "friendly") ?? "";
  const guides = [...Object.entries(SCHOLARS).map(([k, { name }]) =>
    selectOption(k, `${name} (${ATTITUDES[attitudes[k].party]})`, suggested)),
    selectOption("", "Nessuno: usano appunti rubati", suggested)].join("");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Betrayers' Rise: la traversata" },
    content: `<div class="form-group"><label>La guida</label>
        <div class="form-fields"><select name="guide">${guides}</select></div></div>
      <div class="form-group"><label>Tappe</label>
        <div class="form-fields"><input type="number" name="stops" value="3" min="1" max="8" step="1"></div></div>`,
    ok: { label: "Prepara la traversata" }
  });
  if ( !data ) return;
  return riseCrossing(data.guide, Number(data.stops) || 3);
}

/* -------------------------------------------- */
/*  Blocco 7: Cael Morrow                       */
/* -------------------------------------------- */

const CAEL_TABLE = "REMIXCAELINCONT1";
const TRACES_TABLE = "REMIXCAELTRACCE1";
const CAEL_JOURNAL = "Remix: blocco 7";
const CAEL_PAGE = "Mappa a punti di Cael Morrow";

/** Livelli di allerta dell'Allegiance (pagina «Accesso a Cael Morrow e sicurezza»). */
const ALERT_LEVELS = [
  ["Calma", "Chi ha il distintivo passa con poche domande."],
  ["Sospetto", "Distintivi controllati anche nelle gallerie, nessuno scavatore da solo."],
  ["Allerta", "Pattuglie nelle gallerie e sui percorsi segnalati, rinforzi dal Crystal Chateau entro un giorno."],
  ["Serrata", "Gallerie spente tranne quelle del campo base e dell'Avamposto, Pozzo chiuso, Cryon all'Avamposto."]
];

/**
 * Un file del modulo letto una sola volta. Se la lettura fallisce si riprova alla chiamata successiva.
 * @returns {() => Promise<any>}
 */
function cachedText(path, transform = text => text) {
  let cache;
  return () => cache ??= fetchText(path).then(transform).catch(err => {
    cache = null;
    throw err;
  });
}

/** Come cachedText, per un file JSON. */
const cachedJson = (path, transform = data => data) => cachedText(path, text => transform(JSON.parse(text)));

/** Nodi, percorsi e fazioni del pointcrawl, letti una volta da journal/cael-morrow.json. */
const caelMap = cachedJson("journal/cael-morrow.json", data => {
  data.nodeById = new Map(data.nodes.map(n => [n.id, n]));
  const keys = new Set(data.paths.map(pathKey));
  for ( const n of data.nodes ) {
    for ( const k of n.hazard?.flood ?? [] ) if ( !keys.has(k) ) console.warn(`${MODULE_ID} | ${n.id}: il percorso ${k} non esiste`);
  }
  return data;
});

const pathKey = p => `${p.a}|${p.b}`;
const touches = (p, id) => (p.a === id) || (p.b === id);
const otherEnd = (p, id) => (p.a === id ? p.b : p.a);
const hoursText = h => (h === 1 ? "1 ora" : `${h} ore`);

/** Lo stato salvato, completato con i valori iniziali del file dati dove manca. */
async function getCaelState() {
  const data = await caelMap();
  const saved = game.settings.get(MODULE_ID, "caelMorrow") ?? {};
  const nodes = Object.fromEntries(data.nodes.map(n => {
    const s = saved.nodes?.[n.id] ?? {};
    return [n.id, {
      control: ("control" in s) ? (s.control in data.factions ? s.control : "") : n.control,
      known: Array.isArray(s.known) ? s.known.filter(k => k in data.factions) : [...n.known]
    }];
  }));
  const paths = Object.fromEntries(data.paths.map(p => {
    const type = saved.paths?.[pathKey(p)];
    return [pathKey(p), type in data.pathTypes ? type : p.type];
  }));
  const party = saved.party ?? {};
  const traveled = party.traveled ?? [];
  return {
    nodes, paths,
    party: {
      node: party.node in nodes ? party.node : data.start,
      hours: Number(party.hours) || 0,
      visited: party.visited ?? [data.start],
      traveled,
      // Un percorso nascosto già seguito è per forza scoperto.
      discovered: [...new Set([...(party.discovered ?? []), ...traveled])]
    },
    alert: Math.clamp(Number(saved.alert) || 0, 0, ALERT_LEVELS.length - 1)
  };
}

/** Salva solo ciò che differisce dal file dati, così le correzioni al JSON valgono anche a partita iniziata. */
async function setCaelState(state) {
  const data = await caelMap();
  const nodes = {};
  for ( const n of data.nodes ) {
    const s = state.nodes[n.id];
    const diff = {};
    if ( s.control !== n.control ) diff.control = s.control;
    const known = [...s.known].sort();
    if ( known.join() !== [...n.known].sort().join() ) diff.known = known;
    if ( !foundry.utils.isEmpty(diff) ) nodes[n.id] = diff;
  }
  const paths = {};
  for ( const p of data.paths ) {
    const type = state.paths[pathKey(p)];
    if ( type !== p.type ) paths[pathKey(p)] = type;
  }
  return game.settings.set(MODULE_ID, "caelMorrow", { nodes, paths, party: state.party, alert: state.alert });
}

/** Un percorso nascosto si può seguire solo dopo averlo scoperto. */
const pathUsable = (p, state) => !p.hidden || state.party.discovered.includes(pathKey(p));

/** Il tipo di un percorso adesso: quello salvato, salvo le gallerie spente dalla serrata (restano accese quelle dei punti sealedExempt). */
function effectiveType(data, p, state) {
  const type = state.paths[pathKey(p)];
  if ( (type === "galleria") && (state.alert >= 3) && !data.nodeById.get(p.a).sealedExempt && !data.nodeById.get(p.b).sealedExempt ) return "sommerso";
  return type;
}

/** La CD della prova di orientamento, oppure null se non serve. */
function navigationDC(p, type, state) {
  if ( type === "galleria" ) return null;
  if ( type === "segnalato" ) {
    if ( !p.marker ) return null;
    const ends = [state.nodes[p.a].control, state.nodes[p.b].control];
    return ends.includes(p.marker) ? null : 10;
  }
  return (p.hidden && !state.party.traveled.includes(pathKey(p))) ? 15 : 13;
}

/** Il numero massimo su 1d6 che dà un incontro, per ogni ora di viaggio. */
function encounterThreshold(data, type, state, { light }) {
  let n = data.pathTypes[type].encounter;
  if ( (state.alert >= 2) && (type !== "sommerso") ) n += 1;
  if ( light && (type !== "galleria") ) n += 1;
  return n;
}

function pathHours(p, from, type, { noSwim }) {
  const hours = ((from === p.b) && p.hoursBack) ? p.hoursBack : p.hours;
  return (noSwim && (type === "sommerso")) ? hours * 2 : hours;
}

/** La pagina «Mappa a punti di Cael Morrow» del blocco 7, se il diario esiste. */
const caelPage = () => modulePage("28-mappa-a-punti.html");

/** Il titolo di un punto nella pagina «Mappa a punti»: link e note della scena puntano lì. */
const nodeTitle = node => `${node.code}: ${node.name}`;

/** Link alla descrizione di un punto nella pagina «Mappa a punti», se il diario del blocco 7 esiste. */
function nodeLink(node) {
  const title = nodeTitle(node);
  const page = caelPage();
  if ( !page ) return title;
  return `@UUID[${page.uuid}#${foundry.documents.JournalEntryPage.slugifyHeading(title)}]{${title}}`;
}

/**
 * Un tratto di viaggio dal punto in cui si trova il gruppo a un punto vicino.
 * @param {object} options
 * @param {string} options.to                 Id del punto di destinazione.
 * @param {string} [options.navigator]        Id dell'attore che guida: tira Saggezza (Sopravvivenza).
 * @param {string} [options.outcome]          Senza guida: "success" o "fail", deciso dal GM.
 * @param {boolean} [options.noSwim]          Qualcuno non ha velocità di nuotare: i tratti sommersi durano il doppio.
 * @param {boolean} [options.light]           Il gruppo viaggia con una luce accesa.
 * @param {boolean} [options.advanceTime]     Fa avanzare l'orologio del mondo.
 * @param {boolean} [options.trace]           Pesca una traccia delle fazioni all'arrivo.
 */
function caelTravel(options) {
  return queued("cael", () => travelLeg(options));
}

async function travelLeg({ to, navigator, outcome = "success", noSwim = false, light = true, advanceTime = false, trace = false }) {
  const data = await caelMap();
  const state = await getCaelState();
  const from = state.party.node;
  const nodes = data.nodeById;
  const path = data.paths.find(p => touches(p, from) && touches(p, to) && (from !== to));
  if ( !path ) throw new Error(`${MODULE_ID} | nessun percorso da ${from} a ${to}`);
  if ( !pathUsable(path, state) ) {
    ui.notifications.warn(`Il percorso ${path.a}-${path.b} è nascosto e il gruppo non l'ha ancora scoperto.`);
    return null;
  }
  const lines = [];
  const rolls = [];
  const intended = nodes.get(to);

  // Orientamento: il tiro resta al GM, perché chi si perde non se ne accorge
  const type = effectiveType(data, path, state);
  const dc = navigationDC(path, type, state);
  let success = true;
  if ( dc ) {
    const actor = game.actors.get(navigator);
    if ( actor ) {
      const result = await actor.rollSkill({ skill: "sur", target: dc }, { configure: false }, { create: false });
      const roll = Array.isArray(result) ? result[0] : result;
      if ( !roll ) return null;
      rolls.push(roll);
      success = roll.total >= dc;
      lines.push(`<p><strong>Orientamento:</strong> ${esc(actor.name)} fa ${roll.total} contro CD ${dc}: ${success ? "riuscita" : "fallita"}.</p>`);
    } else {
      success = outcome !== "fail";
      lines.push(`<p><strong>Orientamento:</strong> CD ${dc}, ${success ? "riuscita" : "fallita"} (deciso dal GM).</p>`);
    }
  }

  // Il tratto percorso davvero. Chi si perde segue un altro percorso sommerso che parte dallo stesso punto,
  // oppure gira in tondo per un'ora e torna dove era partito (path null).
  const legOf = p => {
    const t = effectiveType(data, p, state);
    return { path: p, dest: otherEnd(p, from), type: t, hours: pathHours(p, from, t, { noSwim }) };
  };
  let leg = legOf(path);
  if ( !success ) {
    const others = data.paths.filter(p => (p !== path) && touches(p, from)
      && (effectiveType(data, p, state) === "sommerso") && pathUsable(p, state));
    if ( others.length ) {
      leg = legOf(others[Math.floor(Math.random() * others.length)]);
      lines.push(`<p><strong>Si perdono.</strong> Credono di andare verso ${intended.code}, invece arrivano a ${nodes.get(leg.dest).code}. `
        + "Descrivi l'arrivo come se fosse il posto giusto, finché i giocatori non se ne accorgono.</p>");
    } else {
      leg = { path: null, dest: from, type, hours: 1 };
      lines.push("<p><strong>Si perdono.</strong> Girano in tondo per un'ora e tornano al punto di partenza.</p>");
    }
  }
  const { dest, hours } = leg;
  lines.unshift(`<p><strong>Da</strong> ${nodes.get(from).code} <strong>verso</strong> ${intended.code}: `
    + `${data.pathTypes[leg.type].name.toLowerCase()}, ${hoursText(hours)}.</p>`);

  // Incontri, ora per ora: un dado per ogni ora
  const threshold = encounterThreshold(data, leg.type, state, { light });
  const encounterRoll = await new Roll(`${hours}d6`).evaluate();
  rolls.push(encounterRoll);
  const faces = encounterRoll.dice[0].results.map(r => r.result);
  const encounters = [];
  for ( const [i, face] of faces.entries() ) {
    if ( face > threshold ) continue;
    const text = await drawText(CAEL_TABLE, { mode: leg.type }) ?? missingTable("Incontri nel pointcrawl di Cael Morrow", 7);
    encounters.push(`<li><strong>Ora ${i + 1}:</strong> ${text}</li>`);
  }
  const rule = `1-${threshold} su 1d6 a ogni ora; dadi: ${faces.join(", ")}`;
  lines.push(encounters.length ? `<p><strong>Incontri</strong> (${rule}):</p><ul>${encounters.join("")}</ul>`
    : `<p><strong>Incontri:</strong> nessuno (${rule}).</p>`);

  // Pericoli del punto d'arrivo (la chiave di volta di M5a): un tiro a ogni arrivo, finché i percorsi non sono già allagati
  const arrival = nodes.get(dest);
  const hazard = arrival.hazard;
  if ( hazard?.flood.some(k => state.paths[k] !== "sommerso") ) {
    const roll = await new Roll(hazard.roll).evaluate();
    rolls.push(roll);
    if ( roll.total <= hazard.on ) {
      for ( const k of hazard.flood ) state.paths[k] = "sommerso";
      lines.push(`<p><strong>${hazard.name}:</strong> ${roll.total} su ${hazard.roll}. ${hazard.text}</p>`);
    } else {
      lines.push(`<p><strong>${hazard.name}:</strong> ${roll.total} su ${hazard.roll}, regge.</p>`);
    }
  }

  // Arrivo
  const control = state.nodes[dest].control;
  lines.push(`<p><strong>Arrivo:</strong> ${nodeLink(arrival)}. Controllo: ${control ? data.factions[control].name : "nessuno"}.</p>`);
  const firstVisit = !state.party.visited.includes(dest);
  if ( firstVisit ) lines.push("<p>È la prima volta che i personaggi ci arrivano.</p>");
  if ( trace ) {
    const text = await drawText(TRACES_TABLE) ?? missingTable("Tracce delle fazioni a Cael Morrow", 7);
    lines.push(`<p><strong>Traccia:</strong> ${text}</p>`);
  }
  if ( state.alert ) lines.push(`<p><strong>Allerta ${state.alert}, ${ALERT_LEVELS[state.alert][0]}:</strong> ${ALERT_LEVELS[state.alert][1]}</p>`);

  state.party.node = dest;
  state.party.hours += hours;
  if ( firstVisit ) state.party.visited.push(dest);
  // Si tiene traccia solo dei percorsi nascosti: getCaelState li conta anche come scoperti.
  if ( leg.path?.hidden && !state.party.traveled.includes(pathKey(leg.path)) ) state.party.traveled.push(pathKey(leg.path));
  await setCaelState(state);
  if ( advanceTime ) await game.time.advance(hours * 3600);

  lines.push(`<p class="hint">Ore passate a Cael Morrow dall'ultimo azzeramento: ${state.party.hours}.</p>`);
  await whisperGM(`<h3>Cael Morrow: viaggio</h3>${lines.join("")}`, { rolls });
  return { from, to, dest, hours, success };
}

async function promptCaelTravel() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const data = await caelMap();
  const state = await getCaelState();
  const from = state.party.node;
  const nodes = data.nodeById;
  const usable = data.paths.filter(p => touches(p, from) && pathUsable(p, state));
  if ( !usable.length ) {
    ui.notifications.warn(`Da ${nodes.get(from).code} non parte nessun percorso conosciuto: segna come scoperto un percorso `
      + "nascosto, o sposta il gruppo, in «Cael Morrow: fazioni e allerta».");
    return null;
  }
  const exits = usable.map(p => {
    const type = effectiveType(data, p, state);
    const hours = pathHours(p, from, type, {});
    const other = nodes.get(otherEnd(p, from));
    let tag = "";
    if ( p.hidden ) tag = state.party.traveled.includes(pathKey(p)) ? " [nascosto]" : " [nascosto, mai percorso]";
    return selectOption(other.id, `${other.code} ${other.name} (${data.pathTypes[type].name.toLowerCase()}, ${hoursText(hours)})${tag}`);
  }).join("");
  const navigators = game.actors.filter(a => (a.type === "character") && a.hasPlayerOwner)
    .map(a => selectOption(a.id, a.name)).join("");
  const data2 = await foundry.applications.api.DialogV2.input({
    window: { title: `Cael Morrow: viaggio da ${nodes.get(from).code}` },
    content: `<p>Il gruppo è a <strong>${nodes.get(from).code} ${nodes.get(from).name}</strong>. Per spostarlo altrove senza viaggiare usa «Cael Morrow: fazioni e allerta».</p>
      <div class="form-group"><label>Verso</label><div class="form-fields"><select name="to">${exits}</select></div></div>
      <div class="form-group"><label>Chi guida</label><div class="form-fields"><select name="navigator">
        <option value="">Nessuno: decido io</option>${navigators}</select></div></div>
      <div class="form-group"><label>Se decido io</label><div class="form-fields"><select name="outcome">
        <option value="success">La prova riesce</option><option value="fail">La prova fallisce</option></select></div></div>
      <div class="form-group"><label>Qualcuno non sa nuotare</label><div class="form-fields"><input type="checkbox" name="noSwim"></div></div>
      <div class="form-group"><label>Viaggiano con una luce</label><div class="form-fields"><input type="checkbox" name="light" checked></div></div>
      <div class="form-group"><label>Traccia delle fazioni all'arrivo</label><div class="form-fields"><input type="checkbox" name="trace"></div></div>
      <div class="form-group"><label>Fai avanzare l'orologio del mondo</label><div class="form-fields"><input type="checkbox" name="advanceTime"></div></div>
      <p class="hint">La prova di orientamento serve solo sui percorsi sommersi e sui segnalati senza segni. Il tiro arriva solo al GM.
        I percorsi nascosti compaiono qui dopo che li hai segnati come scoperti in «Cael Morrow: fazioni e allerta».</p>`,
    ok: { label: "Parti" }
  });
  if ( !data2 ) return;
  return caelTravel(data2);
}

/** Resoconto privato: dove sono i personaggi, l'allerta, chi controlla che cosa, i percorsi cambiati. */
async function caelReport() {
  const data = await caelMap();
  const state = await getCaelState();
  const nodes = data.nodeById;
  const rows = Object.entries(data.factions).map(([key, { name }]) => {
    const held = data.nodes.filter(n => state.nodes[n.id].control === key).map(n => n.code);
    const known = data.nodes.filter(n => state.nodes[n.id].known.includes(key)).length;
    return `<tr><td>${name}</td><td>${held.join(", ") || "niente"}</td><td>${known}</td></tr>`;
  }).join("");
  const changed = data.paths.filter(p => state.paths[pathKey(p)] !== p.type)
    .map(p => `<li>${p.a}-${p.b}: ${data.pathTypes[state.paths[pathKey(p)]].name.toLowerCase()}</li>`);
  const found = data.paths.filter(p => p.hidden && pathUsable(p, state)).map(p => `${p.a}-${p.b}`);
  if ( found.length ) changed.push(`<li>Percorsi nascosti scoperti: ${found.join(", ")}</li>`);
  const [alertName, alertText] = ALERT_LEVELS[state.alert];
  await whisperGM(`<h3>Cael Morrow: stato</h3>
      <p><strong>Il gruppo</strong> è a ${nodeLink(nodes.get(state.party.node))}, dopo ${state.party.hours} ore in città. Punti visti: ${state.party.visited.length} su ${data.nodes.length}.</p>
      <p><strong>Allerta ${state.alert}, ${alertName}:</strong> ${alertText}</p>
      <table><thead><tr><th>Fazione</th><th>Controlla</th><th>Punti noti</th></tr></thead><tbody>${rows}</tbody></table>
      ${changed.length ? `<p><strong>Percorsi:</strong></p><ul>${changed.join("")}</ul>` : ""}`);
}

async function promptCaelControl() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const data = await caelMap();
  const state = await getCaelState();
  const factions = Object.entries(data.factions);
  const nodeRows = data.nodes.map(n => {
    const s = state.nodes[n.id];
    const control = [selectOption("", "nessuno", s.control), ...factions.map(([k, f]) => selectOption(k, f.name, s.control))].join("");
    const known = factions.map(([k]) => `<td><input type="checkbox" name="known.${n.id}.${k}"${s.known.includes(k) ? " checked" : ""}></td>`).join("");
    return `<tr><td>${n.code} ${n.name}</td><td><select name="control.${n.id}">${control}</select></td>${known}</tr>`;
  }).join("");
  const pathRows = data.paths.map(p => {
    const types = Object.entries(data.pathTypes).map(([k, t]) => selectOption(k, t.name, state.paths[pathKey(p)])).join("");
    const discovered = p.hidden ? `<label><input type="checkbox" name="found.${pathKey(p)}"`
      + `${state.party.discovered.includes(pathKey(p)) ? " checked" : ""}> scoperto</label>` : "";
    return `<tr><td>${p.a}-${p.b}${p.hidden ? " (nascosto)" : ""}</td><td><select name="path.${pathKey(p)}">${types}</select></td><td>${discovered}</td></tr>`;
  }).join("");
  const position = data.nodes.map(n => selectOption(n.id, `${n.code} ${n.name}`, state.party.node)).join("");
  const alerts = ALERT_LEVELS.map(([name], i) => selectOption(String(i), `${i}. ${name}`, String(state.alert))).join("");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: "Cael Morrow: fazioni e allerta", resizable: true },
    position: { width: 720, height: 760 },
    content: `<div style="max-height:600px;overflow-y:auto">
      <fieldset><legend>Il gruppo e l'Allegiance</legend>
        <div class="form-group"><label>Dove sono i personaggi</label><div class="form-fields"><select name="partyNode">${position}</select></div></div>
        <div class="form-group"><label>Ore passate in città</label><div class="form-fields"><input type="number" name="partyHours" value="${state.party.hours}" min="0" step="1"></div></div>
        <div class="form-group"><label>Allerta</label><div class="form-fields"><select name="alert">${alerts}</select></div></div>
      </fieldset>
      <fieldset><legend>Punti: chi li controlla, chi li conosce</legend>
        <table><thead><tr><th>Punto</th><th>Controllo</th>${factions.map(([k]) => `<th>${data.factions[k].short ?? k}</th>`).join("")}</tr></thead>
        <tbody>${nodeRows}</tbody></table></fieldset>
      <fieldset><legend>Percorsi</legend><table><tbody>${pathRows}</tbody></table></fieldset></div>`,
    buttons: [
      { action: "save", label: "Salva", icon: "fa-solid fa-check", default: true, callback: dialogSubmit("save") },
      { action: "reset", label: "Torna allo stato iniziale", icon: "fa-solid fa-rotate-left", type: "button" }
    ]
  });
  if ( !result ) return;
  if ( result === "reset" ) {
    const ok = await DialogV2.confirm({
      window: { title: "Cael Morrow: stato iniziale" },
      content: "<p>Controllo dei punti, percorsi, allerta, posizione del gruppo, ore e percorsi scoperti tornano come all'inizio. Non si può annullare.</p>"
    });
    if ( !ok ) return;
    await queued("cael", () => game.settings.set(MODULE_ID, "caelMorrow", {}));
    return caelReport();
  }
  const form = foundry.utils.expandObject(result.form);
  // Il dialogo non è modale: mentre era aperto un viaggio può aver spostato il gruppo o allagato percorsi.
  // Si riparte dallo stato attuale e si applica solo quello che il GM ha cambiato rispetto a ciò che vedeva.
  const sameList = (a, b) => [...a].sort().join() === [...b].sort().join();
  const pick = (shown, sent, now, same = (x, y) => x === y) => (same(shown, sent) ? now : sent);
  await queued("cael", async () => {
    const now = await getCaelState();
    for ( const n of data.nodes ) {
      const shown = state.nodes[n.id];
      const control = form.control?.[n.id] ?? "";
      const known = Object.keys(data.factions).filter(k => form.known?.[n.id]?.[k]);
      now.nodes[n.id] = { control: pick(shown.control, control, now.nodes[n.id].control),
        known: pick(shown.known, known, now.nodes[n.id].known, sameList) };
    }
    for ( const p of data.paths ) {
      const k = pathKey(p);
      now.paths[k] = pick(state.paths[k], form.path?.[k] ?? p.type, now.paths[k]);
    }
    now.alert = pick(state.alert, Number(form.alert) || 0, now.alert);
    const party = now.party;
    party.node = pick(state.party.node, form.partyNode, party.node);
    party.hours = pick(state.party.hours, Number(form.partyHours) || 0, party.hours);
    if ( !party.visited.includes(party.node) ) party.visited.push(party.node);
    const shownFound = data.paths.filter(p => p.hidden && state.party.discovered.includes(pathKey(p))).map(pathKey);
    const sentFound = data.paths.filter(p => p.hidden && form.found?.[pathKey(p)]).map(pathKey);
    party.discovered = pick(shownFound, sentFound, party.discovered, sameList);
    // Togliere la spunta a un percorso già seguito lo fa dimenticare anche come percorso seguito.
    party.traveled = party.traveled.filter(k => party.discovered.includes(k));
    await setCaelState(now);
  });
  return caelReport();
}

/* -------------------------------------------- */
/*  Blocco 8: missioni di fazione               */
/* -------------------------------------------- */

const MOVES_TABLE = "REMIXMOSSEANKH01";

/** Chi può avere un orologio: nome, colore dello spicchio pieno, nome corto per il dialogo. */
const CLOCK_OWNERS = {
  allegiance: ["Allegiance of Allsight", "#d68910", "Allegiance"],
  consortium: ["Consortium of the Vermilion Dream", "#c0392b", "Consortium"],
  cobalt: ["Cobalt Soul", "#2471a3", "Cobalt Soul"],
  sentinels: ["Sentinels of Memory", "#5d6d7e", "Sentinels"],
  aboleth: ["Aboleth Alyxian", "#7d3c98", "Aboleth"],
  party: ["I personaggi", "#1e8449", "Personaggi"],
  rivals: ["I rivali", "#b7950b", "Rivali"]
};

/** Le fazioni in cui possono entrare personaggi e rivali. */
const JOINABLE = ["allegiance", "consortium", "cobalt"];

const PLACES = { ankharel: "Ank'Harel", cael: "Cael Morrow" };

/** Chi fa una mossa al turno delle fazioni in ciascun luogo. I rivali si aggiungono se hanno una fazione o orologi loro. */
const MOVERS = {
  ankharel: ["allegiance", "consortium", "cobalt", "sentinels"],
  cael: ["allegiance", "consortium", "cobalt", "sentinels", "aboleth"]
};

/** Le contese con i loro orologi, lette una volta da journal/contese.json. */
const contests = cachedJson("journal/contese.json");

/** Il libro: se i personaggi entrano nel Consortium i rivali vanno nell'Allegiance, altrimenti nel Consortium. */
const bookRivals = party => (party === "consortium" ? "allegiance" : (party ? "consortium" : ""));

/** Un numero intero tra lo e hi; se il valore non è un numero, fallback. */
const intIn = (x, fallback, lo, hi) => Math.clamp(Math.round(Number(x)) || fallback, lo, hi);

/** Gli spicchi di un orologio: da 2 a 12. */
const clockSize = (x, fallback) => intIn(x, fallback, 2, 12);

/** Un orologio nuovo: vuoto e nascosto ai giocatori. */
const newClock = ({ name, owner, size, full = "", contest = "" }) =>
  ({ id: foundry.utils.randomID(), name, owner, size, value: 0, full, contest, visible: false });

/** Lo stato salvato, ripulito: fazione dei personaggi, dei rivali («split» se divisi) e orologi. */
function getFactionState() {
  const saved = game.settings.get(MODULE_ID, "factionMissions") ?? {};
  const joinable = v => (JOINABLE.includes(v) ? v : "");
  const clocks = (saved.clocks ?? []).filter(c => c?.id && (c.owner in CLOCK_OWNERS)).map(c => {
    const size = clockSize(c.size, 4);
    return {
      id: c.id, name: String(c.name ?? ""), owner: c.owner, size,
      value: intIn(c.value, 0, 0, size),
      full: String(c.full ?? ""), contest: c.contest ?? "", visible: !!c.visible
    };
  });
  return { party: joinable(saved.party), rivals: saved.rivals === "split" ? "split" : joinable(saved.rivals), clocks };
}

const setFactionState = state => game.settings.set(MODULE_ID, "factionMissions", state);

function factionName(key) {
  if ( key === "split" ) return "divisi tra due fazioni";
  return CLOCK_OWNERS[key]?.[0] ?? "nessuna";
}

/**
 * Un orologio disegnato come cerchio a spicchi: un div con due gradienti conici, le righe degli spicchi sopra
 * e la parte piena sotto. La chat di Foundry toglie gli <svg> dai messaggi, ma tiene gli stili.
 */
function clockDial({ size, value, owner }, px = 44) {
  const color = CLOCK_OWNERS[owner][1];
  const slice = 360 / size;
  const filled = slice * value;
  return `<div style="width:${px}px;height:${px}px;flex:none;box-sizing:border-box;border-radius:50%;border:2px solid #222;`
    + `background:repeating-conic-gradient(#222 0deg 1.5deg, transparent 1.5deg ${slice}deg),`
    + `conic-gradient(${color} 0deg ${filled}deg, #f4f1e8 ${filled}deg 360deg)"></div>`;
}

function clockRow(clock) {
  const name = esc(clock.name);
  return `<div style="display:flex;gap:8px;align-items:center;margin:4px 0">${clockDial(clock)}`
    + `<div><strong>${name}</strong><br>${CLOCK_OWNERS[clock.owner][0]}, ${clock.value} su ${clock.size}</div></div>`;
}

/** Gli orologi appena riempiti, con quello che succede adesso. */
function fullClocksHtml(clocks) {
  if ( !clocks.length ) return "";
  return `<h4>Orologi pieni</h4>${clocks.map(c => `${clockRow(c)}<p>${esc(c.full) || "Decidi tu che cosa succede."}</p>`).join("")}`;
}

/** Manda al GM gli orologi appena riempiti, se ce ne sono. */
async function whisperFullClocks(clocks) {
  if ( clocks.length ) await whisperGM(fullClocksHtml(clocks));
}

/** Sposta un orologio di delta spicchi, senza uscire dai limiti. Restituisce true se si è appena riempito. */
function tickClock(clock, delta = 1) {
  const before = clock.value;
  clock.value = Math.clamp(before + delta, 0, clock.size);
  return (before < clock.size) && (clock.value === clock.size);
}

/** Riepilogo degli orologi per contesa: privato per il GM, oppure pubblico con i soli orologi visibili. */
async function clocksReport({ players = false } = {}) {
  const state = getFactionState();
  let body;
  if ( players ) {
    const visible = state.clocks.filter(c => c.visible);
    if ( !visible.length ) {
      ui.notifications.warn("Nessun orologio è visibile ai giocatori: spunta «Visibile» in «Fazioni: orologi e contese».");
      return null;
    }
    // Ai giocatori niente titoli delle contese: direbbero più di quanto il GM ha scelto di mostrare.
    body = visible.map(clockRow).join("");
  } else {
    const list = await contests();
    const title = id => list.find(x => x.id === id)?.name ?? "Altri orologi";
    body = `<p><strong>Personaggi:</strong> ${factionName(state.party)}. <strong>Rivali:</strong> ${factionName(state.rivals)}.</p>`
      + ([...Map.groupBy(state.clocks, c => c.contest)].map(([id, cs]) => `<h4>${title(id)}</h4>${cs.map(clockRow).join("")}`).join("")
        || "<p>Nessun orologio aperto.</p>");
  }
  return ChatMessage.implementation.create({
    content: `<h3>Orologi delle fazioni</h3>${body}`,
    whisper: players ? [] : gmIds()
  });
}

/** Fa avanzare (o tornare indietro) un orologio; se si riempie, il GM riceve che cosa succede. */
async function advanceClock(id, delta = 1) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può far avanzare gli orologi delle fazioni.");
  const { clock, filled } = await queued("factions", async () => {
    const state = getFactionState();
    const clock = state.clocks.find(c => c.id === id);
    if ( !clock ) throw new Error(`${MODULE_ID} | orologio sconosciuto: ${id}`);
    const filled = tickClock(clock, delta);
    await setFactionState(state);
    return { clock, filled };
  });
  if ( filled ) await whisperFullClocks([clock]);
  return clock;
}

/**
 * Il turno delle fazioni: per ciascuna una mossa pescata dalla tabella del luogo e uno spicchio in più
 * a uno dei suoi orologi aperti. Gli orologi delle contese dell'altro luogo restano fermi.
 */
async function factionTurn({ place = "ankharel", advance = true } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può muovere le fazioni.");
  if ( !(place in PLACES) ) throw new Error(`${MODULE_ID} | luogo sconosciuto: ${place}`);
  return queued("factions", () => runFactionTurn(place, advance));
}

async function runFactionTurn(place, advance) {
  const state = getFactionState();
  const placeOf = new Map((await contests()).map(x => [x.id, x.place]));
  const movers = [...MOVERS[place]];
  // I rivali muovono se hanno una fazione, oppure se hanno orologi loro anche senza fazione.
  if ( state.rivals || state.clocks.some(c => c.owner === "rivals") ) movers.push("rivals");
  const lines = [];
  const filled = [];
  for ( const owner of movers ) {
    const parts = [];
    if ( place === "ankharel" ) {
      const move = await drawText(MOVES_TABLE, { mode: owner === "rivals" ? "rivali" : owner });
      parts.push(move ?? missingTable("Mosse delle fazioni ad Ank'Harel", 8));
    }
    if ( advance ) {
      // I rivali lavorano per la loro fazione: fanno avanzare i propri orologi o i suoi.
      const owners = (owner === "rivals") ? ["rivals", state.rivals] : [owner];
      const open = state.clocks.filter(c => owners.includes(c.owner) && (c.value < c.size)
        && (!c.contest || (placeOf.get(c.contest) ?? place) === place));
      if ( open.length ) {
        const clock = open[Math.floor(Math.random() * open.length)];
        if ( tickClock(clock) ) filled.push(clock);
        parts.push(`<em>${esc(clock.name)}: ${clock.value} su ${clock.size}.</em>`);
      }
    }
    if ( !parts.length ) continue;
    const who = owner !== "rivals" ? CLOCK_OWNERS[owner][0]
      : (state.rivals ? `I rivali (${factionName(state.rivals)})` : "I rivali");
    lines.push(`<li><strong>${who}:</strong> ${parts.join(" ")}</li>`);
  }
  if ( advance ) await setFactionState(state);
  let trace = "";
  if ( place === "cael" ) {
    trace = `<p><strong>Una traccia:</strong> ${await drawText(TRACES_TABLE) ?? missingTable("Tracce delle fazioni a Cael Morrow", 7)}</p>`;
  }
  // A Cael Morrow, se il GM non fa avanzare gli orologi, le righe mancano per scelta e non c'è niente da segnalare.
  const empty = advance ? "<p>Nessun orologio aperto da far avanzare.</p>" : "";
  await whisperGM(`<h3>Il turno delle fazioni: ${PLACES[place]}</h3>${trace}`
      + `${lines.length ? `<ul>${lines.join("")}</ul>` : empty}${fullClocksHtml(filled)}`);
  return filled;
}

async function promptFactionTurn() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const places = selectOptions(PLACES);
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Il turno delle fazioni" },
    content: `<div class="form-group"><label>Dove sono i personaggi</label>
        <div class="form-fields"><select name="place">${places}</select></div></div>
      <div class="form-group"><label>Fai avanzare gli orologi</label>
        <div class="form-fields"><input type="checkbox" name="advance" checked></div></div>
      <p class="hint">Uno spicchio per ogni fazione; ad Ank'Harel anche una mossa, a Cael Morrow una traccia. Il resoconto arriva solo a te.</p>`,
    ok: { label: "Muovi le fazioni" }
  });
  if ( !data ) return;
  return factionTurn({ place: data.place, advance: !!data.advance });
}

async function promptFactionClocks() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const state = getFactionState();
  const list = await contests();
  const joinable = current => [selectOption("", "nessuna", current), ...JOINABLE.map(k => selectOption(k, CLOCK_OWNERS[k][0], current))].join("");
  const owners = current => Object.entries(CLOCK_OWNERS).map(([k, [, , short]]) => selectOption(k, short, current)).join("");
  // Finché il GM non sceglie, ai rivali si propone la fazione del libro.
  const rivals = state.rivals || bookRivals(state.party);
  const rows = state.clocks.map(c => `<tr>
      <td>${clockDial(c, 28)}</td>
      <td style="width:100%"><input type="text" name="clock.${c.id}.name" value="${esc(c.name)}" style="width:100%"></td>
      <td><select name="clock.${c.id}.owner" style="min-width:9em">${owners(c.owner)}</select></td>
      <td style="white-space:nowrap"><input type="number" name="clock.${c.id}.value" value="${c.value}" min="0" max="12" step="1" style="width:3.5em">
        su <input type="number" name="clock.${c.id}.size" value="${c.size}" min="2" max="12" step="1" style="width:3.5em"></td>
      <td><input type="checkbox" name="clock.${c.id}.visible"${c.visible ? " checked" : ""}></td>
      <td><input type="checkbox" name="clock.${c.id}.remove"></td></tr>`).join("");
  const present = new Set(state.clocks.map(c => c.contest));
  const contestOptions = [selectOption("", "nessuna", ""), ...list.filter(x => !present.has(x.id))
    .map(x => selectOption(x.id, `${x.name} (${PLACES[x.place]})`, ""))].join("");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: "Fazioni: orologi e contese", resizable: true },
    position: { width: 900 },
    content: `<div style="max-height:600px;overflow-y:auto">
      <fieldset><legend>Chi sta con chi</legend>
        <div class="form-group"><label>I personaggi</label><div class="form-fields"><select name="party">${joinable(state.party)}</select></div></div>
        <div class="form-group"><label>I rivali</label><div class="form-fields"><select name="rivals">${joinable(rivals)}${selectOption("split", "divisi tra due fazioni", rivals)}</select></div></div>
      </fieldset>
      ${rows ? `<fieldset><legend>Orologi</legend><table>
        <thead><tr><th></th><th>Nome</th><th>Di chi</th><th>Spicchi</th><th>Visibile</th><th>Togli</th></tr></thead>
        <tbody>${rows}</tbody></table></fieldset>` : ""}
      <fieldset><legend>Aggiungi</legend>
        <div class="form-group"><label>Una contesa</label><div class="form-fields"><select name="contest">${contestOptions}</select></div></div>
        <div class="form-group"><label>Oppure un orologio</label><div class="form-fields">
          <input type="text" name="newName" placeholder="Nome dell'orologio">
          <select name="newOwner">${owners("party")}</select>
          <input type="number" name="newSize" value="6" min="2" max="12" step="1" style="width:3.5em"></div></div>
      </fieldset></div>`,
    buttons: [
      { action: "save", label: "Salva", icon: "fa-solid fa-check", default: true, callback: dialogSubmit("save") },
      { action: "players", label: "Salva e mostra ai giocatori", icon: "fa-solid fa-eye", callback: dialogSubmit("players") }
    ]
  });
  if ( !result?.form ) return;
  const form = foundry.utils.expandObject(result.form);
  // Il dialogo non è modale: mentre era aperto un turno delle fazioni può aver mosso gli orologi.
  // Si riparte dallo stato attuale e gli spicchi cambiati dal GM si applicano come differenza.
  const shown = new Map(state.clocks.map(c => [c.id, c]));
  const filled = [];
  await queued("factions", async () => {
    const clocks = [];
    for ( const c of getFactionState().clocks ) {
      const old = shown.get(c.id);
      if ( !old ) {
        clocks.push(c);
        continue;
      }
      const f = form.clock?.[c.id] ?? {};
      if ( f.remove ) continue;
      // Non basta il risultato di tickClock: anche ridurre gli spicchi può riempire l'orologio.
      const wasFull = c.value >= c.size;
      const size = clockSize(f.size, old.size);
      const clock = { ...c, name: String(f.name ?? c.name).trim() || c.name, owner: f.owner in CLOCK_OWNERS ? f.owner : c.owner,
        size, value: Math.min(c.value, size), visible: !!f.visible };
      tickClock(clock, intIn(f.value, 0, 0, size) - old.value);
      if ( !wasFull && (clock.value === clock.size) ) filled.push(clock);
      clocks.push(clock);
    }
    const contest = list.find(x => x.id === form.contest);
    if ( contest && !clocks.some(c => c.contest === contest.id) ) for ( const c of contest.clocks ) {
      clocks.push(newClock({ name: c.name, owner: c.faction, size: c.size, full: c.full, contest: contest.id }));
    }
    const newName = String(form.newName ?? "").trim();
    if ( newName ) clocks.push(newClock({ name: newName, owner: form.newOwner in CLOCK_OWNERS ? form.newOwner : "party",
      size: clockSize(form.newSize, 6) }));
    await setFactionState({ party: form.party ?? "", rivals: form.rivals ?? "", clocks });
  });
  await whisperFullClocks(filled);
  await clocksReport();
  if ( result.action === "players" ) await clocksReport({ players: true });
}

/* -------------------------------------------- */
/*  Il Netherdeep                               */
/* -------------------------------------------- */

/** Il modello della dispensa dei ricordi: createJournal lo riempie con le visioni viste (vedi DYNAMIC_PAGES). */
const MEMORY_FILE = "43-dispensa-ricordi.html";
const MEMORY_EMPTY = "<p><em>Ancora nessun ricordo.</em></p>";
const NETHER_TABLE = "REMIXNETHRIVAL01";

/** Nella dispensa le visioni hanno una lettera nell'ordine di comparsa: sono al massimo venti. */
const LETTERS = "ABCDEFGHIJKLMNOPQRST";

const TRIGGERS = {
  rest: "un riposo del gruppo",
  shard: "un Frammento di Sofferenza",
  down: "un personaggio privo di sensi",
  event: "un evento del dungeon"
};

/** Le tre scelte del finale, con le stesse chiavi degli esiti in epiloghi.json. */
const CHOICES = { killed: "ucciderlo", unleashed: "liberarlo", redeemed: "redimerlo" };

/** I rivali al finale: attore di fascia 3, ordine delle preferenze, che cosa li smuove e un argomento per scelta. */
const RIVALS = {
  ayo: {
    name: "Ayo Jabe", actor: "YTEwODQxNmU1YzM1", prefs: ["unleashed", "killed", "redeemed"],
    moves: "chi parla chiaro e decide; la paura per Dermot e Maggie",
    args: {
      killed: "Un colpo, e finisce. Per lui e per tutti. Decidere in fretta, a volte, è l'unica pietà che resta.",
      unleashed: "Ha pagato abbastanza. Apriamo questa gabbia, e chi ha paura si faccia da parte.",
      redeemed: "Se c'è anche solo una possibilità di riportarlo indietro intero, io voglio esserci quando succede."
    }
  },
  dermot: {
    name: "Dermot Wurder", actor: "OWVmNzQwZTlhOGZl", prefs: ["redeemed", "unleashed", "killed"],
    moves: "il pericolo per i suoi amici e per Jigow; qualcuno che gli chieda che cosa vuole lui",
    args: {
      killed: "Se lo liberiamo e arriva a Jigow... da mia madre... no. Mi dispiace. Non posso rischiare.",
      unleashed: "Una prigione non ha mai guarito nessuno. Diamogli la luce, e il resto verrà.",
      redeemed: "Nessuno è soltanto la cosa peggiore che ha fatto. La luce torna sempre, se qualcuno le apre la porta."
    }
  },
  galsariad: {
    name: "Galsariad Ardyth", actor: "OTcwMjVkYjI5YmUz", prefs: ["killed", "redeemed", "unleashed"],
    moves: "il rispetto per quello che sa; chi condivide con lui i segreti del Netherdeep",
    args: {
      killed: "Ormai nessuno può aiutarlo. Il potere lo ha marcito dentro, e l'unica cosa sensata è finirlo.",
      unleashed: "Chi siamo noi per giudicare un semidio? Abbiamo visto venti ricordi. Lui ne ha secoli.",
      redeemed: "Un eroe della Calamità che parla, ricorda e ringrazia. Avete idea di quanto vale per la storia? Non si butta via."
    }
  },
  irvan: {
    name: "Irvan Wastewalker", actor: "ODkwNmQxOWIxNjAw", prefs: ["redeemed", "killed", "unleashed"],
    moves: "la rinascita, che lui conosce; l'opinione di Galsariad; fare qualcosa di grande da solo",
    args: {
      killed: "Le grandi imprese non sono sempre belle. Questa è una di quelle brutte, e qualcuno deve farla.",
      unleashed: "Tutti meritano una seconda vita. Anche lui. Forse lui più di tutti.",
      redeemed: "Si può rinascere. Fidatevi, lo so. Non devi per forza restare quello che eri."
    }
  },
  maggie: {
    name: "Maggie Keeneyes", actor: "ZjMzOGNkNDczNDEz", prefs: ["unleashed", "redeemed", "killed"],
    moves: "gli argomenti, non le etichette; un dettaglio preciso delle visioni, detto bene",
    args: {
      killed: "Ho visto bestie soffrire così. A volte la cosa gentile da fare è una sola.",
      unleashed: "Ma soffre! Non potete ammazzarlo e basta. Merita di essere libero.",
      redeemed: "Non è un mostro. È un uomo a cui tutti hanno detto che era un presagio, finché ci ha creduto."
    }
  }
};

/** Come si oppongono i rivali, secondo l'atteggiamento verso i personaggi. */
const RIVAL_TONES = {
  friendly: "Un dibattito, anche acceso, tra persone che si rispettano. Se perdono, accettano e combattono con i personaggi.",
  indifferent: "Una lite che può finire in qualunque modo. Chi non è convinto può agire da solo.",
  hostile: "Una trattativa con la mano sull'elsa. Se non ottengono la loro strada, attaccano."
};

/** Che cosa chiede ai rivali la missione 6 della loro fazione. */
const RIVAL_MISSIONS = {
  allegiance: "La loro missione 6 è trattare con l'«intelligenza dolente»: vogliono almeno parlare con Alyxian prima di decidere, e liberarlo li tenta.",
  consortium: "La loro missione 6 è catturare la fonte del ruidium o farsela alleata: ogni finale che distrugge il ruidium per loro è una sconfitta.",
  cobalt: "La loro missione 6 è distruggere il Netherdeep: ucciderlo o redimerlo va bene, liberarlo mai.",
  split: "Lavorano per due fazioni diverse: anche nel dibattito ognuno tira dalla sua parte."
};

const memories = cachedJson("journal/ricordi-apotheon.json", data => new Map(data.visions.map(v => [v.n, v])));
const epilogues = cachedJson("journal/epiloghi.json");
const memoryTemplate = cachedText(`journal/${MEMORY_FILE}`);

/**
 * Lo stato ripulito. Le visioni sono in ordine di comparsa: { n, early, letter }, early se il gruppo la conosceva
 * già prima del Netherdeep. La lettera resta quella data alla comparsa, anche se si toglie una visione prima;
 * i salvataggi senza lettere le ricevono in ordine. I rivali: atteggiamento, chi partecipa e chi è morto.
 */
function normalizeNether(saved = {}) {
  const seen = [];
  const isLetter = l => (typeof l === "string") && (l.length === 1) && LETTERS.includes(l);
  for ( const v of saved.seen ?? [] ) {
    const n = Number(v?.n);
    if ( !Number.isInteger(n) || (n < 1) || (n > 20) || seen.some(s => s.n === n) ) continue;
    const letter = isLetter(v.letter) && !seen.some(s => s.letter === v.letter) ? v.letter : null;
    seen.push({ n, early: !!v.early, letter });
  }
  const rivalKeys = list => (list ?? []).filter(k => k in RIVALS);
  const rivals = {
    attitude: attitudeOr(saved.rivals?.attitude),
    present: rivalKeys(saved.rivals?.present ?? Object.keys(RIVALS)),
    dead: rivalKeys(saved.rivals?.dead)
  };
  // lastLetter: l'indice dell'ultima lettera mai data, anche se quella visione è stata tolta.
  const savedLast = Number.isInteger(saved.lastLetter) ? Math.clamp(saved.lastLetter, -1, LETTERS.length - 1) : -1;
  const state = { seen, rivals, lastLetter: Math.max(savedLast, ...seen.map(s => (s.letter ? LETTERS.indexOf(s.letter) : -1))) };
  for ( const s of seen ) s.letter ??= nextLetter(state);
  return state;
}

const getNetherState = () => normalizeNether(game.settings.get(MODULE_ID, "netherdeep") ?? {});

/**
 * La lettera per una visione nuova: quella dopo l'ultima mai data, così una lettera tolta non torna in giro.
 * Solo quando sono finite tutte e venti si riusa una lettera libera.
 */
function nextLetter(state) {
  const used = state.seen.map(s => s.letter).filter(Boolean);
  const letter = LETTERS[state.lastLetter + 1] ?? [...LETTERS].find(l => !used.includes(l));
  state.lastLetter = Math.max(state.lastLetter, LETTERS.indexOf(letter));
  return letter;
}

/** Aggiunge una visione in coda, con la sua lettera. */
function addVision(state, n, early = false) {
  const entry = { n, early, letter: nextLetter(state) };
  state.seen.push(entry);
  return entry;
}

/** I rivali che contano al finale: chi partecipa, meno i morti. */
const activeRivals = ({ present, dead }) => present.filter(k => !dead.includes(k));

/**
 * L'unico modo di scrivere lo stato: legge, applica la modifica, ripulisce e salva, una operazione alla volta.
 * Con due lanci ravvicinati della macro il secondo aspetta il primo invece di sovrascriverlo. Se non cambia niente
 * non scrive; se cambiano le visioni, aggiorna la dispensa dei giocatori.
 * @param {(state: object) => any} mutate   Modifica lo stato sul posto; quello che restituisce torna al chiamante.
 * @returns {Promise<{ result: any, after: object }>}
 */
function updateNetherState(mutate) {
  return inNetherQueue(async () => {
    const before = getNetherState();
    const draft = foundry.utils.deepClone(before);
    const result = await mutate(draft);
    const after = normalizeNether(draft);
    if ( foundry.utils.objectsEqual(before, after) ) return { result, after };
    await game.settings.set(MODULE_ID, "netherdeep", after);
    for ( const [file, { deps }] of Object.entries(DYNAMIC_PAGES) ) {
      if ( !foundry.utils.objectsEqual(deps(before), deps(after)) ) await refreshDynamicPage(file, after);
    }
    return { result, after };
  });
}

/** Una operazione alla volta sullo stato del Netherdeep e sulle pagine che ne dipendono. */
const inNetherQueue = fn => queued("netherdeep", fn);

/** Atteggiamento, presenti o morti dei rivali: salva solo quello che arriva e restituisce i rivali aggiornati. */
async function saveRivals({ attitude, present, dead }) {
  const { after } = await updateNetherState(s => {
    if ( attitude ) s.rivals.attitude = attitude;
    if ( present ) s.rivals.present = present;
    if ( dead ) s.rivals.dead = dead;
  });
  return after.rivals;
}

/** La dispensa dei giocatori: il modello in journal/ con le visioni viste. */
async function renderMemoryHandout({ seen } = getNetherState()) {
  const [template, visions] = await Promise.all([memoryTemplate(), memories()]);
  if ( !seen.length ) return template;
  const items = seen.map(s => `<li><strong>${s.letter}.</strong> `
    + `${s.early ? "<em>(un ricordo di prima del Netherdeep)</em> " : ""}${visions.get(s.n).text}</li>`).join("");
  const list = `<ul style="list-style:none;padding-left:0">${items}</ul>`;
  // Funzione come sostituto: i $ nel testo delle visioni non diventano schemi di replace.
  if ( template.includes(MEMORY_EMPTY) ) return template.replace(MEMORY_EMPTY, () => list);
  // Il modello è stato modificato e il segnaposto non c'è più: le visioni vanno in fondo, non si perdono.
  console.warn(`${MODULE_ID} | ${MEMORY_FILE}: manca il segnaposto ${MEMORY_EMPTY}, le visioni vanno in fondo alla pagina.`);
  return template + list;
}

/**
 * Una visione del binario 2: il d20 sceglie quale, e se è già uscita si passa alla prima libera dopo.
 * Tutti vedono il testo con la sua lettera; il GM riceve il numero vero e il segno per metterla in ordine.
 */
async function apotheonMemory({ n = null, trigger = "rest" } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può mostrare i ricordi dell'Apotheon.");
  const visions = await memories();
  if ( n && !visions.has(n) ) return ui.notifications.warn(`Le visioni vanno da 1 a 20: la ${n} non esiste.`);
  let rolled = null;
  let entry = null;
  const { result: warning, after } = await updateNetherState(async state => {
    const used = new Set(state.seen.map(s => s.n));
    if ( used.size >= visions.size ) return "Il gruppo ha già visto tutte e venti le visioni.";
    if ( n && used.has(n) ) return `La visione ${n} è già stata vista.`;
    let pick = n;
    if ( !pick ) {
      rolled = (await new Roll("1d20").evaluate()).total;
      pick = rolled;
      while ( used.has(pick) ) pick = (pick % 20) + 1;
    }
    entry = addVision(state, pick);
  });
  if ( warning ) return ui.notifications.warn(warning);
  const { n: pick, letter } = entry;
  const vision = visions.get(pick);
  await ChatMessage.implementation.create({
    speaker: { alias: "Un ricordo dell'Apotheon" },
    content: `<h3>Ricordo ${letter}</h3><p style="font-style:italic">${vision.text}</p>`
  });
  let how = "scelta da te";
  if ( rolled === pick ) how = `d20: ${rolled}`;
  else if ( rolled !== null ) how = `d20: ${rolled}, già vista: si passa alla ${pick}`;
  await whisperGM(`<p><strong>Ricordo ${letter} = visione ${pick}ª</strong> (${how}; ${TRIGGERS[trigger] ?? trigger}).</p>
    <p><em>Segno per l'ordine:</em> ${vision.sign}</p>
    <p>Visioni viste: ${after.seen.length} su 20.</p>`);
  return { n: pick, letter };
}

async function promptApotheonMemory() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Un ricordo dell'Apotheon" },
    content: `<div class="form-group"><label>Che cosa la provoca</label>
        <div class="form-fields"><select name="trigger">${selectOptions(TRIGGERS)}</select></div></div>
      <div class="form-group"><label>Una visione precisa</label>
        <div class="form-fields"><input type="number" name="n" min="1" max="20" step="1" placeholder="d20"></div></div>
      <p class="hint">Lascia vuoto per tirare il d20. Tutti vedono la visione; il numero vero arriva solo a te.</p>`,
    ok: { label: "Mostra il ricordo" }
  });
  if ( !data ) return;
  return apotheonMemory({ n: Math.round(Number(data.n)) || null, trigger: data.trigger });
}

/** Visioni da mettere in fila per la ricompensa proposta nella pagina «Visioni fuori ordine». */
const REWARD_VISIONS = 15;

/**
 * Le lettere di una proposta: solo quelle isolate, così «poi» o «prima» non diventano visioni. Se il GM scrive
 * qualche maiuscola contano solo le maiuscole, e le parole di una lettera («e», «a», «o») restano fuori.
 */
function proposalLetters(proposal) {
  const tokens = String(proposal).split(/[^\p{L}]+/u).filter(t => t.length === 1);
  const upper = tokens.filter(t => t !== t.toLowerCase());
  return (upper.length ? upper : tokens).map(t => t.toUpperCase());
}

/**
 * Confronta l'ordine proposto dai giocatori (lettere della dispensa) con quello vero. La sottosequenza crescente
 * più lunga dice quante visioni sono già in fila; le altre sono quelle da spostare.
 */
function checkMemoryOrder(seen, proposal) {
  const byLetter = new Map(seen.map(s => [s.letter, s.n]));
  const letters = proposalLetters(proposal);
  const unknown = [...new Set(letters.filter(l => !byLetter.has(l)))];
  const list = [...new Set(letters.filter(l => byLetter.has(l)))];
  const missing = [...byLetter.keys()].filter(l => !list.includes(l));
  const nums = list.map(l => byLetter.get(l));
  const len = nums.map(() => 1);
  const prev = nums.map(() => -1);
  for ( let i = 0; i < nums.length; i++ ) {
    for ( let j = 0; j < i; j++ ) {
      if ( (nums[j] < nums[i]) && (len[j] + 1 > len[i]) ) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  const keep = new Set();
  if ( nums.length ) for ( let i = len.indexOf(Math.max(...len)); i >= 0; i = prev[i] ) keep.add(i);
  const misplaced = list.filter((_l, i) => !keep.has(i));
  const solved = !!list.length && !misplaced.length && !missing.length && !unknown.length;
  return { list, unknown, missing, inOrder: keep.size, misplaced, solved, reward: solved && (seen.length >= REWARD_VISIONS) };
}

async function memoryOrderReport(proposal) {
  const { seen } = getNetherState();
  const r = checkMemoryOrder(seen, proposal);
  const truth = seen.toSorted((a, b) => a.n - b.n).map(s => `${s.letter} (${s.n})`).join(", ");
  let verdict = "";
  if ( r.reward ) verdict = " <strong>Sequenza giusta: vale la ricompensa!</strong>";
  else if ( r.solved ) verdict = ` <strong>Sequenza giusta</strong>, ma per la ricompensa servono almeno ${REWARD_VISIONS} visioni.`;
  const lines = [
    `<p><strong>Proposta:</strong> ${r.list.join(", ") || "nessuna lettera valida"}.</p>`,
    `<p>In fila: <strong>${r.inOrder} su ${seen.length}</strong>.${verdict}</p>`
  ];
  if ( r.misplaced.length ) lines.push(`<p><strong>Fuori posto:</strong> ${r.misplaced.join(", ")}.</p>`);
  if ( r.missing.length ) lines.push(`<p><strong>Mancano:</strong> ${r.missing.join(", ")}.</p>`);
  if ( r.unknown.length ) lines.push(`<p><strong>Lettere che non esistono:</strong> ${r.unknown.join(", ")}.</p>`);
  lines.push(`<p><em>Ordine vero:</em> ${truth || "nessuna visione vista"}.</p>`);
  await whisperGM(`<h3>Ricordi: l'ordine dei giocatori</h3>${lines.join("")}`);
  return r;
}

async function promptMemoryState() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const state = getNetherState();
  const visions = await memories();
  const status = new Map(state.seen.map(s => [s.n, s]));
  const states = { "": "no", seen: "vista", early: "vista prima" };
  const rows = [...visions.values()].map(v => {
    const s = status.get(v.n);
    const current = s ? (s.early ? "early" : "seen") : "";
    const short = v.text.replace(/<[^>]+>/g, "").slice(0, 70);
    return `<tr><td>${v.n}ª</td><td>${s?.letter ?? ""}</td><td style="width:100%">${short}…</td>
      <td><select name="v${v.n}">${selectOptions(states, current)}</select></td></tr>`;
  }).join("");
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.wait({
    window: { title: "Netherdeep: i ricordi visti", resizable: true },
    position: { width: 760 },
    content: `<div style="max-height:600px;overflow-y:auto">
      <table><thead><tr><th>Visione</th><th>Lettera</th><th>Inizio</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="form-group"><label>Ordine dei giocatori</label>
        <div class="form-fields"><input type="text" name="proposal" placeholder="es. C A F B E D"></div></div>
      <p class="hint">«Vista prima» vale per le visioni seminate prima del Netherdeep. Le visioni aggiunte qui prendono
        una lettera nuova; quelle già viste tengono la loro.</p></div>`,
    buttons: [
      { action: "save", label: "Salva", icon: "fa-solid fa-check", default: true, callback: dialogSubmit("save") },
      { action: "check", label: "Controlla l'ordine", icon: "fa-solid fa-list-ol", callback: dialogSubmit("check") },
      { action: "reset", label: "Azzera", icon: "fa-solid fa-trash", callback: dialogSubmit("reset") }
    ]
  });
  if ( !result?.form ) return;
  const form = result.form;
  if ( result.action === "reset" ) {
    const ok = await DialogV2.confirm({
      window: { title: "Azzera i ricordi" },
      content: "<p>Tolgo tutte le visioni viste e svuoto la dispensa dei giocatori?</p>"
    });
    if ( !ok ) return;
    await updateNetherState(s => { s.seen = []; s.lastLetter = -1; });
    return ui.notifications.info("Ricordi azzerati.");
  }
  // Una visione uscita a dialogo aperto non era nel modulo: resta com'è. Le altre seguono il modulo.
  const pick = n => form[`v${n}`] ?? "";
  await updateNetherState(s => {
    s.seen = s.seen.filter(x => !status.has(x.n) || pick(x.n));
    for ( const x of s.seen ) if ( status.has(x.n) ) x.early = pick(x.n) === "early";
    for ( const n of visions.keys() ) if ( pick(n) && !s.seen.some(x => x.n === n) ) addVision(s, n, pick(n) === "early");
  });
  if ( result.action === "check" ) return memoryOrderReport(form.proposal ?? "");
}

/**
 * Le posizioni dei rivali nel dibattito: ognuno la sua preferita tra le scelte diverse da quella dei personaggi.
 * Se i rivali sono almeno due, entrambe le altre scelte devono avere una voce.
 */
function rivalStances(present, lean) {
  const stance = new Map(present.map(k => [k, RIVALS[k].prefs.find(p => p !== lean)]));
  if ( !lean || (present.length < 2) ) return stance;
  const count = c => [...stance.values()].filter(x => x === c).length;
  for ( const c of Object.keys(CHOICES).filter(x => (x !== lean) && !count(x)) ) {
    const movable = present.filter(k => count(stance.get(k)) > 1)
      .sort((a, b) => RIVALS[a].prefs.indexOf(c) - RIVALS[b].prefs.indexOf(c));
    if ( movable.length ) stance.set(movable[0], c);
  }
  return stance;
}

/** Caselle dei cinque rivali, spuntate quelle in checked. */
const rivalChecks = (prefix, checked, note = () => "") => Object.entries(RIVALS).map(([k, r]) =>
  `<label style="white-space:nowrap"><input type="checkbox" name="${prefix}.${k}"${checked.includes(k) ? " checked" : ""}> ${r.name}${note(k)}</label>`).join(" ");

/** Le chiavi dei rivali spuntati in un modulo con le caselle di rivalChecks. */
const checkedRivals = (form, prefix) => Object.keys(RIVALS).filter(k => form[`${prefix}.${k}`]);

/** Manda al GM le posizioni dei rivali, i loro argomenti e, se richiesto, una traccia o un trucco dell'Apotheon. */
async function rivalsFinale({ lean = "", attitude, present, draw = "" } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  if ( !(lean in CHOICES) ) lean = "";
  const rivals = await saveRivals({ attitude, present });
  const active = activeRivals(rivals);
  const stances = rivalStances(active, lean);
  const items = active.map(k => {
    const c = stances.get(k);
    return `<li><strong>${actorLink(RIVALS[k])}</strong> vuole <strong>${CHOICES[c]}</strong>: «${RIVALS[k].args[c]}» <em>Lo smuove:</em> ${RIVALS[k].moves}.</li>`;
  }).join("");
  const faction = getFactionState().rivals;
  let extra = "";
  if ( draw ) {
    const mode = (draw === "tracce") ? "tracce"
      : ({ friendly: "amici", hostile: "nemici" }[rivals.attitude] ?? (Math.random() < 0.5 ? "amici" : "nemici"));
    extra = `<p><strong>${draw === "tracce" ? "Una traccia" : "Un trucco dell'Apotheon"}:</strong> `
      + `${await drawText(NETHER_TABLE, { mode }) ?? missingTable("Il Netherdeep e i rivali", 9)}</p>`;
  }
  await whisperGM(`<h3>I rivali al finale</h3>
    <p><strong>I personaggi pendono per:</strong> ${CHOICES[lean] ?? "nessuna scelta, sono divisi"}.
      <strong>Atteggiamento:</strong> ${ATTITUDES[rivals.attitude]}. ${RIVAL_TONES[rivals.attitude]}</p>
    ${items ? `<ul>${items}</ul>` : "<p>Nessun rivale presente.</p>"}
    ${RIVAL_MISSIONS[faction] ? `<p>${RIVAL_MISSIONS[faction]}</p>` : ""}${extra}`);
  return stances;
}

async function promptRivalsFinale() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const { rivals } = getNetherState();
  const draws = { "": "niente", tracce: "una traccia dei rivali", trucco: "un trucco dell'Apotheon" };
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Netherdeep: rivali al finale" },
    position: { width: 520 },
    content: `<div class="form-group"><label>I personaggi vogliono</label>
        <div class="form-fields"><select name="lean">${selectOptions({ "": "sono divisi", ...CHOICES })}</select></div></div>
      <div class="form-group"><label>Atteggiamento dei rivali</label>
        <div class="form-fields"><select name="attitude">${selectOptions(ATTITUDES, rivals.attitude)}</select></div></div>
      <div class="form-group"><label>Presenti</label><div class="form-fields" style="flex-wrap:wrap">
        ${rivalChecks("present", rivals.present, k => (rivals.dead.includes(k) ? " (morto)" : ""))}</div></div>
      <div class="form-group"><label>Dalla tabella</label>
        <div class="form-fields"><select name="draw">${selectOptions(draws)}</select></div></div>
      <p class="hint">Ogni rivale sostiene una scelta diversa da quella dei personaggi. I morti restano fuori. Il resoconto arriva solo a te.</p>`,
    ok: { label: "Prepara il dibattito" }
  });
  if ( !data ) return;
  return rivalsFinale({ lean: data.lean, attitude: data.attitude, present: checkedRivals(data, "present"), draw: data.draw });
}

/** A finale avvenuto: che cosa fanno i rivali e come reagiscono le fazioni dei due gruppi. */
async function netherdeepEpilogue({ outcome, attitude, dead }) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const data = await epilogues();
  if ( !(outcome in data.outcomes) ) throw new Error(`${MODULE_ID} | esito sconosciuto: ${outcome}`);
  const r = await saveRivals({ attitude, dead });
  const { name, book, ruidium } = data.outcomes[outcome];
  const { party, rivals: rivalFaction } = getFactionState();
  const factionLine = (key, who) => {
    const f = data.factions[key]?.[outcome];
    return f ? `<p><strong>${CLOCK_OWNERS[key][0]}, ${who}:</strong> <em>missione 6 ${f.mission}.</em> ${f.text}</p>` : "";
  };
  let rivals;
  let factions = factionLine(party, "fazione dei personaggi");
  // Tutti morti solo se lo sono davvero: chi non era al finale è vivo da qualche parte e saprà com'è andata.
  if ( Object.keys(RIVALS).every(k => r.dead.includes(k)) ) rivals = `<p><strong>I rivali sono tutti morti.</strong> ${data.rivals.dead}</p>`;
  else {
    rivals = `<p><strong>I rivali (${ATTITUDES[r.attitude]}):</strong> ${data.rivals[r.attitude][outcome]}</p>`;
    if ( !activeRivals(r).length ) rivals += "<p><em>Al finale non c'era nessuno di loro: lo vengono a sapere dopo, "
      + "da voci e racconti, e reagiscono comunque così.</em></p>";
    if ( r.dead.length ) rivals += `<p><strong>Caduti:</strong> ${r.dead.map(k => RIVALS[k].name).join(", ")}. `
      + "Per qualche settimana compaiono nei sogni dei personaggi; l'ultima notte salutano.</p>";
    if ( rivalFaction === "split" ) {
      factions += "<p><strong>I rivali erano divisi tra due fazioni:</strong> ognuno fa rapporto alla sua. "
        + "Usa le righe di quelle fazioni nella pagina «Epiloghi: fazioni e rivali».</p>";
    }
    else if ( rivalFaction !== party ) factions += factionLine(rivalFaction, "fazione dei rivali");
  }
  if ( !factions ) factions = "<p>Nessuna fazione registrata: aggiornala con «Fazioni: orologi e contese».</p>";
  await whisperGM(`<h3>Epilogo: ${name}</h3>
    <p><em>Nel libro è ${book}. ${ruidium ? "Il ruidium resta nel mondo." : "Tutto il ruidium smette di esistere."}</em></p>
    ${rivals}${factions}`);
}

async function promptNetherdeepEpilogue() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può usare questa macro.");
  const { rivals } = getNetherState();
  const data = await epilogues();
  const outcomes = Object.fromEntries(Object.entries(data.outcomes).map(([k, o]) => [k, o.name]));
  const form = await foundry.applications.api.DialogV2.input({
    window: { title: "Netherdeep: epilogo" },
    position: { width: 520 },
    content: `<div class="form-group"><label>Il finale</label><div class="form-fields"><select name="outcome">${selectOptions(outcomes)}</select></div></div>
      <div class="form-group"><label>Atteggiamento dei rivali</label><div class="form-fields"><select name="attitude">${selectOptions(ATTITUDES, rivals.attitude)}</select></div></div>
      <div class="form-group"><label>Rivali morti</label><div class="form-fields" style="flex-wrap:wrap">${rivalChecks("dead", rivals.dead)}</div></div>
      <p class="hint">Le fazioni dei due gruppi vengono da «Fazioni: orologi e contese». Il resoconto arriva solo a te.</p>`,
    ok: { label: "Mostra l'epilogo" }
  });
  if ( !form ) return;
  return netherdeepEpilogue({ outcome: form.outcome, attitude: form.attitude, dead: checkedRivals(form, "dead") });
}

/* -------------------------------------------- */
/*  Diari e tabelle dei blocchi                 */
/* -------------------------------------------- */

/**
 * Pagine generate: il file in journal/ è solo il modello, e render(state) restituisce il testo da mostrare.
 * deps(state) è la parte dello stato del Netherdeep da cui dipende la pagina: quando cambia, la pagina si rigenera.
 * block è il blocco il cui diario contiene la pagina.
 */
const DYNAMIC_PAGES = {
  [MEMORY_FILE]: { render: renderMemoryHandout, deps: s => s.seen, block: 9, label: "Dispensa dei ricordi" }
};

/** Un diario del modulo, cercato per il nome con cui createJournal l'ha segnato. */
const moduleJournal = name => game.journal.find(j => j.getFlag(MODULE_ID, "journal") === name);

/** Una pagina dei diari del modulo, cercata per il file da cui è nata. */
function modulePage(file) {
  for ( const entry of game.journal ) {
    if ( !entry.getFlag(MODULE_ID, "journal") ) continue;
    const page = entry.pages.find(p => p.getFlag(MODULE_ID, "file") === file);
    if ( page ) return page;
  }
  return null;
}

/**
 * Rigenera una pagina di DYNAMIC_PAGES nel suo diario, dallo stato dato. Non fallisce mai: lo stato è già salvato
 * e chi chiama (per esempio un ricordo da mostrare in chat) deve poter andare avanti; se non riesce, avvisa il GM.
 */
async function refreshDynamicPage(file, state = getNetherState()) {
  const { render, block, label } = DYNAMIC_PAGES[file];
  const page = modulePage(file);
  const ok = !!page && await page.update({ "text.content": await render(state) })
    .then(() => true, err => { console.error(err); return false; });
  if ( !ok ) ui.notifications.warn(`${label} non aggiornata: ${rebuildHint(block)}`);
}

/** La cartella del modulo per un tipo di documento, creata se manca. */
async function moduleFolder(type) {
  const folder = game.folders.find(f => (f.type === type) && f.getFlag(MODULE_ID, "folder"));
  return folder ?? Folder.implementation.create({
    name: "Remix Netherdeep", type, color: "#8b1a1a", flags: { [MODULE_ID]: { folder: true } }
  });
}

/**
 * Importa le tabelle di un file JSON con id fissi, così i link @UUID[RollTable.…] delle pagine funzionano.
 * Ogni risultato è un testo oppure { text, weight, modes }: il peso allarga l'intervallo sul dado,
 * modes (facoltativo) dice in quali modalità una macro può pescarlo.
 */
async function importTables(file) {
  const tables = JSON.parse(await fetchText(`journal/${file}`));
  const folder = await moduleFolder("RollTable");
  for ( const { _id, name, formula, description, results } of tables ) {
    let next = 1;
    const data = {
      _id, name, formula, description, folder: folder.id,
      img: "icons/sundries/gaming/dice-runed-brown.webp",
      results: results.map(r => {
        const { text, weight = 1, modes } = typeof r === "string" ? { text: r } : r;
        const range = [next, next + weight - 1];
        next += weight;
        return { type: "text", description: text, weight, range, flags: modes ? { [MODULE_ID]: { modes } } : {} };
      })
    };
    const faces = Number(formula.match(/^1d(\d+)$/)?.[1]);
    if ( faces && (faces !== next - 1) ) console.warn(`${MODULE_ID} | ${name}: ${formula} ma i risultati coprono 1-${next - 1}`);
    await game.tables.get(_id)?.delete();
    await RollTable.implementation.create(data, { keepId: true });
  }
}

/**
 * Crea il diario di un blocco con le pagine HTML del modulo, oppure lo aggiorna se esiste già.
 * Aggiornare tiene l'id del diario (i link restano validi) ma sostituisce le pagine.
 * @param {string} name                               Nome del diario.
 * @param {Array<[string, string, string]>} pages     [nome della pagina, file in journal/, livello di proprietà].
 * @param {object} [options]
 * @param {string} [options.tables]                   File JSON di tabelle da importare prima delle pagine.
 */
async function createJournal(name, pages, { tables } = {}) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può creare il diario.");
  const existing = moduleJournal(name) ?? game.journal.getName(name);
  if ( existing ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: name },
      content: `<p>Il diario «${name}» esiste già. Lo aggiorno con il testo del modulo?</p>
        <p>Le modifiche fatte a mano alle sue pagine andranno perse.</p>`
    });
    if ( !ok ) return existing;
  }

  let data;
  try {
    if ( tables ) await importTables(tables);
    data = await Promise.all(pages.map(async ([pageName, file, level], i) => {
      const content = await (DYNAMIC_PAGES[file]?.render() ?? fetchText(`journal/${file}`));
      return {
        name: pageName,
        type: "text",
        sort: (i + 1) * CONST.SORT_INTEGER_DENSITY,
        text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS[level] },
        flags: { [MODULE_ID]: { file } }
      };
    }));
  } catch(err) {
    console.error(err);
    return ui.notifications.error(`Non riesco a leggere i file del diario «${name}», vedi la console (F12).`);
  }

  // Con delle dispense il diario dev'essere almeno Limitato, o i giocatori non lo vedono nella barra laterale;
  // le pagine del GM restano nascoste dalla loro proprietà Nessuna.
  const { LIMITED, NONE } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const entryLevel = data.some(p => p.ownership.default > LIMITED) ? LIMITED : NONE;
  let entry = existing;
  if ( entry ) await updateJournalPages(entry, data, {
    [`flags.${MODULE_ID}.journal`]: name,
    "ownership.default": Math.max(entry.ownership.default ?? NONE, entryLevel)
  });
  else entry = await JournalEntry.implementation.create({
    name, pages: data, ownership: { default: entryLevel }, flags: { [MODULE_ID]: { journal: name } }
  });

  // Le pagine generate sono state lette fuori dalla coda: un ricordo arrivato nel frattempo le avrebbe rese vecchie.
  // Rigenerarle in coda le allinea all'ultimo stato salvato.
  for ( const [, file] of pages ) {
    if ( file in DYNAMIC_PAGES ) await inNetherQueue(() => refreshDynamicPage(file));
  }
  entry.sheet.render({ force: true });
  return entry;
}

/**
 * Aggiorna sul posto le pagine già presenti, così i link @UUID alle pagine restano validi: abbina prima per file,
 * poi per nome (pagine create prima che il modulo segnasse il file); crea le mancanti e cancella le altre.
 */
async function updateJournalPages(entry, data, entryChanges) {
  const free = entry.pages.filter(p => p.type === "text");
  const claim = test => {
    const i = free.findIndex(test);
    return (i < 0) ? null : free.splice(i, 1)[0];
  };
  const matched = data.map(d => claim(p => p.getFlag(MODULE_ID, "file") === d.flags[MODULE_ID].file));
  data.forEach((d, i) => matched[i] ??= claim(p => p.name === d.name));
  const updates = data.flatMap(({ type, ...changes }, i) => (matched[i] ? [{ _id: matched[i].id, ...changes }] : []));
  const creates = data.filter((d, i) => !matched[i]);
  const leftovers = entry.pages.filter(p => !matched.includes(p)).map(p => p.id);
  if ( leftovers.length ) await entry.deleteEmbeddedDocuments("JournalEntryPage", leftovers);
  if ( updates.length ) await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
  if ( creates.length ) await entry.createEmbeddedDocuments("JournalEntryPage", creates);
  await entry.update(entryChanges);
}

/* -------------------------------------------- */
/*  Blocco 10: scene, note e incontri           */
/* -------------------------------------------- */

/**
 * Le note delle aree portano il titolo che devono aprire (flag heading, per esempio «E3: Bivio nella caverna»),
 * scelto quando la nota è stata creata: qui basta trasformarlo nell'ancora, con la stessa regola dell'indice.
 */
function onActivateNote(note, options) {
  const heading = note.document.getFlag(MODULE_ID, "heading");
  if ( heading && note.document.page ) options.anchor = foundry.documents.JournalEntryPage.slugifyHeading(heading);
}

/** Aspetta il prossimo clic sinistro sulla mappa e ne restituisce la posizione. Esc o un cambio di scena annullano. */
function pickCanvasPoint() {
  return new Promise(resolve => {
    const stage = canvas.stage;
    const done = point => {
      stage.off("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      Hooks.off("canvasTearDown", onTearDown);
      resolve(point);
    };
    const onDown = event => { if ( event.button === 0 ) done(event.getLocalPosition(stage)); };
    const onKey = event => {
      if ( event.key !== "Escape" ) return;
      event.stopPropagation(); // l'Esc annulla solo la scelta, non chiude finestre né deseleziona
      done(null);
    };
    const onTearDown = () => done(null);
    stage.on("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    Hooks.on("canvasTearDown", onTearDown);
  });
}

/**
 * Fa partire un incontro sulla scena attuale: rivela i token, li mette nel combattimento della scena
 * (creato se manca), aggiunge se richiesto i personaggi giocanti e tira l'iniziativa dei PNG.
 * @param {TokenDocument[]} tokens
 * @param {object} [options]
 * @param {boolean} [options.reveal=true]       Rende visibili i token nascosti.
 * @param {boolean} [options.addPCs=true]       Aggiunge anche i token dei giocatori presenti sulla scena.
 * @param {boolean} [options.rollNPCs=true]     Tira l'iniziativa dei PNG appena aggiunti.
 */
async function activateEncounter(tokens, { reveal = true, addPCs = true, rollNPCs = true } = {}) {
  const scene = canvas.scene;
  if ( !tokens.length ) return ui.notifications.warn("Nessun token da attivare.");
  const hidden = tokens.filter(t => t.hidden);
  // Il combattimento in corso su questa scena; quelli vecchi o non attivi restano dove sono.
  // (game.combat no: è quello che il tracker mostra, anche se vecchio e non attivo)
  const [combat] = await Promise.all([
    game.combats.find(c => c.active && (c.scene?.id === scene.id)) ?? Combat.implementation.create({ scene: scene.id, active: true }),
    (reveal && hidden.length) ? scene.updateEmbeddedDocuments("Token", hidden.map(t => ({ _id: t.id, hidden: false }))) : null
  ]);
  const fighting = new Set(combat.combatants.map(c => c.tokenId));
  const selected = new Set(tokens);
  const foes = tokens.filter(t => !fighting.has(t.id));
  const pcs = addPCs ? scene.tokens.filter(t => t.actor?.hasPlayerOwner && !selected.has(t) && !fighting.has(t.id)) : [];
  // Il combattente eredita hidden dal token: senza rivelare, resta nascosto anche nel tracker dei giocatori.
  const created = await TokenDocument.implementation.createCombatants([...foes, ...pcs], { combat });
  const npcs = created.filter(c => c.isNPC && (c.initiative === null));
  if ( rollNPCs && npcs.length ) await combat.rollInitiative(npcs.map(c => c.id), { messageMode: "gm" });
  const names = Object.entries(Object.groupBy(tokens, t => t.name))
    .map(([n, l]) => esc(n) + (l.length > 1 ? ` ×${l.length}` : ""));
  await whisperGM(`<h3>Incontro attivato</h3><p>${names.join(", ")}</p>`
    + `<p><em>${reveal ? `Rivelati ${hidden.length}. ` : ""}Nel combattimento: ${foes.length} nuovi`
    + `${pcs.length ? `, più ${pcs.length} personaggi giocanti` : ""}.</em></p>`);
  return combat;
}

/** Raggio proposto, in quadretti, quando l'incontro si sceglie cliccando sulla mappa. */
const ENCOUNTER_RADIUS = 8;

/**
 * Macro «Attiva incontro»: usa i token selezionati; senza selezione chiede di cliccare il centro dell'area
 * e prende i token nascosti entro il raggio scelto.
 */
async function promptActivateEncounter() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può attivare un incontro.");
  if ( !canvas.scene ) return ui.notifications.warn("Apri prima una scena.");
  let tokens = canvas.tokens.controlled.map(t => t.document);
  const pickArea = !tokens.length;
  const intro = pickArea
    ? `<p>Nessun token selezionato: dopo aver confermato, clicca sulla mappa al centro dell'area (Esc annulla).</p>
      <div class="form-group"><label>Raggio (quadretti)</label><div class="form-fields">
        <input type="number" name="radius" value="${ENCOUNTER_RADIUS}" min="1" max="60" step="1"></div></div>`
    : `<p>Uso i <strong>${tokens.length}</strong> token selezionati.</p>`;
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Attiva incontro" },
    content: `${intro}
      <div class="form-group"><label>Rivela i token nascosti</label><input type="checkbox" name="reveal" checked></div>
      <div class="form-group"><label>Aggiungi i personaggi giocanti</label><input type="checkbox" name="addPCs" checked></div>
      <div class="form-group"><label>Tira l'iniziativa dei PNG</label><input type="checkbox" name="rollNPCs" checked></div>`,
    ok: { label: pickArea ? "Scegli l'area" : "Attiva" }
  });
  if ( !data ) return;
  if ( pickArea ) {
    ui.notifications.info("Clicca sulla mappa al centro dell'area dell'incontro.");
    const point = await pickCanvasPoint();
    if ( !point ) return;
    const radius = (Number(data.radius) || ENCOUNTER_RADIUS) * canvas.grid.size;
    tokens = canvas.scene.tokens.filter(t => {
      if ( !t.hidden ) return false;
      const c = t.getCenterPoint();
      return Math.hypot(c.x - point.x, c.y - point.y) <= radius;
    });
    if ( !tokens.length ) return ui.notifications.warn("Nessun token nascosto in quel raggio.");
    canvas.tokens.releaseAll();
    for ( const t of tokens ) t.object?.control({ releaseOthers: false });
  }
  return activateEncounter(tokens, { reveal: !!data.reveal, addPCs: !!data.addPCs, rollNPCs: !!data.rollNPCs });
}

// La mappa del GM ha width/height doppi del viewBox: la scena la ridimensiona a size (cael-morrow.json)
// e resta nitida anche ingrandita. Le coordinate dei punti sono nel viewBox, cioè già in coordinate di scena.
const CAEL_SCENE_IMG = `modules/${MODULE_ID}/img/cael-morrow-gm.svg`;
const CAEL_SCENE_NAME = "Cael Morrow: mappa a punti";
const CAEL_SCENE_FLAG = "cael-morrow";
const CAEL_NOTE_OFFSET = 22; // icona in alto a destra del cerchio, così il codice disegnato resta leggibile

/**
 * Crea (o aggiorna) la scena «Cael Morrow: mappa a punti» con una nota per ogni punto del pointcrawl.
 * Ogni nota apre la pagina «Mappa a punti di Cael Morrow» del blocco 7 sul titolo del punto.
 */
async function createCaelScene() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può creare la scena.");
  const page = caelPage();
  if ( !page ) return ui.notifications.warn(`Manca la pagina «${CAEL_PAGE}»: ${rebuildHint(7)}`);
  const { nodes, size } = await caelMap();
  let scene = game.scenes.find(s => s.getFlag(MODULE_ID, "scene") === CAEL_SCENE_FLAG);
  if ( scene?.getFlag(MODULE_ID, "locked") ) {
    return ui.notifications.warn(`La scena «${scene.name}» è bloccata: sbloccala per rifare le note.`);
  }
  if ( scene ) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: CAEL_SCENE_NAME },
      content: "<p>La scena esiste già. Aggiorno la mappa e rifaccio le note dei punti (le altre note restano)?</p>"
    });
    if ( !ok ) return;
    await scene.update(size);
  }
  else {
    const folder = game.folders.find(f => (f.type === "Scene") && f.name.startsWith("Capitolo 5"));
    scene = await Scene.implementation.create({
      name: CAEL_SCENE_NAME, folder: folder?.id ?? null, navigation: false, ...size, padding: 0,
      grid: { type: CONST.GRID_TYPES.GRIDLESS, size: 100 },
      tokenVision: false, fog: { exploration: false },
      journal: page.parent.id, journalEntryPage: page.id,
      flags: { [MODULE_ID]: { scene: CAEL_SCENE_FLAG } }
    });
  }
  // In v14 lo sfondo sta sul livello della scena: il vecchio campo background in create viene ignorato.
  await scene.levels.contents[0]?.update({ background: { src: CAEL_SCENE_IMG, color: "#050d16" } });
  const old = scene.notes.filter(n => n.getFlag(MODULE_ID, "area")).map(n => n.id);
  if ( old.length ) await scene.deleteEmbeddedDocuments("Note", old);
  await scene.createEmbeddedDocuments("Note", nodes.map(n => ({
    entryId: page.parent.id, pageId: page.id, x: n.x + CAEL_NOTE_OFFSET, y: n.y - CAEL_NOTE_OFFSET,
    text: nodeTitle(n), iconSize: 32, texture: { src: "icons/svg/book.svg" },
    flags: { [MODULE_ID]: { area: n.code, heading: nodeTitle(n) } }
  })));
  ui.notifications.info(`Scena «${scene.name}»: ${nodes.length} note sui punti.`);
  return scene;
}

/**
 * Blocca o sblocca una scena: gli script del remix (scenefix, createCaelScene) non toccano le scene bloccate,
 * così i ritocchi fatti a mano su note e token restano.
 * @param {boolean} locked
 * @param {Scene} [scene]      Di default la scena che stai guardando.
 */
async function lockScene(locked, scene = canvas.scene) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può bloccare le scene.");
  if ( !scene ) return ui.notifications.warn("Nessuna scena aperta.");
  if ( !!scene.getFlag(MODULE_ID, "locked") === locked ) {
    return ui.notifications.info(`La scena «${scene.name}» è già ${locked ? "bloccata" : "sbloccata"}.`);
  }
  if ( locked ) await scene.setFlag(MODULE_ID, "locked", true);
  else await scene.unsetFlag(MODULE_ID, "locked");
  ui.notifications.info(locked
    ? `Scena «${scene.name}» bloccata: gli script del remix non la toccano più.`
    : `Scena «${scene.name}» sbloccata.`);
  return scene;
}

/* -------------------------------------------- */
/*  Battle map del pacchetto CalloftheNetherdeep */
/* -------------------------------------------- */

// mappack.py (cor-cotn-traduzione) prepara immagini e worlds/<mondo>/netherdeep-maps/capN.json con muri, luci
// e pin già in pixel di scena; qui si creano le scene. Tutto quello che crea l'import porta il flag MAP_FLAG:
// rilanciando si rifà solo quello, i ritocchi a mano (token, muri disegnati, note tue) restano.
const MAP_FLAG = "map";
const MAP_PIN_ICONS = { book: "icons/svg/book.svg", remix: "icons/svg/sun.svg" };
const MAP_REGION_COLORS = { passage: "#2aa7d6", hazard: "#d6332a" };

/** Titoli dei diari del libro (non di quelli del remix) indicizzati per slug: le pagine che li hanno, in ordine. */
function bookHeadings() {
  const index = new Map();
  const parser = new DOMParser();
  for ( const entry of game.journal ) {
    if ( entry.getFlag(MODULE_ID, "journal") ) continue;
    for ( const page of entry.pages ) {
      if ( (page.type !== "text") || !page.text.content ) continue;
      const doc = parser.parseFromString(page.text.content, "text/html");
      for ( const h of doc.querySelectorAll("h1, h2, h3, h4, h5, h6") ) {
        const key = foundry.documents.JournalEntryPage.slugifyHeading(h.textContent);
        if ( !index.has(key) ) index.set(key, []);
        if ( !index.get(key).includes(page) ) index.get(key).push(page);
      }
    }
  }
  return index;
}

const byElevation = (a, b) => (a.elevation.bottom ?? -Infinity) - (b.elevation.bottom ?? -Infinity);

/** Allinea i livelli della scena a quelli del catalogo (dal basso verso l'alto) e li restituisce in ordine. */
async function syncMapLevels(scene, levels) {
  const current = scene.levels.contents.sort(byElevation);
  const docs = levels.map((l, i) => ({
    name: l.name, elevation: l.elevation, sort: i,
    background: { src: l.src, color: "#000000" }, foreground: { src: l.foreground ?? null }
  }));
  const updates = docs.slice(0, current.length).map((d, i) => ({ _id: current[i].id, ...d }));
  if ( updates.length ) await scene.updateEmbeddedDocuments("Level", updates);
  const surplus = current.slice(docs.length).map(l => l.id);
  if ( surplus.length ) await scene.deleteEmbeddedDocuments("Level", surplus);
  if ( docs.length > current.length ) await scene.createEmbeddedDocuments("Level", docs.slice(current.length));
  return scene.levels.contents.sort(byElevation);
}

async function importMapScene(data, scene, folder, headings, missing) {
  // Lo stesso titolo può stare in più pagine (First Eclipse: guida del bazar e missione): il pin può sceglierla per nome.
  const bookPage = (heading, pageName) => {
    const pages = headings.get(foundry.documents.JournalEntryPage.slugifyHeading(heading)) ?? [];
    const page = pages.find(p => p.name === pageName) ?? pages[0];
    if ( !page ) missing.add(heading);
    return page;
  };
  const page = bookPage(data.heading);
  const variants = data.variants ?? [];
  const firstVariant = variants[0]?.name ?? null;
  const sceneData = {
    name: data.name, width: data.width, height: data.height, padding: 0,
    grid: { type: CONST.GRID_TYPES.SQUARE, ...data.grid },
    tokenVision: data.vision, fog: { exploration: data.vision },
    ...(data.darkness != null ? { environment: { darknessLevel: data.darkness } } : {}),
    journal: page?.parent.id ?? null, journalEntryPage: page?.id ?? null,
    flags: { [MODULE_ID]: { [MAP_FLAG]: data.key, variants, variant: firstVariant } }
  };
  if ( scene ) {
    await scene.update(sceneData);
    for ( const type of ["Wall", "AmbientLight", "Note", "Tile", "Region"] ) {
      const ids = scene.getEmbeddedCollection(type).filter(d => d.getFlag(MODULE_ID, MAP_FLAG)).map(d => d.id);
      if ( ids.length ) await scene.deleteEmbeddedDocuments(type, ids);
    }
  }
  else scene = await Scene.implementation.create({ ...sceneData, folder: folder?.id ?? null, navigation: false });

  const levels = await syncMapLevels(scene, data.levels);
  const flags = { [MODULE_ID]: { [MAP_FLAG]: true } };
  const walls = data.levels.flatMap((l, i) => l.walls.map(w => ({ ...w, levels: [levels[i].id], flags })));
  // Luci legate a una variante: accese solo con quella (applyMapVariant le scambia).
  const lights = data.levels.flatMap((l, i) => l.lights.map(({ variant, ...light }) => ({
    ...light, elevation: l.elevation.bottom, levels: [levels[i].id],
    hidden: !!variant && (variant !== firstVariant),
    flags: variant ? { [MODULE_ID]: { ...flags[MODULE_ID], variant } } : flags
  })));
  // I pin stanno sul livello di partenza: senza, Foundry li mostra su tutti i piani.
  const start = data.start ?? 0;
  const notes = data.pins.flatMap(pin => {
    const target = pin.remix ? modulePage(pin.remix) : bookPage(pin.heading, pin.page);
    if ( !target ) {
      if ( pin.remix ) missing.add(`pagina del remix ${pin.remix} (crea prima il diario del suo blocco)`);
      return [];
    }
    return [{
      entryId: target.parent.id, pageId: target.id, x: pin.x, y: pin.y, text: pin.label, iconSize: 40,
      elevation: data.levels[start].elevation.bottom, levels: [levels[start].id],
      texture: { src: pin.remix ? MAP_PIN_ICONS.remix : MAP_PIN_ICONS.book },
      flags: { [MODULE_ID]: { [MAP_FLAG]: true, area: pin.code ?? null, heading: pin.heading ?? null } }
    }];
  });
  if ( walls.length ) await scene.createEmbeddedDocuments("Wall", walls);
  if ( lights.length ) await scene.createEmbeddedDocuments("AmbientLight", lights);
  if ( notes.length ) await scene.createEmbeddedDocuments("Note", notes);
  // I tetti sfumano quando un token ci passa sotto; i cataloghi vecchi non hanno level/elevation sulle tile.
  // Il catalogo dà l'angolo in alto a sinistra, in v14 x/y della tile sono il punto d'ancoraggio (il centro).
  const tiles = (data.tiles ?? []).map(({ src, level = 0, roof, ...t }) => ({
    ...t, x: t.x + (t.width / 2), y: t.y + (t.height / 2), texture: { src }, elevation: t.elevation ?? data.levels[level].elevation.bottom, levels: [levels[level].id],
    occlusion: { modes: roof ? [CONST.OCCLUSION_MODES.FADE] : [] }, flags
  }));
  if ( tiles.length ) await scene.createEmbeddedDocuments("Tile", tiles);
  // Regioni solo per il GM: i passaggi verso un'altra scena li collega linkMapPassages, i pericoli sono segnati e basta.
  const regions = (data.regions ?? []).map(r => ({
    name: r.name, color: MAP_REGION_COLORS[r.kind] ?? MAP_REGION_COLORS.passage,
    shapes: [{ type: "rectangle", x: r.x, y: r.y, width: r.width, height: r.height }],
    levels: [levels[start].id], visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    flags: { [MODULE_ID]: { [MAP_FLAG]: true, link: `${data.key}#${r.name}`, to: r.to ?? null, disabled: !!r.disabled } }
  }));
  if ( regions.length ) await scene.createEmbeddedDocuments("Region", regions);
  if ( data.start ) await scene.update({ initialLevel: levels[data.start].id });
  return scene;
}

/**
 * Collega i passaggi delle battle map (regione «to» = chiave scena#nome) con un comportamento Teleport Token.
 * Si rifà su tutte le scene a ogni import: un capitolo reimportato ricrea le sue regioni, e i passaggi che
 * puntavano lì vanno aggiornati. Il teletrasporto chiede conferma a chi muove (choice) senza svelare la meta;
 * quelli che il libro fa scattare solo in certi momenti nascono disattivati e li attiva il GM.
 * @returns {Promise<string[]>}  Mete non ancora importate.
 */
async function linkMapPassages() {
  const regions = game.scenes.filter(s => s.getFlag(MODULE_ID, MAP_FLAG)).flatMap(s => s.regions.contents)
    .filter(r => r.getFlag(MODULE_ID, MAP_FLAG));
  const byLink = new Map(regions.map(r => [r.getFlag(MODULE_ID, "link"), r]));
  const missing = [];
  for ( const region of regions ) {
    const to = region.getFlag(MODULE_ID, "to");
    if ( !to ) continue;
    const old = region.behaviors.filter(b => b.getFlag(MODULE_ID, MAP_FLAG)).map(b => b.id);
    if ( old.length ) await region.deleteEmbeddedDocuments("RegionBehavior", old);
    const target = byLink.get(to);
    if ( !target ) {
      missing.push(to);
      continue;
    }
    await region.createEmbeddedDocuments("RegionBehavior", [{
      type: "teleportToken", name: "Passaggio", disabled: !!region.getFlag(MODULE_ID, "disabled"),
      system: { destinations: [target.uuid], choice: true, revealed: false },
      flags: { [MODULE_ID]: { [MAP_FLAG]: true } }
    }]);
  }
  return missing;
}

/**
 * Crea (o rifà) le scene di un capitolo dal catalogo preparato da mappack.py. Le scene bloccate si saltano.
 * @param {number} chapter
 */
async function importMapScenes(chapter) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può importare le mappe.");
  const path = `worlds/${game.world.id}/netherdeep-maps/cap${chapter}.json`;
  const response = await fetch(path, { cache: "no-store" });
  if ( !response.ok ) return ui.notifications.warn(`Manca ${path}: prepara il capitolo con mappack.py.`);
  const { folder: folderName, scenes } = await response.json();
  const folder = game.folders.find(f => (f.type === "Scene") && f.name.startsWith(folderName));
  const existing = new Map(game.scenes.filter(s => s.getFlag(MODULE_ID, MAP_FLAG)).map(s => [s.getFlag(MODULE_ID, MAP_FLAG), s]));
  const locked = scenes.filter(d => existing.get(d.key)?.getFlag(MODULE_ID, "locked"));
  const todo = scenes.filter(d => !locked.includes(d));
  const redo = todo.filter(d => existing.has(d.key)).length;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: `Mappe del capitolo ${chapter}` },
    content: `<p>Creo <strong>${todo.length - redo}</strong> scene nuove${redo
      ? ` e rifaccio sfondi, muri, luci, pin e regioni di <strong>${redo}</strong> già importate (token e aggiunte tue restano)` : ""}.</p>
      ${locked.length ? `<p>Salto le scene bloccate: ${locked.map(d => esc(d.name)).join(", ")}.</p>` : ""}`
  });
  if ( !ok ) return;
  const headings = bookHeadings();
  const missing = new Set();
  const done = [];
  for ( const data of todo ) done.push(await importMapScene(data, existing.get(data.key), folder, headings, missing));
  if ( missing.size ) ui.notifications.warn(`Titoli non trovati nei diari: ${[...missing].join("; ")}`);
  const unlinked = await linkMapPassages();
  if ( unlinked.length ) ui.notifications.info(`Passaggi da collegare quando importi la scena di arrivo: ${unlinked.join("; ")}`);
  ui.notifications.info(`Capitolo ${chapter}: ${done.length} scene pronte nella cartella «${folder?.name ?? "senza cartella"}».`);
  return done;
}

/**
 * Cambia la variante della battle map (giorno/notte, con o senza carro…): sostituisce lo sfondo di ogni livello.
 * @param {string} name
 * @param {Scene} [scene]
 */
async function applyMapVariant(name, scene = canvas.scene) {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può cambiare la mappa.");
  const variant = scene?.getFlag(MODULE_ID, "variants")?.find(v => v.name === name);
  if ( !variant ) return ui.notifications.warn(`La scena non ha la variante «${name}».`);
  // Luci e buio prima dello sfondo: cambiare lo sfondo ricarica il canvas.
  // Si toccano solo le luci della variante uscente e di quella entrante: le altre spente a mano restano spente.
  const previous = scene.getFlag(MODULE_ID, "variant");
  const lights = scene.lights.contents.flatMap(l => {
    const own = l.getFlag(MODULE_ID, "variant");
    const hidden = own !== name;
    return own && (own === name || own === previous) && (hidden !== l.hidden) ? [{ _id: l.id, hidden }] : [];
  });
  await Promise.all([
    lights.length ? scene.updateEmbeddedDocuments("AmbientLight", lights) : null,
    scene.update({
      ...(variant.darkness != null ? { "environment.darknessLevel": variant.darkness } : {}),
      [`flags.${MODULE_ID}.variant`]: name
    })
  ]);
  const levels = scene.levels.contents.sort(byElevation);
  const updates = variant.srcs.flatMap((src, i) => levels[i] ? [{ _id: levels[i].id, "background.src": src }] : []);
  await scene.updateEmbeddedDocuments("Level", updates);
  ui.notifications.info(`«${scene.name}»: ${name}.`);
  return scene;
}

async function promptMapVariant() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può cambiare la mappa.");
  const scene = canvas.scene;
  const variants = scene?.getFlag(MODULE_ID, "variants") ?? [];
  if ( variants.length < 2 ) return ui.notifications.warn("Questa scena non ha varianti da scegliere.");
  const current = scene.getFlag(MODULE_ID, "variant");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: scene.name },
    content: `<div class="form-group"><label>Variante</label>
      <select name="variant">${variants.map(v => selectOption(v.name, v.name, current)).join("")}</select></div>`,
    ok: { label: "Cambia" }
  });
  if ( data ) return applyMapVariant(data.variant, scene);
}

async function promptImportMapScenes() {
  if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può importare le mappe.");
  const data = await foundry.applications.api.DialogV2.input({
    window: { title: "Mappe: importa un capitolo" },
    content: `<div class="form-group"><label>Capitolo</label><div class="form-fields">
      <input type="number" name="chapter" value="1" min="1" max="7" step="1"></div></div>`,
    ok: { label: "Importa" }
  });
  if ( data ) return importMapScenes(Number(data.chapter));
}

/* -------------------------------------------- */
/*  Installazione nel mondo                     */
/* -------------------------------------------- */

const MACROS = [
  ["Ruidium: usa", "01-usa-ruidium.js", "icons/commodities/gems/gem-faceted-rough-red.webp"],
  ["Ruidium: tiro contro la corruzione", "02-tiro-corruzione.js", "icons/magic/unholy/orb-glowing-purple.webp"],
  ["Ruidium: crea l'oggetto", "03-crea-ruidium.js", "icons/commodities/gems/gem-cluster-red.webp"],
  ["Remix: crea il diario del blocco 1", "04-crea-diario-blocco1.js", "icons/sundries/books/book-red-exclamation.webp"],
  ["Remix: crea il diario del blocco 2", "05-crea-diario-blocco2.js", "icons/sundries/books/book-turquoise-moon.webp"],
  ["Grande finale: lotteria", "06-lotteria-finale.js", "icons/sundries/gaming/gaming-set-chips.webp"],
  ["Occhio di Smeraldo: l'annuncio", "07-annuncio-occhio.js", "icons/commodities/gems/gem-faceted-large-green.webp"],
  ["Remix: crea il diario del blocco 3", "08-crea-diario-blocco3.js", "icons/sundries/books/book-open-turquoise.webp"],
  ["Visione dell'Apotheon", "09-visione-apotheon.js", "icons/magic/perception/eye-ringed-glow-angry-red.webp"],
  ["Remix: crea il diario del blocco 4", "10-crea-diario-blocco4.js", "icons/sundries/books/book-worn-brown-grey.webp"],
  ["Studiosi: dove sono adesso?", "11-studiosi-dove.js", "icons/tools/navigation/map-marked-blue.webp"],
  ["Studiosi: atteggiamenti", "12-studiosi-atteggiamenti.js", "icons/skills/social/diplomacy-handshake.webp"],
  ["Studiosi: il colpo al Gioiello", "13-studiosi-colpo.js", "icons/skills/social/theft-pickpocket-bribery-brown.webp"],
  ["Remix: crea il diario del blocco 5", "14-crea-diario-blocco5.js", "icons/sundries/books/book-embossed-blue.webp"],
  ["Betrayers' Rise: i rivali", "15-rise-rivali.js", "icons/environment/settlement/temple-night.webp"],
  ["Remix: crea il diario del blocco 6", "16-crea-diario-blocco6.js", "icons/sundries/books/book-black-grey.webp"],
  ["Betrayers' Rise: la traversata", "17-rise-traversata.js", "icons/environment/wilderness/cave-entrance-rocky.webp"],
  ["Cael Morrow: viaggio", "18-cael-viaggio.js", "icons/creatures/fish/fish-marlin-swordfight-blue.webp"],
  ["Cael Morrow: fazioni e allerta", "19-cael-fazioni.js", "icons/tools/navigation/map-chart-tan.webp"],
  ["Remix: crea il diario del blocco 7", "20-crea-diario-blocco7.js", "icons/sundries/books/book-eye-purple.webp"],
  ["Fazioni: orologi e contese", "21-fazioni-orologi.js", "icons/magic/time/clock-analog-gray.webp"],
  ["Fazioni: il turno delle fazioni", "22-fazioni-turno.js", "icons/magic/time/day-night-sunset-sunrise.webp"],
  ["Remix: crea il diario del blocco 8", "23-crea-diario-blocco8.js", "icons/sundries/books/book-embossed-gold-red.webp"],
  ["Netherdeep: un ricordo", "24-netherdeep-ricordo.js", "icons/magic/perception/silhouette-stealth-shadow.webp"],
  ["Netherdeep: i ricordi visti", "25-netherdeep-ricordi-visti.js", "icons/sundries/documents/document-sealed-brown-red.webp"],
  ["Netherdeep: rivali al finale", "26-netherdeep-rivali.js", "icons/skills/social/intimidation-impressing.webp"],
  ["Netherdeep: epilogo", "27-netherdeep-epilogo.js", "icons/magic/light/explosion-star-glow-silhouette.webp"],
  ["Remix: crea il diario del blocco 9", "28-crea-diario-blocco9.js", "icons/sundries/books/book-symbol-triangle-silver-blue.webp"],
  ["Attiva incontro", "29-attiva-incontro.js", "icons/skills/melee/weapons-crossed-swords-yellow.webp"],
  ["Cael Morrow: crea la scena a punti", "30-crea-scena-cael-morrow.js", "icons/environment/wilderness/wall-ruins.webp"],
  ["Blocca scena", "31-blocca-scena.js", "icons/sundries/misc/lock-steel-blue.webp"],
  ["Sblocca scena", "32-sblocca-scena.js", "icons/sundries/misc/lock-open-yellow.webp"],
  ["Mappe: importa un capitolo", "33-importa-mappe.js", "icons/tools/navigation/map-marked-green.webp"],
  ["Mappe: cambia variante", "34-cambia-variante.js", "icons/magic/time/day-night-sun-moon.webp"]
];

/** Le uniche macro che i giocatori vedono: le altre sono del GM e i loro nomi anticipano la trama. */
const PLAYER_MACROS = new Set(["01-usa-ruidium.js"]);

async function fetchText(path) {
  const response = await fetch(`modules/${MODULE_ID}/${path}`);
  if ( !response.ok ) throw new Error(`${MODULE_ID} | file mancante: ${path}`);
  return response.text();
}

/** Crea (o aggiorna) le macro del modulo in una cartella dedicata. Solo il GM attivo. */
async function installMacros() {
  const folder = await moduleFolder("Macro");
  const commands = await Promise.all(MACROS.map(([, file]) => fetchText(`macros/${file}`)));
  const { NONE, OBSERVER } = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  for ( const [i, [name, file, img]] of MACROS.entries() ) {
    const command = commands[i];
    const access = PLAYER_MACROS.has(file) ? OBSERVER : NONE;
    const existing = game.macros.find(m => m.getFlag(MODULE_ID, "file") === file);
    if ( existing ) {
      const changes = {};
      if ( existing.command !== command ) changes.command = command;
      if ( existing.name !== name ) changes.name = name;
      if ( existing.img !== img ) changes.img = img;
      // Il default si impone solo quando cambia quello voluto dal modulo (flag access): se poi il GM lo cambia
      // a mano, resta. I permessi dati ai singoli giocatori non si toccano mai.
      if ( existing.getFlag(MODULE_ID, "access") !== access ) {
        changes["ownership.default"] = access;
        changes[`flags.${MODULE_ID}.access`] = access;
      }
      if ( !foundry.utils.isEmpty(changes) ) await existing.update(changes);
      continue;
    }
    await Macro.implementation.create({
      name, img, command, type: "script", folder: folder.id,
      ownership: { default: access },
      flags: { [MODULE_ID]: { file, access } }
    });
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "scholarAttitudes", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "caelMorrow", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "factionMissions", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.settings.register(MODULE_ID, "netherdeep", {
    scope: "world", config: false, type: Object, default: {}
  });
  game.modules.get(MODULE_ID).api = {
    METAMAGIC, isCorrupted, corrupt, addExhaustion, corruptionSave, useRuidium, promptRuidium, getRuidiumItem,
    installMacros, finaleLottery, promptFinaleLottery, emeraldAnnouncement, promptEmeraldAnnouncement,
    VISION_ENDINGS, apotheonVision, promptApotheonVision,
    SCHOLARS, getScholarAttitudes, scholarsWhereabouts, scholarAttitudesReport, promptScholarAttitudes,
    heistPlan, promptHeistPlan, RIVAL_MODES, risePlan, promptRisePlan, GUIDES, riseCrossing, promptRiseCrossing, drawText, createJournal, importTables,
    ALERT_LEVELS, caelMap, getCaelState, caelTravel, promptCaelTravel, caelReport, promptCaelControl,
    CLOCK_OWNERS, contests, getFactionState, clocksReport, advanceClock, factionTurn, promptFactionTurn, promptFactionClocks,
    RIVALS, CHOICES, memories, epilogues, getNetherState, apotheonMemory, promptApotheonMemory, checkMemoryOrder,
    memoryOrderReport, promptMemoryState, rivalsFinale, promptRivalsFinale, netherdeepEpilogue, promptNetherdeepEpilogue,
    activateEncounter, promptActivateEncounter, createCaelScene, lockScene, importMapScenes, promptImportMapScenes,
    applyMapVariant, promptMapVariant
  };
});

Hooks.on("activateNote", onActivateNote);

Hooks.once("ready", async () => {
  if ( game.users.activeGM !== game.user ) return;
  try {
    await installMacros();
  } catch(err) {
    console.error(err);
    ui.notifications.error("Remix Netherdeep: non riesco a creare le macro, vedi la console (F12).");
  }
});

// Il livello precedente viaggia nelle opzioni dell'operazione fino all'hook di update.
Hooks.on("preUpdateActiveEffect", (effect, changes, options) => {
  if ( !isExhaustion(effect) || !foundry.utils.hasProperty(changes, "system.level") ) return;
  foundry.utils.setProperty(options, `${MODULE_ID}.previousLevel`, effect.system.level);
});

// Solo il client che ha fatto la modifica tira i danni, così non arrivano doppi.
Hooks.on("updateActiveEffect", (effect, changes, options, userId) => {
  if ( (userId !== game.user.id) || !isExhaustion(effect) ) return;
  const previous = foundry.utils.getProperty(options, `${MODULE_ID}.previousLevel`) ?? options.dnd5e?.originalLevel;
  if ( !Number.isFinite(previous) ) return;
  onExhaustionChange(effect.parent, effect.system.level - previous);
});

Hooks.on("createActiveEffect", (effect, options, userId) => {
  if ( (userId !== game.user.id) || !isExhaustion(effect) ) return;
  onExhaustionChange(effect.parent, effect.system.level ?? 1);
});

Hooks.on("deleteActiveEffect", (effect, options, userId) => {
  if ( (userId !== game.user.id) || !isExhaustion(effect) ) return;
  onExhaustionChange(effect.parent, -(effect.system.level ?? 1));
});
