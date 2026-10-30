// Macro (script, GM): crea l'oggetto «Ruidium» nella barra Oggetti.
// Trascinalo sulle schede: la quantità conta le once.
if ( !game.user.isGM ) return ui.notifications.warn("Solo il GM può creare l'oggetto.");
const item = await Item.implementation.create({
  name: "Ruidium",
  type: "loot",
  img: "icons/commodities/gems/gem-faceted-rough-red.webp",
  system: {
    type: { value: "material" },
    quantity: 1,
    weight: { value: 0.0625, units: "lb" },
    price: { value: 500, denomination: "gp" },
    description: {
      value: "<p>Cristallo rosso sangue che riflette una luce che non c'è. Un'oncia sostituisce 500 mo di "
        + "componenti materiali, oppure paga un punto stregoneria di metamagia. Ogni oncia usata in un "
        + "incantesimo impone un tiro salvezza su Carisma con CD 20: chi lo fallisce subisce 1 livello di "
        + "indebolimento e viene corrotto dal ruidium.</p>"
    }
  },
  flags: { "netherdeep-remix": { ruidium: true } }
});
item.sheet.render(true);
