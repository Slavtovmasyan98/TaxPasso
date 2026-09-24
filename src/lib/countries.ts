// Коды стран ISO 3166-1 alpha-2. Названия берутся из браузера (Intl.DisplayNames)
// на языке интерфейса, поэтому отдельный словарь переводов не нужен.
const CODES = (
  "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW " +
  "BV BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ " +
  "DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP " +
  "GU GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR " +
  "KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS " +
  "MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR " +
  "QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES " +
  "LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU " +
  "VE VN VG VI WF EH YE ZM ZW XK"
).split(" ");

// Страны, которые показываем первыми (основная аудитория).
const PRIORITY = ["AM", "GE", "KZ", "UZ", "KG", "UA", "AZ", "MD", "TR", "AE"];

export type Country = { code: string; name: string };

export function countryList(lang: string): Country[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([lang === "en" ? "en" : "ru"], { type: "region" });
  } catch {
    names = null;
  }
  const toCountry = (code: string) => ({ code, name: names?.of(code) || code });
  const collator = new Intl.Collator(lang === "en" ? "en" : "ru");
  const rest = CODES.filter((c) => !PRIORITY.includes(c))
    .map(toCountry)
    .sort((a, b) => collator.compare(a.name, b.name));
  return [...PRIORITY.map(toCountry), ...rest];
}

export function countryName(code: string, lang: string) {
  try {
    return (
      new Intl.DisplayNames([lang === "en" ? "en" : "ru"], { type: "region" }).of(code) || code
    );
  } catch {
    return code;
  }
}
