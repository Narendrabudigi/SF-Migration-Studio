// ═══════════════════════════════════════════════════════
// LOOK-UP DICTIONARIES & TRANSFORMS
// Ported from original sap-migration-studio-v3.html
// ═══════════════════════════════════════════════════════

export const COUNTRY_MAP: Record<string, string> = {
  'INDIA':'IN','UNITED STATES':'US','USA':'US','UNITED KINGDOM':'GB','UK':'GB',
  'GERMANY':'DE','FRANCE':'FR','AUSTRALIA':'AU','CANADA':'CA','JAPAN':'JP',
  'CHINA':'CN','SINGAPORE':'SG','UAE':'AE','UNITED ARAB EMIRATES':'AE',
  'NETHERLANDS':'NL','SWEDEN':'SE','SWITZERLAND':'CH','ITALY':'IT',
  'SPAIN':'ES','BRAZIL':'BR','SOUTH KOREA':'KR',
};

export const CURR_MAP: Record<string, string> = {
  'INDIAN RUPEE':'INR','RUPEE':'INR','RUPEES':'INR','RS':'INR',
  'US DOLLAR':'USD','DOLLAR':'USD','EUROS':'EUR','EURO':'EUR',
  'POUND':'GBP','STERLING':'GBP','YEN':'JPY','YUAN':'CNY','RMB':'CNY',
  'DIRHAM':'AED','RIYAL':'SAR','FRANC':'CHF','AUS DOLLAR':'AUD','CANADIAN DOLLAR':'CAD',
};

export const ZTERM_MAP: Record<string, string> = {
  'NET30':'NT30','NET 30':'NT30','30 DAYS':'NT30','30DAYS':'NT30',
  'NET45':'NT45','NET 45':'NT45','45 DAYS':'NT45',
  'NET60':'NT60','NET 60':'NT60','60 DAYS':'NT60',
  'NET15':'NT15','NET7':'NT07','IMMEDIATE':'NT00','CASH':'NT00',
  'COD':'NT00','DUE ON RECEIPT':'NT00','2/10 NET30':'2001',
};

export const MTART_MAP: Record<string, string> = {
  'RAW MATERIAL':'ROH','RAW':'ROH','RM':'ROH',
  'SEMI-FINISHED':'HALB','SEMI FINISHED':'HALB','WIP':'HALB',
  'FINISHED GOODS':'FERT','FINISHED':'FERT','FG':'FERT',
  'TRADING GOODS':'HAWA','TRADING':'HAWA',
  'SERVICE':'DIEN','OPERATING SUPPLIES':'HIBE','CONSUMABLE':'HIBE','HIBE':'HIBE',
};

export interface TransformDef {
  label: string;
  fn: (v: unknown) => string;
}

export const TRANSFORMS: Record<string, TransformDef> = {
  none: { label: 'None', fn: (v) => String(v) },
  trim: { label: 'Trim', fn: (v) => String(v).trim() },
  upper: { label: 'UPPER', fn: (v) => String(v).toUpperCase() },
  pad10: { label: 'Pad→10 digits', fn: (v) => String(v).replace(/\D/g, '').padStart(10, '0') },
  country: {
    label: 'Country→ISO',
    fn: (v) => COUNTRY_MAP[String(v).trim().toUpperCase()] || String(v).slice(0, 3).toUpperCase(),
  },
  currency: {
    label: 'Currency→ISO',
    fn: (v) => CURR_MAP[String(v).trim().toUpperCase()] || String(v).slice(0, 3).toUpperCase(),
  },
  payterm: {
    label: 'PayTerms→SAP',
    fn: (v) => ZTERM_MAP[String(v).trim().toUpperCase()] || String(v).toUpperCase(),
  },
  mattype: {
    label: 'MatType→SAP',
    fn: (v) => MTART_MAP[String(v).trim().toUpperCase()] || String(v).slice(0, 4).toUpperCase(),
  },
  date8: {
    label: 'Date→YYYYMMDD',
    fn: (v) => {
      const s = String(v);
      let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (m) return `${m[3]}${m[2].padStart(2, '0')}${m[1].padStart(2, '0')}`;
      m = s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/);
      if (m) return `${m[1]}${m[2]}${m[3]}`;
      return s.replace(/\D/g, '').slice(0, 8);
    },
  },
  phone: { label: 'Phone clean', fn: (v) => String(v).replace(/[^\d+\-\s()]/g, '').trim() },
  trunc35: { label: 'Truncate 35', fn: (v) => String(v).slice(0, 35) },
};
