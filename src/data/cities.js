// City suggestions for the shipping City field (CitySelect.jsx), keyed by
// the same ISO codes as SUPPORTED_SHIPPING_COUNTRIES (src/data/countries.js).
// Each entry is "City|Region" (Armenian marz, Russian federal subject, U.S.
// state). These are suggestions only — customers can still type any city.
//
// Armenia's "Yerevan" must stay spelled exactly that way: server/delivery.mjs
// resolves the Yerevan delivery zone by an exact (case-insensitive) match.
// Adding a country to SUPPORTED_SHIPPING_COUNTRIES means adding its list here.
import { getCountryCode } from './countries.js';

const RAW = {
  AM: [
    'Yerevan|Yerevan',
    'Ashtarak|Aragatsotn', 'Aparan|Aragatsotn', 'Talin|Aragatsotn',
    'Artashat|Ararat', 'Ararat|Ararat', 'Masis|Ararat', 'Vedi|Ararat',
    'Armavir|Armavir', 'Vagharshapat (Etchmiadzin)|Armavir', 'Metsamor|Armavir',
    'Gavar|Gegharkunik', 'Sevan|Gegharkunik', 'Martuni|Gegharkunik', 'Vardenis|Gegharkunik', 'Chambarak|Gegharkunik',
    'Hrazdan|Kotayk', 'Abovyan|Kotayk', 'Charentsavan|Kotayk', 'Byureghavan|Kotayk', 'Tsaghkadzor|Kotayk', 'Yeghvard|Kotayk', 'Nor Hachn|Kotayk',
    'Vanadzor|Lori', 'Alaverdi|Lori', 'Stepanavan|Lori', 'Spitak|Lori', 'Tashir|Lori',
    'Gyumri|Shirak', 'Artik|Shirak', 'Maralik|Shirak',
    'Kapan|Syunik', 'Goris|Syunik', 'Sisian|Syunik', 'Meghri|Syunik', 'Kajaran|Syunik',
    'Ijevan|Tavush', 'Dilijan|Tavush', 'Berd|Tavush', 'Noyemberyan|Tavush',
    'Yeghegnadzor|Vayots Dzor', 'Vayk|Vayots Dzor', 'Jermuk|Vayots Dzor',
  ],
  RU: [
    'Moscow|Moscow', 'Saint Petersburg|Saint Petersburg',
    'Novosibirsk|Novosibirsk Oblast', 'Yekaterinburg|Sverdlovsk Oblast', 'Kazan|Tatarstan',
    'Nizhny Novgorod|Nizhny Novgorod Oblast', 'Chelyabinsk|Chelyabinsk Oblast', 'Krasnoyarsk|Krasnoyarsk Krai',
    'Samara|Samara Oblast', 'Ufa|Bashkortostan', 'Rostov-on-Don|Rostov Oblast', 'Omsk|Omsk Oblast',
    'Krasnodar|Krasnodar Krai', 'Voronezh|Voronezh Oblast', 'Perm|Perm Krai', 'Volgograd|Volgograd Oblast',
    'Saratov|Saratov Oblast', 'Tyumen|Tyumen Oblast', 'Tolyatti|Samara Oblast', 'Izhevsk|Udmurtia',
    'Barnaul|Altai Krai', 'Ulyanovsk|Ulyanovsk Oblast', 'Irkutsk|Irkutsk Oblast', 'Khabarovsk|Khabarovsk Krai',
    'Yaroslavl|Yaroslavl Oblast', 'Vladivostok|Primorsky Krai', 'Makhachkala|Dagestan', 'Tomsk|Tomsk Oblast',
    'Orenburg|Orenburg Oblast', 'Kemerovo|Kemerovo Oblast', 'Novokuznetsk|Kemerovo Oblast', 'Ryazan|Ryazan Oblast',
    'Astrakhan|Astrakhan Oblast', 'Naberezhnye Chelny|Tatarstan', 'Penza|Penza Oblast', 'Kirov|Kirov Oblast',
    'Lipetsk|Lipetsk Oblast', 'Cheboksary|Chuvashia', 'Balashikha|Moscow Oblast', 'Kaliningrad|Kaliningrad Oblast',
    'Tula|Tula Oblast', 'Kursk|Kursk Oblast', 'Stavropol|Stavropol Krai', 'Sochi|Krasnodar Krai',
    'Ulan-Ude|Buryatia', 'Tver|Tver Oblast', 'Magnitogorsk|Chelyabinsk Oblast', 'Ivanovo|Ivanovo Oblast',
    'Bryansk|Bryansk Oblast', 'Belgorod|Belgorod Oblast', 'Surgut|Khanty-Mansi Autonomous Okrug', 'Vladimir|Vladimir Oblast',
    'Arkhangelsk|Arkhangelsk Oblast', 'Chita|Zabaykalsky Krai', 'Kaluga|Kaluga Oblast', 'Smolensk|Smolensk Oblast',
    'Volzhsky|Volgograd Oblast', 'Kurgan|Kurgan Oblast', 'Cherepovets|Vologda Oblast', 'Vologda|Vologda Oblast',
    'Oryol|Oryol Oblast', 'Saransk|Mordovia', 'Vladikavkaz|North Ossetia–Alania', 'Yakutsk|Sakha (Yakutia)',
    'Murmansk|Murmansk Oblast', 'Podolsk|Moscow Oblast', 'Tambov|Tambov Oblast', 'Grozny|Chechnya',
    'Sterlitamak|Bashkortostan', 'Petrozavodsk|Karelia', 'Kostroma|Kostroma Oblast', 'Nizhnevartovsk|Khanty-Mansi Autonomous Okrug',
    'Novorossiysk|Krasnodar Krai', 'Yoshkar-Ola|Mari El', 'Khimki|Moscow Oblast', 'Mytishchi|Moscow Oblast',
    'Korolyov|Moscow Oblast', 'Lyubertsy|Moscow Oblast', 'Taganrog|Rostov Oblast', 'Syktyvkar|Komi',
    'Nalchik|Kabardino-Balkaria', 'Shakhty|Rostov Oblast', 'Dzerzhinsk|Nizhny Novgorod Oblast', 'Pskov|Pskov Oblast',
    'Veliky Novgorod|Novgorod Oblast', 'Pyatigorsk|Stavropol Krai', 'Yuzhno-Sakhalinsk|Sakhalin Oblast',
    'Petropavlovsk-Kamchatsky|Kamchatka Krai', 'Blagoveshchensk|Amur Oblast', 'Abakan|Khakassia', 'Norilsk|Krasnoyarsk Krai',
    'Magadan|Magadan Oblast', 'Maykop|Adygea', 'Cherkessk|Karachay-Cherkessia', 'Elista|Kalmykia',
    'Magas|Ingushetia', 'Kyzyl|Tuva', 'Gorno-Altaysk|Altai Republic', 'Khanty-Mansiysk|Khanty-Mansi Autonomous Okrug',
    'Novy Urengoy|Yamalo-Nenets Autonomous Okrug', 'Salekhard|Yamalo-Nenets Autonomous Okrug', 'Naryan-Mar|Nenets Autonomous Okrug',
    'Birobidzhan|Jewish Autonomous Oblast', 'Anadyr|Chukotka',
  ],
  US: [
    'New York|New York', 'Los Angeles|California', 'Chicago|Illinois', 'Houston|Texas', 'Phoenix|Arizona',
    'Philadelphia|Pennsylvania', 'San Antonio|Texas', 'San Diego|California', 'Dallas|Texas', 'Austin|Texas',
    'San Jose|California', 'San Francisco|California', 'Glendale|California', 'Burbank|California', 'Pasadena|California',
    'Fresno|California', 'Sacramento|California', 'Long Beach|California', 'Oakland|California', 'Bakersfield|California',
    'Anaheim|California', 'Irvine|California', 'Santa Ana|California', 'Riverside|California', 'Santa Monica|California',
    'Brooklyn|New York', 'Queens|New York', 'Buffalo|New York', 'Rochester|New York', 'Yonkers|New York',
    'Syracuse|New York', 'Albany|New York',
    'Fort Worth|Texas', 'El Paso|Texas', 'Arlington|Texas', 'Plano|Texas',
    'Jacksonville|Florida', 'Miami|Florida', 'Tampa|Florida', 'Orlando|Florida', 'St. Petersburg|Florida',
    'Fort Lauderdale|Florida', 'Tallahassee|Florida',
    'Washington|District of Columbia',
    'Boston|Massachusetts', 'Worcester|Massachusetts', 'Cambridge|Massachusetts', 'Watertown|Massachusetts', 'Springfield|Massachusetts',
    'Seattle|Washington', 'Spokane|Washington', 'Tacoma|Washington', 'Olympia|Washington',
    'Denver|Colorado', 'Colorado Springs|Colorado', 'Aurora|Colorado', 'Boulder|Colorado',
    'Las Vegas|Nevada', 'Henderson|Nevada', 'Reno|Nevada', 'Carson City|Nevada',
    'Atlanta|Georgia', 'Savannah|Georgia', 'Augusta|Georgia',
    'Detroit|Michigan', 'Grand Rapids|Michigan', 'Ann Arbor|Michigan', 'Lansing|Michigan',
    'Tucson|Arizona', 'Mesa|Arizona', 'Chandler|Arizona', 'Scottsdale|Arizona', 'Tempe|Arizona',
    'Portland|Oregon', 'Eugene|Oregon', 'Salem|Oregon',
    'Charlotte|North Carolina', 'Raleigh|North Carolina', 'Greensboro|North Carolina', 'Durham|North Carolina',
    'Columbus|Ohio', 'Cleveland|Ohio', 'Cincinnati|Ohio', 'Toledo|Ohio',
    'Indianapolis|Indiana', 'Fort Wayne|Indiana',
    'Nashville|Tennessee', 'Memphis|Tennessee', 'Knoxville|Tennessee', 'Chattanooga|Tennessee',
    'Baltimore|Maryland', 'Annapolis|Maryland',
    'Milwaukee|Wisconsin', 'Madison|Wisconsin',
    'Minneapolis|Minnesota', 'Saint Paul|Minnesota',
    'Kansas City|Missouri', 'St. Louis|Missouri', 'Springfield|Missouri', 'Jefferson City|Missouri',
    'Newark|New Jersey', 'Jersey City|New Jersey', 'Paterson|New Jersey', 'Trenton|New Jersey',
    'Pittsburgh|Pennsylvania', 'Allentown|Pennsylvania', 'Harrisburg|Pennsylvania',
    'Naperville|Illinois', 'Aurora|Illinois', 'Springfield|Illinois',
    'Virginia Beach|Virginia', 'Richmond|Virginia', 'Norfolk|Virginia', 'Arlington|Virginia',
    'New Orleans|Louisiana', 'Baton Rouge|Louisiana', 'Shreveport|Louisiana',
    'Louisville|Kentucky', 'Lexington|Kentucky', 'Frankfort|Kentucky',
    'Oklahoma City|Oklahoma', 'Tulsa|Oklahoma',
    'Albuquerque|New Mexico', 'Santa Fe|New Mexico',
    'Birmingham|Alabama', 'Montgomery|Alabama', 'Huntsville|Alabama', 'Mobile|Alabama',
    'Charleston|South Carolina', 'Columbia|South Carolina',
    'Salt Lake City|Utah', 'Provo|Utah',
    'Omaha|Nebraska', 'Lincoln|Nebraska',
    'Wichita|Kansas', 'Overland Park|Kansas', 'Kansas City|Kansas', 'Topeka|Kansas',
    'Des Moines|Iowa', 'Cedar Rapids|Iowa',
    'Little Rock|Arkansas', 'Fayetteville|Arkansas',
    'Bridgeport|Connecticut', 'New Haven|Connecticut', 'Hartford|Connecticut', 'Stamford|Connecticut',
    'Providence|Rhode Island',
    'Jackson|Mississippi',
    'Honolulu|Hawaii',
    'Anchorage|Alaska', 'Fairbanks|Alaska', 'Juneau|Alaska',
    'Boise|Idaho',
    'Billings|Montana', 'Helena|Montana',
    'Fargo|North Dakota', 'Bismarck|North Dakota',
    'Sioux Falls|South Dakota', 'Pierre|South Dakota',
    'Manchester|New Hampshire', 'Concord|New Hampshire',
    'Portland|Maine', 'Augusta|Maine',
    'Burlington|Vermont', 'Montpelier|Vermont',
    'Wilmington|Delaware', 'Dover|Delaware',
    'Charleston|West Virginia',
    'Cheyenne|Wyoming',
  ],
};

export const CITIES_BY_COUNTRY = Object.fromEntries(
  Object.entries(RAW).map(([code, list]) => [
    code,
    list.map((entry) => {
      const [name, region] = entry.split('|');
      return { name, region };
    }),
  ]),
);

// Accepts an ISO code or a legacy full country name ("Armenia") — older
// saved addresses still store the name.
export function getCities(country) {
  const raw = String(country || '').trim();
  const code = raw.length === 2 ? raw.toUpperCase() : getCountryCode(raw);
  return CITIES_BY_COUNTRY[code] || [];
}
