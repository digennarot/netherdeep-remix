// Macro (script, GM): tiro salvezza contro la corruzione da ruidium per tutti i token selezionati.
// Serve per le esposizioni previste dall'avventura (armi di ruidium, affioramenti, Netherdeep).
const api = game.modules.get("netherdeep-remix")?.api;
if ( !api ) return ui.notifications.error("Attiva il modulo «Call of the Netherdeep: remix».");
const actors = canvas.tokens.controlled.map(t => t.actor).filter(Boolean);
if ( !actors.length ) return ui.notifications.warn("Seleziona almeno un token.");

const dc = await foundry.applications.api.DialogV2.prompt({
  window: { title: "Virulenza del ruidium" },
  content: `<div class="form-group"><label>CD del tiro salvezza su Carisma</label>
    <div class="form-fields"><input type="number" name="dc" value="15" min="1" step="1" autofocus></div></div>`,
  ok: { label: "Tira", callback: (event, button) => button.form.elements.dc.valueAsNumber }
});
if ( !Number.isFinite(dc) ) return;
for ( const actor of actors ) await api.corruptionSave(actor, { dc });
