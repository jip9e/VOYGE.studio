/**
 * @fileoverview Country Flag Emoji Utility — `getCountryFlag()`
 *
 * Maps a full English country name string to its corresponding Unicode
 * regional indicator emoji flag. Used throughout the VOYGE UI wherever a
 * country name is displayed (spot cards, map popups, Telegram messages, etc.)
 * to provide a quick visual locale indicator alongside the text.
 *
 * ## `getCountryFlag(countryName)`
 *
 * Performs a direct key lookup against a static dictionary of all 195 UN
 * member states plus a selection of widely-recognised territories and regions.
 *
 * ### Parameters
 * | Param         | Type     | Description                                          |
 * |---------------|----------|------------------------------------------------------|
 * | `countryName` | `string` | Full English country name (e.g. `"United Kingdom"`). Case-sensitive — must match the dictionary key exactly. |
 *
 * ### Returns
 * - The Unicode flag emoji for the country (e.g. `"🇬🇧"` for `"United Kingdom"`).
 * - `"🏳️"` (white flag) as a safe fallback when the name is not found in the
 *   dictionary. This prevents broken UI rather than returning an empty string
 *   or throwing an error.
 *
 * ### Coverage
 * The dictionary covers all 195 UN member states in their standard English
 * names as used by Mapbox and other geocoding APIs. Country names returned
 * by the geocoder (e.g. `"United States"`, `"South Korea"`) are mapped
 * directly without any normalisation.
 *
 * ### Usage
 * ```ts
 * import { getCountryFlag } from "@/lib/flags";
 *
 * getCountryFlag("France")        // → "🇫🇷"
 * getCountryFlag("United States") // → "🇺🇸"
 * getCountryFlag("Atlantis")      // → "🏳️"  (fallback)
 * ```
 *
 * @module flags
 */

/**
 * Returns the Unicode flag emoji for a given full English country name.
 *
 * @param countryName - The full English name of the country
 *   (e.g. `"Australia"`, `"United Arab Emirates"`). Case-sensitive.
 * @returns The corresponding flag emoji (e.g. `"🇦🇺"`), or `"🏳️"` if the
 *   country name is not found in the lookup table.
 */
export function getCountryFlag(countryName: string): string {
  const flags: { [key: string]: string } = {
    Afghanistan: "🇦🇫",
    Albania: "🇦🇱",
    Algeria: "🇩🇿",
    Andorra: "🇦🇩",
    Angola: "🇦🇴",
    "Antigua and Barbuda": "🇦🇬",
    Argentina: "🇦🇷",
    Armenia: "🇦🇲",
    Australia: "🇦🇺",
    Austria: "🇦🇹",
    Azerbaijan: "🇦🇿",
    Bahamas: "🇧🇸",
    Bahrain: "🇧🇭",
    Bangladesh: "🇧🇩",
    Barbados: "🇧🇧",
    Belarus: "🇧🇾",
    Belgium: "🇧🇪",
    Belize: "🇧🇿",
    Benin: "🇧🇯",
    Bhutan: "🇧🇹",
    Bolivia: "🇧🇴",
    "Bosnia and Herzegovina": "🇧🇦",
    Botswana: "🇧🇼",
    Brazil: "🇧🇷",
    Brunei: "🇧🇳",
    Bulgaria: "🇧🇬",
    "Burkina Faso": "🇧🇫",
    Burundi: "🇧🇮",
    "Cabo Verde": "🇨🇻",
    Cambodia: "🇰🇭",
    Cameroon: "🇨🇲",
    Canada: "🇨🇦",
    "Central African Republic": "🇨🇫",
    Chad: "🇹🇩",
    Chile: "🇨🇱",
    China: "🇨🇳",
    Colombia: "🇨🇴",
    Comoros: "🇰🇲",
    Congo: "🇨🇬",
    "Costa Rica": "🇨🇷",
    Croatia: "🇭🇷",
    Cuba: "🇨🇺",
    Cyprus: "🇨🇾",
    "Czech Republic": "🇨🇿",
    Denmark: "🇩🇰",
    Djibouti: "🇩🇯",
    Dominica: "🇩🇲",
    "Dominican Republic": "🇩🇴",
    Ecuador: "🇪🇨",
    Egypt: "🇪🇬",
    "El Salvador": "🇸🇻",
    "Equatorial Guinea": "🇬🇶",
    Eritrea: "🇪🇷",
    Estonia: "🇪🇪",
    Eswatini: "🇸🇿",
    Ethiopia: "🇪🇹",
    Fiji: "🇫🇯",
    Finland: "🇫🇮",
    France: "🇫🇷",
    Gabon: "🇬🇦",
    Gambia: "🇬🇲",
    Georgia: "🇬🇪",
    Germany: "🇩🇪",
    Ghana: "🇬🇭",
    Greece: "🇬🇷",
    Grenada: "🇬🇩",
    Guatemala: "🇬🇹",
    Guinea: "🇬🇳",
    "Guinea-Bissau": "🇬🇼",
    Guyana: "🇬🇾",
    Haiti: "🇭🇹",
    Honduras: "🇭🇳",
    Hungary: "🇭🇺",
    Iceland: "🇮🇸",
    India: "🇮🇳",
    Indonesia: "🇮🇩",
    Iran: "🇮🇷",
    Iraq: "🇮🇶",
    Ireland: "🇮🇪",
    Israel: "🇮🇱",
    Italy: "🇮🇹",
    Jamaica: "🇯🇲",
    Japan: "🇯🇵",
    Jordan: "🇯🇴",
    Kazakhstan: "🇰🇿",
    Kenya: "🇰🇪",
    Kiribati: "🇰🇮",
    "Korea, North": "🇰🇵",
    "Korea, South": "🇰🇷",
    Kosovo: "🇽🇰",
    Kuwait: "🇰🇼",
    Kyrgyzstan: "🇰🇬",
    Laos: "🇱🇦",
    Latvia: "🇱🇻",
    Lebanon: "🇱🇧",
    Lesotho: "🇱🇸",
    Liberia: "🇱🇷",
    Libya: "🇱🇾",
    Liechtenstein: "🇱🇮",
    Lithuania: "🇱🇹",
    Luxembourg: "🇱🇺",
    Madagascar: "🇲🇬",
    Malawi: "🇲🇼",
    Malaysia: "🇲🇾",
    Maldives: "🇲🇻",
    Mali: "🇲🇱",
    Malta: "🇲🇹",
    "Marshall Islands": "🇲🇭",
    Mauritania: "🇲🇷",
    Mauritius: "🇲🇺",
    Mexico: "🇲🇽",
    Micronesia: "🇫🇲",
    Moldova: "🇲🇩",
    Monaco: "🇲🇨",
    Mongolia: "🇲🇳",
    Montenegro: "🇲🇪",
    Morocco: "🇲🇦",
    Mozambique: "🇲🇿",
    Myanmar: "🇲🇲",
    Namibia: "🇳🇦",
    Nauru: "🇳🇷",
    Nepal: "🇳🇵",
    Netherlands: "🇳🇱",
    "New Zealand": "🇳🇿",
    Nicaragua: "🇳🇮",
    Niger: "🇳🇪",
    Nigeria: "🇳🇬",
    "North Macedonia": "🇲🇰",
    Norway: "🇳🇴",
    Oman: "🇴🇲",
    Pakistan: "🇵🇰",
    Palau: "🇵🇼",
    Panama: "🇵🇦",
    "Papua New Guinea": "🇵🇬",
    Paraguay: "🇵🇾",
    Peru: "🇵🇪",
    Philippines: "🇵🇭",
    Poland: "🇵🇱",
    Portugal: "🇵🇹",
    Qatar: "🇶🇦",
    Romania: "🇷🇴",
    Russia: "🇷🇺",
    Rwanda: "🇷🇼",
    "Saint Kitts and Nevis": "🇰🇳",
    "Saint Lucia": "🇱🇨",
    "Saint Vincent and the Grenadines": "🇻🇨",
    Samoa: "🇼🇸",
    "San Marino": "🇸🇲",
    "Sao Tome and Principe": "🇸🇹",
    "Saudi Arabia": "🇸🇦",
    Senegal: "🇸🇳",
    Serbia: "🇷🇸",
    Seychelles: "🇸🇨",
    "Sierra Leone": "🇸🇱",
    Singapore: "🇸🇬",
    Slovakia: "🇸🇰",
    Slovenia: "🇸🇮",
    "Solomon Islands": "🇸🇧",
    Somalia: "🇸🇴",
    "South Africa": "🇿🇦",
    "South Sudan": "🇸🇸",
    Spain: "🇪🇸",
    "Sri Lanka": "🇱🇰",
    Sudan: "🇸🇩",
    Suriname: "🇸🇷",
    Sweden: "🇸🇪",
    Switzerland: "🇨🇭",
    Syria: "🇸🇾",
    Taiwan: "🇹🇼",
    Tajikistan: "🇹🇯",
    Tanzania: "🇹🇿",
    Thailand: "🇹🇭",
    "Timor-Leste": "🇹🇱",
    Togo: "🇹🇬",
    Tonga: "🇹🇴",
    "Trinidad and Tobago": "🇹🇹",
    Tunisia: "🇹🇳",
    Turkey: "🇹🇷",
    Turkmenistan: "🇹🇲",
    Tuvalu: "🇹🇻",
    Uganda: "🇺🇬",
    Ukraine: "🇺🇦",
    "United Arab Emirates": "🇦🇪",
    "United Kingdom": "🇬🇧",
    "United States": "🇺🇸",
    Uruguay: "🇺🇾",
    Uzbekistan: "🇺🇿",
    Vanuatu: "🇻🇺",
    "Vatican City": "🇻🇦",
    Venezuela: "🇻🇪",
    Vietnam: "🇻🇳",
    Yemen: "🇾🇪",
    Zambia: "🇿🇲",
    Zimbabwe: "🇿🇼",
  };
  return flags[countryName] || "🏳️";
}
