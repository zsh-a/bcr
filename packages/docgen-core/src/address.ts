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

export const ADDRESS_BOOKS: ReadonlyArray<AddressBook> = [
  { regionId: "nordhavn", entries: NORDHAVN_ENTRIES },
  { regionId: "caldera", entries: CALDERA_ENTRIES },
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
