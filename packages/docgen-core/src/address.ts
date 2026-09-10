/**
 * 真实地区地址样本库：每个地区 ≥12 条，用于表单「随机填充」。
 * 地名真实存在，但门牌组合为示例性质，不指向真实住户。
 * address Record 的键与该region模板的 fields[].key 一一对应。
 */

import type { RegionId } from "./model";

export interface AddressBook {
  readonly regionId: RegionId;
  readonly entries: ReadonlyArray<Record<string, string>>;
}

/** 澳大利亚：streetNo / streetName / suburb / state（2–3 字母）/ postcode（4 位） */
const AUSTRALIA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNo: "14", streetName: "Banksia Street", suburb: "Bondi", state: "NSW", postcode: "2026" },
  {
    streetNo: "27",
    streetName: "Chapel Street",
    suburb: "South Yarra",
    state: "VIC",
    postcode: "3141",
  },
  {
    streetNo: "3",
    streetName: "Brunswick Street",
    suburb: "Fortitude Valley",
    state: "QLD",
    postcode: "4006",
  },
  {
    streetNo: "102",
    streetName: "Rundle Street",
    suburb: "Kent Town",
    state: "SA",
    postcode: "5067",
  },
  {
    streetNo: "8",
    streetName: "St Georges Terrace",
    suburb: "Perth",
    state: "WA",
    postcode: "6000",
  },
  {
    streetNo: "55",
    streetName: "Sandy Bay Road",
    suburb: "Sandy Bay",
    state: "TAS",
    postcode: "7005",
  },
  {
    streetNo: "21",
    streetName: "Darling Street",
    suburb: "Balmain",
    state: "NSW",
    postcode: "2041",
  },
  { streetNo: "67", streetName: "Lygon Street", suburb: "Carlton", state: "VIC", postcode: "3053" },
  { streetNo: "9", streetName: "James Street", suburb: "New Farm", state: "QLD", postcode: "4005" },
  { streetNo: "38", streetName: "The Parade", suburb: "Norwood", state: "SA", postcode: "5067" },
  {
    streetNo: "120",
    streetName: "Oxford Street",
    suburb: "Leederville",
    state: "WA",
    postcode: "6007",
  },
  {
    streetNo: "6",
    streetName: "Elizabeth Street",
    suburb: "Hobart",
    state: "TAS",
    postcode: "7000",
  },
  {
    streetNo: "44",
    streetName: "Crown Street",
    suburb: "Surry Hills",
    state: "NSW",
    postcode: "2010",
  },
  {
    streetNo: "17",
    streetName: "Toorak Road",
    suburb: "South Yarra",
    state: "VIC",
    postcode: "3141",
  },
];

/** 加拿大：streetNo / streetName / city / province（2 字母）/ postalCode（A1A 1A1） */
const CANADA_ENTRIES: ReadonlyArray<Record<string, string>> = [
  {
    streetNo: "142",
    streetName: "Granville Street",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6B 1P1",
  },
  {
    streetNo: "28",
    streetName: "Whyte Avenue",
    city: "Edmonton",
    province: "AB",
    postalCode: "T6E 1Z2",
  },
  {
    streetNo: "7",
    streetName: "Yonge Street",
    city: "Toronto",
    province: "ON",
    postalCode: "M5C 1W7",
  },
  {
    streetNo: "903",
    streetName: "Robson Street",
    city: "Vancouver",
    province: "BC",
    postalCode: "V6Z 2E7",
  },
  {
    streetNo: "36",
    streetName: "17 Avenue SW",
    city: "Calgary",
    province: "AB",
    postalCode: "T2S 0A1",
  },
  {
    streetNo: "511",
    streetName: "Queen Street West",
    city: "Toronto",
    province: "ON",
    postalCode: "M5V 2B7",
  },
  {
    streetNo: "19",
    streetName: "Saint-Laurent Boulevard",
    city: "Montreal",
    province: "QC",
    postalCode: "H2X 2S8",
  },
  {
    streetNo: "84",
    streetName: "Spring Garden Road",
    city: "Halifax",
    province: "NS",
    postalCode: "B3J 1G6",
  },
  {
    streetNo: "250",
    streetName: "Portage Avenue",
    city: "Winnipeg",
    province: "MB",
    postalCode: "R3C 0B1",
  },
  {
    streetNo: "12",
    streetName: "Bank Street",
    city: "Ottawa",
    province: "ON",
    postalCode: "K1P 5N2",
  },
  {
    streetNo: "68",
    streetName: "Water Street",
    city: "St. John's",
    province: "NL",
    postalCode: "A1C 1A9",
  },
  {
    streetNo: "405",
    streetName: "Broadway",
    city: "Saskatoon",
    province: "SK",
    postalCode: "S7N 1B5",
  },
  {
    streetNo: "31",
    streetName: "Government Street",
    city: "Victoria",
    province: "BC",
    postalCode: "V8W 1W5",
  },
  {
    streetNo: "177",
    streetName: "Jasper Avenue",
    city: "Edmonton",
    province: "AB",
    postalCode: "T5J 1W8",
  },
];

/** 香港：flat / estate / district（双语账单，英文地址） */
const HONGKONG_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { flat: "Flat A, 12/F", estate: "Mei Foo Sun Chuen, Block 3", district: "Kowloon" },
  {
    flat: "Flat 5B, 23/F",
    estate: "Taikoo Shing, Harbour View Gardens",
    district: "Hong Kong Island",
  },
  { flat: "Flat C, 7/F", estate: "City One Shatin, Block 12", district: "New Territories" },
  { flat: "Flat 18D, 31/F", estate: "Whampoa Garden, Site 9", district: "Kowloon" },
  { flat: "Flat F, 4/F", estate: "Laguna City, Phase 2", district: "Kowloon" },
  { flat: "Flat 9G, 15/F", estate: "Kornhill Garden, Block H", district: "Hong Kong Island" },
  { flat: "Flat B, 28/F", estate: "Tseung Kwan O Plaza, Tower 1", district: "New Territories" },
  { flat: "Flat 3E, 9/F", estate: "South Horizons, Block 21", district: "Hong Kong Island" },
  { flat: "Flat D, 11/F", estate: "Festival City, Tower 5", district: "New Territories" },
  { flat: "Flat 21H, 35/F", estate: "Park Central, Tower 3", district: "New Territories" },
  { flat: "Flat 16C, 19/F", estate: "Amoy Gardens, Block K", district: "Kowloon" },
  { flat: "Flat 2A, 6/F", estate: "Kennedy Town Centre, Block 2", district: "Hong Kong Island" },
  { flat: "Flat 30F, 40/F", estate: "Metro Harbour View, Tower 8", district: "Kowloon" },
  {
    flat: "Flat J, 17/F",
    estate: "Kingswood Villas, Lynwood Block 4",
    district: "New Territories",
  },
];

/** 新加坡：blockStreet / unitNo（#NN-NN）/ postalCode（6 位） */
const SINGAPORE_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { blockStreet: "Blk 128 Bishan Street 12", unitNo: "#12-34", postalCode: "570128" },
  { blockStreet: "Blk 45 Tampines Street 81", unitNo: "#03-08", postalCode: "528457" },
  { blockStreet: "Blk 302 Jurong East Street 32", unitNo: "#21-17", postalCode: "600302" },
  { blockStreet: "Blk 7 Ang Mo Kio Avenue 3", unitNo: "#08-52", postalCode: "560007" },
  { blockStreet: "Blk 219 Bedok Central", unitNo: "#14-09", postalCode: "460219" },
  { blockStreet: "Blk 66 Woodlands Drive 16", unitNo: "#05-21", postalCode: "730537" },
  { blockStreet: "Blk 410 Clementi Avenue 1", unitNo: "#17-33", postalCode: "120410" },
  { blockStreet: "Blk 91 Hougang Avenue 8", unitNo: "#02-14", postalCode: "530091" },
  { blockStreet: "Blk 158 Yishun Street 11", unitNo: "#11-27", postalCode: "760158" },
  { blockStreet: "Blk 23 Toa Payoh East", unitNo: "#09-41", postalCode: "310023" },
  { blockStreet: "Blk 374 Bukit Batok Street 31", unitNo: "#16-05", postalCode: "650374" },
  { blockStreet: "Blk 50 Serangoon North Avenue 4", unitNo: "#07-19", postalCode: "550050" },
  { blockStreet: "Blk 206 Punggol Field", unitNo: "#04-36", postalCode: "820206" },
  { blockStreet: "Blk 83 Pasir Ris Drive 4", unitNo: "#19-12", postalCode: "510083" },
];

/** 英国：streetNo / streetName / city / postcode（英制） */
const UK_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { streetNo: "12", streetName: "Mill Lane", city: "London", postcode: "SW1A 1AA" },
  { streetNo: "3", streetName: "Abbey Close", city: "Oxford", postcode: "OX1 2JD" },
  { streetNo: "27", streetName: "Foxglove Row", city: "Manchester", postcode: "M1 1AE" },
  { streetNo: "48", streetName: "Thistle Down", city: "Edinburgh", postcode: "EH1 1YZ" },
  { streetNo: "9", streetName: "Nether Combe Road", city: "Bristol", postcode: "BS1 4ST" },
  { streetNo: "35", streetName: "Ashwick Lane", city: "Cambridge", postcode: "CB2 1TN" },
  { streetNo: "61", streetName: "Brindleford Way", city: "Leeds", postcode: "LS1 4DY" },
  { streetNo: "15", streetName: "Corvale Gardens", city: "Birmingham", postcode: "B4 6AT" },
  { streetNo: "22", streetName: "Dunhollow Rise", city: "Liverpool", postcode: "L3 4AE" },
  { streetNo: "6", streetName: "Kettsby Field", city: "Cardiff", postcode: "CF10 1EP" },
  { streetNo: "40", streetName: "Marleditch Road", city: "Glasgow", postcode: "G2 1DU" },
  { streetNo: "18", streetName: "Owlswick Lane", city: "Bath", postcode: "BA1 1LT" },
  { streetNo: "53", streetName: "Priory Mead", city: "York", postcode: "YO1 7HH" },
  { streetNo: "31", streetName: "Gavelacre Hill", city: "Brighton", postcode: "BN1 4GG" },
];

/** 德国：strasse / plz（5 位）/ ort */
const GERMANY_ENTRIES: ReadonlyArray<Record<string, string>> = [
  { strasse: "Hauptstraße 12", plz: "10115", ort: "Berlin" },
  { strasse: "Marienplatz 7", plz: "80331", ort: "München" },
  { strasse: "Mönckebergstraße 23", plz: "20095", ort: "Hamburg" },
  { strasse: "Schildergasse 4", plz: "50667", ort: "Köln" },
  { strasse: "Kaiserstraße 81", plz: "60329", ort: "Frankfurt am Main" },
  { strasse: "Königstraße 16", plz: "70173", ort: "Stuttgart" },
  { strasse: "Schadowstraße 102", plz: "40212", ort: "Düsseldorf" },
  { strasse: "Petersstraße 9", plz: "04109", ort: "Leipzig" },
  { strasse: "Am Schloss 33", plz: "76131", ort: "Karlsruhe" },
  { strasse: "Bergmannstraße 58", plz: "10961", ort: "Berlin" },
  { strasse: "Wiesenweg 21", plz: "01067", ort: "Dresden" },
  { strasse: "Lister Meile 6", plz: "30161", ort: "Hannover" },
  { strasse: "Kettwiger Straße 14", plz: "45127", ort: "Essen" },
  { strasse: "Ludwigstraße 70", plz: "80539", ort: "München" },
];

export const ADDRESS_BOOKS: ReadonlyArray<AddressBook> = [
  { regionId: "australia", entries: AUSTRALIA_ENTRIES },
  { regionId: "canada", entries: CANADA_ENTRIES },
  { regionId: "hongkong", entries: HONGKONG_ENTRIES },
  { regionId: "singapore", entries: SINGAPORE_ENTRIES },
  { regionId: "uk", entries: UK_ENTRIES },
  { regionId: "germany", entries: GERMANY_ENTRIES },
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
