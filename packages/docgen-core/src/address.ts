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

const WALDLAND_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { strasse: "Falkenstraße 12", plz: "91240", ort: "Falkenheim" },
  { strasse: "Waldweg 7", plz: "91244", ort: "Waldbrück" },
  { strasse: "Lindenallee 23", plz: "91317", ort: "Tannengrund" },
  { strasse: "Am Kirchberg 4", plz: "91252", ort: "Eichenhain" },
  { strasse: "Tannenweg 81", plz: "91240", ort: "Falkenheim" },
  { strasse: "Birkenstraße 16", plz: "91388", ort: "Moosfels" },
  { strasse: "Hauptstraße 102", plz: "91371", ort: "Haselrath" },
  { strasse: "Am Sportplatz 9", plz: "91403", ort: "Kranichsee" },
  { strasse: "Schulstraße 33", plz: "91247", ort: "Fuchsbühl" },
  { strasse: "Bergweg 58", plz: "91426", ort: "Adlertal" },
  { strasse: "Wiesengrund 21", plz: "91435", ort: "Silberforst" },
  { strasse: "Im Erlenbruch 6", plz: "91259", ort: "Dornhagen" },
  { strasse: "Zum Alten Bahnhof 14", plz: "91441", ort: "Lindenkirch" },
  { strasse: "Fichtenweg 70", plz: "91458", ort: "Rabenhorst" },
  { strasse: "Ulmenweg 2", plz: "91463", ort: "Ulmenried" },
];

const LONGCHENG_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { flat: "Flat A, 12/F", estate: "Lung Wah Estate, Block 3", district: "Lung Shing East" },
  { flat: "Flat 5B, 23/F", estate: "Harbour Jade Court", district: "Harbourpoint" },
  { flat: "Flat C, 7/F", estate: "Dragon Gate Gardens, Tower 2", district: "Lung Shing West" },
  { flat: "Flat 18D, 31/F", estate: "Golden Carp Court", district: "North Reef" },
  { flat: "Flat F, 4/F", estate: "Pearl Vista", district: "Coral Bay North" },
  { flat: "Flat 9G, 15/F", estate: "Lucky Dragon Court", district: "Tideflat" },
  { flat: "Flat B, 28/F", estate: "Jade Phoenix Terrace", district: "Lung Shing East" },
  { flat: "Flat 3E, 9/F", estate: "Grand Koi Mansion", district: "Harbourpoint" },
  { flat: "Flat 21H, 35/F", estate: "Silver Scale House", district: "North Reef" },
  { flat: "Flat D, 11/F", estate: "Sunrise Pavilion Estate, Block 8", district: "Lung Shing West" },
  { flat: "Flat 16C, 19/F", estate: "Cloud Gate Towers", district: "Coral Bay North" },
  { flat: "Flat 2A, 6/F", estate: "Jade Bridge Court", district: "Tideflat" },
  { flat: "Flat 30F, 40/F", estate: "Harmony Reef Garden", district: "Harbourpoint" },
  { flat: "Flat J, 17/F", estate: "Prosper Pearl Tower", district: "Lung Shing East" },
];

const CORALIA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNo: "14", streetName: "Banksia Street", suburb: "Coral Cove", state: "CQL", postcode: "4820" },
  { streetNo: "27", streetName: "Banyan Parade", suburb: "Banyan Bay", state: "CQL", postcode: "4822" },
  { streetNo: "3", streetName: "Pelican Close", suburb: "Pelican Point", state: "SCR", postcode: "4705" },
  { streetNo: "102", streetName: "Saltgrass Road", suburb: "Saltgrass", state: "SCR", postcode: "4711" },
  { streetNo: "8", streetName: "Wattlebrae Circuit", suburb: "Wattlebrae", state: "CQL", postcode: "4833" },
  { streetNo: "55", streetName: "Ironbark Drive", suburb: "Ironbark Flats", state: "SCR", postcode: "4718" },
  { streetNo: "21", streetName: "Cassowary Court", suburb: "Cassowary Creek", state: "CQL", postcode: "4841" },
  { streetNo: "67", streetName: "Brumby Lane", suburb: "Brumby Plains", state: "SCR", postcode: "4724" },
  { streetNo: "9", streetName: "Quandong Rise", suburb: "Quandong Rise", state: "CQL", postcode: "4850" },
  { streetNo: "38", streetName: "Gullwing Terrace", suburb: "Gullwing", state: "SCR", postcode: "4730" },
  { streetNo: "120", streetName: "Marlinspike Road", suburb: "Marlinspike", state: "CQL", postcode: "4855" },
  { streetNo: "6", streetName: "Sandalwood Street", suburb: "Sandalwood Downs", state: "SCR", postcode: "4736" },
  { streetNo: "44", streetName: "Coral Trout Avenue", suburb: "Coral Cove", state: "CQL", postcode: "4821" },
  { streetNo: "17", streetName: "Driftwood Way", suburb: "Banyan Bay", state: "CQL", postcode: "4823" },
];

const NORTHLAND_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNo: "142", streetName: "Spruce Hollow Road", city: "Northpine", province: "NP", postalCode: "N4P 2K1" },
  { streetNo: "28", streetName: "Borealis Crescent", city: "Borealis Falls", province: "NP", postalCode: "N7B 3T9" },
  { streetNo: "7", streetName: "Timberline Drive", city: "Timberline", province: "BO", postalCode: "B2L 8R4" },
  { streetNo: "903", streetName: "Frost Lake Road", city: "Frost Lake", province: "BO", postalCode: "B9F 1C6" },
  { streetNo: "36", streetName: "Caribou Trail", city: "Caribou Crossing", province: "NP", postalCode: "N1X 5W7" },
  { streetNo: "511", streetName: "Aspen Grove Lane", city: "Aspen Grove", province: "NP", postalCode: "N6A 9H3" },
  { streetNo: "19", streetName: "Tamarack Court", city: "Tamarack", province: "BO", postalCode: "B4T 6P2" },
  { streetNo: "84", streetName: "Larchmont Boulevard", city: "Northpine", province: "NP", postalCode: "N4P 7M5" },
  { streetNo: "250", streetName: "Snowdrift Avenue", city: "Frost Lake", province: "BO", postalCode: "B9F 4J8" },
  { streetNo: "12", streetName: "Pinemarten Way", city: "Spruce Hollow", province: "NP", postalCode: "N2S 3V6" },
  { streetNo: "68", streetName: "Glacier View Road", city: "Borealis Falls", province: "NP", postalCode: "N7B 8K2" },
  { streetNo: "405", streetName: "Iron Creek Road", city: "Timberline", province: "BO", postalCode: "B2L 2D9" },
  { streetNo: "31", streetName: "Wolverine Lane", city: "Caribou Crossing", province: "NP", postalCode: "N1X 6Y4" },
  { streetNo: "177", streetName: "Hemlock Street", city: "Spruce Hollow", province: "NP", postalCode: "N2S 7A1" },
];

const EQUATORIA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { blockStreet: "Blk 128 Equator Avenue", unitNo: "#12-34", postalCode: "560128" },
  { blockStreet: "Blk 45 Meridian Walk", unitNo: "#03-08", postalCode: "541045" },
  { blockStreet: "Blk 302 Lagoon Drive", unitNo: "#21-17", postalCode: "572302" },
  { blockStreet: "Blk 7 Monsoon Rise", unitNo: "#08-52", postalCode: "530007" },
  { blockStreet: "Blk 219 Frangipani Road", unitNo: "#14-09", postalCode: "554219" },
  { blockStreet: "Blk 66 Coral Palm Street", unitNo: "#05-21", postalCode: "547066" },
  { blockStreet: "Blk 410 Heliconia Grove", unitNo: "#17-33", postalCode: "568410" },
  { blockStreet: "Blk 91 Rain Tree Lane", unitNo: "#02-14", postalCode: "535091" },
  { blockStreet: "Blk 158 Trade Winds Close", unitNo: "#11-27", postalCode: "562158" },
  { blockStreet: "Blk 23 Coconut Grove", unitNo: "#09-41", postalCode: "538023" },
  { blockStreet: "Blk 374 Typhoon Terrace", unitNo: "#16-05", postalCode: "575374" },
  { blockStreet: "Blk 50 Orchid Vale", unitNo: "#07-19", postalCode: "544050" },
  { blockStreet: "Blk 206 Doldrums Road", unitNo: "#04-36", postalCode: "551206" },
  { blockStreet: "Blk 83 Temasek Green", unitNo: "#19-12", postalCode: "557083" },
];

const WENLOCK_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNo: "12", streetName: "Mill Lane", city: "Wenlock", postcode: "WN4 2QA" },
  { streetNo: "3", streetName: "Abbey Close", city: "Wealdminster", postcode: "WM1 8TR" },
  { streetNo: "27", streetName: "Foxglove Row", city: "Foxglove", postcode: "FX6 3LN" },
  { streetNo: "48", streetName: "Thistle Down", city: "Thistledown", postcode: "TD9 1PB" },
  { streetNo: "9", streetName: "Nether Combe Road", city: "Nether Combe", postcode: "NC2 7WD" },
  { streetNo: "35", streetName: "Ashwick Lane", city: "Ashwick", postcode: "AW5 4KM" },
  { streetNo: "61", streetName: "Brindleford Way", city: "Brindleford", postcode: "BF8 0QJ" },
  { streetNo: "15", streetName: "Corvale Gardens", city: "Corvale", postcode: "CV3 9HS" },
  { streetNo: "22", streetName: "Dunhollow Rise", city: "Dunhollow", postcode: "DN7 5FK" },
  { streetNo: "6", streetName: "Kettsby Field", city: "Kettsby", postcode: "KB1 6LP" },
  { streetNo: "40", streetName: "Marleditch Road", city: "Marleditch", postcode: "MD4 3RN" },
  { streetNo: "18", streetName: "Owlswick Lane", city: "Owlswick", postcode: "OW9 2TG" },
  { streetNo: "53", streetName: "Priory Mead", city: "Wenlock", postcode: "WN2 8BD" },
  { streetNo: "31", streetName: "Gavelacre Hill", city: "Wealdminster", postcode: "WM5 7JC" },
];

export const ADDRESS_BOOKS: ReadonlyArray<AddressBook> = [
  { regionId: "nordhavn", entries: NORDHAVN_ENTRIES },
  { regionId: "caldera", entries: CALDERA_ENTRIES },
  { regionId: "veridia", entries: VERIDIA_ENTRIES },
  { regionId: "castellan", entries: CASTELLAN_ENTRIES },
  { regionId: "waldland", entries: WALDLAND_ENTRIES },
  { regionId: "longcheng", entries: LONGCHENG_ENTRIES },
  { regionId: "coralia", entries: CORALIA_ENTRIES },
  { regionId: "northland", entries: NORTHLAND_ENTRIES },
  { regionId: "equatoria", entries: EQUATORIA_ENTRIES },
  { regionId: "wenlock", entries: WENLOCK_ENTRIES },
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
