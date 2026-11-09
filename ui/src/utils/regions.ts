// Region codes identify a location, not the user's nationality or account origin.
const countries: Readonly<Record<string, string>> = {
  'us-': 'US', 'usgov': 'US', 'useast': 'US', 'uswest': 'US', 'eastus': 'US', 'westus': 'US',
  'centralus': 'US', 'northcentralus': 'US', 'southcentralus': 'US', 'westcentralus': 'US',
  'ca-': 'CA', 'canada': 'CA', 'northamerica-northeast': 'CA',
  'mx-': 'MX', 'northamerica-south': 'MX', 'mexico': 'MX',
  'sa-east': 'BR', 'southamerica-east': 'BR', 'brazil': 'BR', 'southamerica-west': 'CL',
  'eu-west-1': 'IE', 'northeurope': 'IE', 'eu-west-2': 'GB', 'europe-west2': 'GB', 'uk': 'GB',
  'eu-west-3': 'FR', 'europe-west9': 'FR', 'france': 'FR',
  'eu-central-1': 'DE', 'europe-west3': 'DE', 'europe-west8': 'IT', 'europe-west12': 'IT',
  'germany': 'DE', 'eu-central-2': 'CH', 'europe-west6': 'CH', 'switzerland': 'CH',
  'eu-north': 'SE', 'europe-north2': 'SE', 'sweden': 'SE', 'europe-north1': 'FI',
  'eu-south-1': 'IT', 'italy': 'IT', 'eu-south-2': 'ES', 'europe-southwest': 'ES', 'spain': 'ES',
  'europe-west1': 'BE', 'europe-west4': 'NL', 'westeurope': 'NL', 'norway': 'NO', 'poland': 'PL', 'europe-central2': 'PL',
  'ap-northeast-1': 'JP', 'ap-northeast-3': 'JP', 'asia-northeast1': 'JP', 'asia-northeast2': 'JP', 'japan': 'JP',
  'ap-northeast-2': 'KR', 'asia-northeast3': 'KR', 'korea': 'KR',
  'ap-south-': 'IN', 'asia-south': 'IN', 'centralindia': 'IN', 'southindia': 'IN', 'westindia': 'IN',
  'ap-southeast-1': 'SG', 'asia-southeast1': 'SG', 'southeastasia': 'SG',
  'ap-southeast-2': 'AU', 'ap-southeast-4': 'AU', 'australia': 'AU',
  'ap-southeast-3': 'ID', 'asia-southeast2': 'ID', 'indonesia': 'ID',
  'ap-southeast-5': 'MY', 'malaysia': 'MY', 'ap-southeast-6': 'NZ', 'newzealand': 'NZ',
  'ap-southeast-7': 'TH', 'thailand': 'TH', 'ap-east-1': 'HK', 'eastasia': 'HK',
  'ap-east-2': 'TW', 'asia-east1': 'TW', 'asia-east2': 'HK',
  'cn-': 'CN', 'china': 'CN', 'af-south': 'ZA', 'southafrica': 'ZA', 'africa-south': 'ZA',
  'me-south': 'BH', 'me-central-1': 'AE', 'uae': 'AE', 'me-central-2': 'SA', 'saudi': 'SA',
  'me-central1': 'QA', 'qatar': 'QA', 'me-central2': 'SA', 'il-': 'IL', 'me-west': 'IL', 'israel': 'IL',
};
const prefixes = Object.keys(countries).sort((a, b) => b.length - a.length);

/** Unknown or multi-country regions have no flag rather than a guessed country. */
export function getRegionFlag(region: string): string {
  const normalized = region.toLowerCase().replace(/\s/g, '');
  const prefix = prefixes.find((prefix) => normalized.startsWith(prefix) &&
    !(/\d$/.test(prefix) && /^\d/.test(normalized.slice(prefix.length))));
  if (!prefix) return '';
  return String.fromCodePoint(...[...countries[prefix]].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}
