// H5-H ONLY: intentionally fictional catalog, never commercial reference data.
import {makeCatalog} from '../h5-c/commercial-items.mjs';
export const FICTIONAL_PRODUCTS=Object.freeze([
 {id:'fixture-inv-12',category:'inverter',label:'Inversor fictício trifásico 12 kW — 380 V'},
 {id:'fixture-inv-15',category:'inverter',label:'Inversor fictício trifásico 15 kW — 380 V'},
 {id:'fixture-bess',category:'bess',label:'BESS de demonstração — compatibilidade não verificada'},
 {id:'fixture-module',category:'module',label:'Módulo solar fictício'},
 {id:'fixture-cable',category:'dc_cable_black',label:'Cabo CC fictício'},
 {id:'fixture-mc4',category:'mc4',label:'Conector MC4 fictício'},
 {id:'fixture-accessory',category:'accessory',label:'Acessório fictício — vínculo obrigatório ao BESS'},
 {id:'fixture-unavailable',category:'other',label:'Produto fictício indisponível',available:false}
]);
export const fictionalCatalog=makeCatalog(FICTIONAL_PRODUCTS);
