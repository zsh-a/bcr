/**
 * 虚构地址库：每个地区 ≥12 条，全部为虚构地名。
 * address Record 的键与该region模板的 fields[].key 一一对应。
 */

import type { RegionId } from "./model";

export interface AddressBook {
  readonly regionId: RegionId;
  readonly entries: ReadonlyArray<Record<string, string>>;
}

const NORDHAVN_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { street: "14 Fjordgate", city: "Nordhavn", province: "Havnmark" },
  { street: "27 Havnevej", city: "Nordhavn", province: "Havnmark" },
  { street: "3 Skibbroen", city: "Vestkysten", province: "Vestfjord" },
  { street: "108 Ternstranda", city: "Nordhavn", province: "Havnmark" },
  { street: "9 Møllebakken", city: "Brimnes", province: "Nordkyst" },
  { street: "51 Kystpromenaden", city: "Saltvik", province: "Vestfjord" },
  { street: "6 Fyrvejen", city: "Nordhavn", province: "Havnmark" },
  { street: "22 Briggata", city: "Østerfjord", province: "Nordkyst" },
  { street: "73 Ankerholmen", city: "Saltvik", province: "Vestfjord" },
  { street: "11 Salthuset Alle", city: "Nordhavn", province: "Havnmark" },
  { street: "40 Vindroerne", city: "Brimnes", province: "Nordkyst" },
  { street: "88 Langesundvej", city: "Østerfjord", province: "Nordkyst" },
  { street: "2 Bølgehavn", city: "Vestkysten", province: "Vestfjord" },
  { street: "35 Stormkjær", city: "Nordhavn", province: "Havnmark" },
];

const CALDERA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNumber: "12", streetName: "Cinder Lane", town: "Port Ember", postcode: "CE14 2PA" },
  { streetNumber: "7", streetName: "Obsidian Way", town: "Caldera City", postcode: "CC02 9QR" },
  { streetNumber: "143", streetName: "Ember Street", town: "Ashfall Bay", postcode: "AB27 4LM" },
  { streetNumber: "29", streetName: "Basalt Road", town: "Port Ember", postcode: "CE11 7TD" },
  { streetNumber: "4", streetName: "Lava Terrace", town: "Sulfur Springs", postcode: "SS33 1WE" },
  { streetNumber: "61", streetName: "Pumice Close", town: "Obsidian Point", postcode: "OP19 5HN" },
  { streetNumber: "18", streetName: "Crater View", town: "Caldera City", postcode: "CC04 6JK" },
  { streetNumber: "92", streetName: "Sulphur Quay", town: "Basalt Harbour", postcode: "BH08 3ZD" },
  { streetNumber: "55", streetName: "Magma Parade", town: "Port Ember", postcode: "CE16 8RF" },
  { streetNumber: "31", streetName: "Ashgrove Avenue", town: "Ashfall Bay", postcode: "AB25 0QT" },
  { streetNumber: "10", streetName: "Fumarole Walk", town: "Sulfur Springs", postcode: "SS30 2VB" },
  { streetNumber: "77", streetName: "Caldera Esplanade", town: "Caldera City", postcode: "CC01 1AA" },
  { streetNumber: "24", streetName: "Scoria Rise", town: "Obsidian Point", postcode: "OP21 4KC" },
  { streetNumber: "66", streetName: "Tephra Road", town: "Basalt Harbour", postcode: "BH10 6PL" },
];

const VERIDIA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNumber: "742", streetName: "Birchwood Lane", city: "Bluehill", state: "VD", zip: "74210" },
  { streetNumber: "15", streetName: "Kestrel Court", city: "Kestrel Ridge", state: "VD", zip: "74318" },
  { streetNumber: "2209", streetName: "Amber Run", city: "Amberfield", state: "VD", zip: "74402" },
  { streetNumber: "88", streetName: "Ridgeline Drive", city: "Veridia City", state: "VD", zip: "74001" },
  { streetNumber: "351", streetName: "Meadowlark Glen", city: "Bluehill", state: "VD", zip: "74211" },
  { streetNumber: "67", streetName: "Juniper Street", city: "Copper Hollow", state: "NR", zip: "73844" },
  { streetNumber: "913", streetName: "Copper Hollow Road", city: "Copper Hollow", state: "NR", zip: "73840" },
  { streetNumber: "410", streetName: "Larkspur Way", city: "Larkspur Vale", state: "VD", zip: "74526" },
  { streetNumber: "502", streetName: "Silverpine Trail", city: "Silverpine", state: "NR", zip: "73902" },
  { streetNumber: "77", streetName: "Dunmore Circle", city: "Dunmore Heights", state: "VD", zip: "74633" },
  { streetNumber: "1204", streetName: "Fern Hollow Road", city: "Fern Hollow", state: "NR", zip: "73851" },
  { streetNumber: "256", streetName: "Sunset Bluff", city: "Veridia City", state: "VD", zip: "74009" },
  { streetNumber: "39", streetName: "Harvest Lane", city: "Amberfield", state: "VD", zip: "74407" },
  { streetNumber: "1810", streetName: "Quarry Road", city: "Kestrel Ridge", state: "NR", zip: "73915" },
];

const CASTELLAN_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { street: "24 Rue des Tilleuls", city: "Castelbrun", postcode: "4812 EX" },
  { street: "8 Avenue du Clocher", city: "Montaubray", postcode: "3407 LM" },
  { street: "15 Rue de la Vignette", city: "Alverne", postcode: "2951 RA" },
  { street: "3 Place du Marché", city: "Castelbrun", postcode: "4810 CX" },
  { street: "41 Rue des Acacias", city: "Rocheval", postcode: "5523 VB" },
  { street: "12 Chemin des Lavandes", city: "Sercourt", postcode: "6190 SE" },
  { street: "6 Rue du Moulin", city: "Valdorey", postcode: "2764 VD" },
  { street: "30 Boulevard des Cyprès", city: "Brandelieu", postcode: "4088 BL" },
  { street: "19 Rue Haute", city: "Montaubray", postcode: "3409 MT" },
  { street: "5 Impasse des Oliviers", city: "Tourvaine", postcode: "5731 TV" },
  { street: "22 Rue de l'Aqueduc", city: "Castelbrun", postcode: "4814 AQ" },
  { street: "10 Place de la Halle", city: "Merlisac", postcode: "3650 MH" },
  { street: "14 Rue des Glycines", city: "Alverne", postcode: "2953 GL" },
  { street: "2 Rue du Château d'Eau", city: "Rocheval", postcode: "5527 RC" },
];

export const ADDRESS_BOOKS: ReadonlyArray<AddressBook> = [
  { regionId: "nordhavn", entries: NORDHAVN_ENTRIES },
  { regionId: "caldera", entries: CALDERA_ENTRIES },
  { regionId: "veridia", entries: VERIDIA_ENTRIES },
  { regionId: "castellan", entries: CASTELLAN_ENTRIES },
];

export function listAddresses(regionId: RegionId): ReadonlyArray<Record<string, string>> {
  const book = ADDRESS_BOOKS.find((b) => b.regionId === regionId);
  return book?.entries ?? [];
}

/** 确定性随机取一条地址（rng 由调用方注入） */
export function randomAddress(regionId: RegionId, rng: () => number): Record<string, string> {
  const entries = listAddresses(regionId);
  if (entries.length === 0) throw new Error(`no addresses for region ${regionId}`);
  const index = Math.floor(rng() * entries.length) % entries.length;
  const entry = entries[index];
  if (entry === undefined) throw new Error(`address index out of range: ${index}`);
  return { ...entry };
}
