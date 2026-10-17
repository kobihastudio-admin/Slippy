import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../Slippy/Assets.xcassets/', import.meta.url));
const places = [
  ['Kushida', 'Kushida Shrine', ['kushida', 'hakata old town']],
  ['CanalCity', 'Canal City Hakata', ['canal city']],
  ['Nakasu', 'Nakasu Fukuoka', ['nakasu', 'yatai']],
  ['Yusentei', 'Yusentei Park', ['yusentei']],
  ['Ohori', 'Ohori Park', ['ohori']],
  ['FukuokaCastle', 'Fukuoka Castle', ['fukuoka castle', 'maizuru']],
  ['Tenjin', 'Tenjin Fukuoka', ['tenjin']],
  ['KumamotoCastle', 'Kumamoto Castle', ['kumamoto castle', 'josaien']],
  ['Suizenji', 'Suizenji Jojuen', ['suizenji']],
  ['Dazaifu', 'Dazaifu Tenmangu', ['dazaifu tenmangu']],
  ['Kamado', 'Kamado Shrine', ['kamado']],
  ['Kinrin', 'Lake Kinrin', ['kinrin', 'kinrinko']],
  ['Yunotsubo', 'Yunotsubo', ['yunotsubo']],
  ['FloralVillage', 'Yufuin Floral Village', ['floral village']],
  ['Nanzoin', 'Nanzoin Sasaguri', ['nanzoin']],
  ['Nomiyama', 'Nomiyama Kannonji', ['nomiyama', 'tennoin']],
  ['Raizan', 'Sennyoji Fukuoka', ['raizan', 'sennyoji']],
  ['Tochoji', 'Tochoji Fukuoka', ['tochoji']],
  ['HakataStation', 'Hakata Station', ['hakata station', 'hakata →', '→ hakata']],
  ['KumamotoStation', 'Kumamoto Station', ['kumamoto station']],
  ['FukuokaAirport', 'Fukuoka Airport', ['fukuoka airport', 'เที่ยวบินกลับไทย']],
];
const clean = text => text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
const dir = `${root}KyushuReferencePhotos.dataset`;
await mkdir(dir, { recursive: true });
const catalog = JSON.parse(await readFile(`${dir}/photos.json`, 'utf8').catch(() => '[]'));
async function request(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'SlippyTripPhotoImport/1.0' } });
    if (response.status !== 429) return response;
    await new Promise(resolve => setTimeout(resolve, 15000 * (attempt + 1)));
  }
  throw new Error(`Rate limit: ${url}`);
}
for (const [key, title, aliases] of places) {
  if (catalog.some(photo => photo.name === `KyushuPhoto${key}`)) continue;
  await new Promise(resolve => setTimeout(resolve, 3500));
  const params = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: `${title} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '8', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1280', format: 'json' });
  const response = await request(`https://commons.wikimedia.org/w/api.php?${params}`);
  if (!response.ok) throw new Error(`${title}: search HTTP ${response.status}`);
  const result = await response.json();
  const options = Object.values(result.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  const page = options.find(p => {
    const info = p.imageinfo?.[0];
    return info && /\.jpe?g(?:\?|$)/i.test(info.url) && info.width > info.height && /^(CC BY|CC0|Public domain)/.test(info.extmetadata?.LicenseShortName?.value ?? '');
  }) ?? options.find(p => p.imageinfo && /\.jpe?g(?:\?|$)/i.test(p.imageinfo[0].url) && /^(CC BY|CC0|Public domain)/.test(p.imageinfo[0].extmetadata?.LicenseShortName?.value ?? ''));
  if (!page) { console.log(`No licensed photo: ${title}`); continue; }
  const info = page.imageinfo[0];
  const image = await request(info.thumburl ?? info.url);
  if (!image.ok) throw new Error(`${title}: image HTTP ${image.status}`);
  const name = `KyushuPhoto${key}`;
  const dir = `${root}${name}.imageset`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/photo.jpg`, Buffer.from(await image.arrayBuffer()));
  await writeFile(`${dir}/Contents.json`, JSON.stringify({ images: [{ filename: 'photo.jpg', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
  catalog.push({ name, title, aliases, source: info.descriptionurl, author: clean(info.extmetadata.Artist?.value ?? ''), license: info.extmetadata.LicenseShortName.value, licenseURL: info.extmetadata.LicenseUrl?.value ?? '', filename: page.title });
  await writeFile(`${root}KyushuReferencePhotos.dataset/photos.json`, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`${title}: ${page.title}`);
}
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/photos.json`, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(`${dir}/Contents.json`, JSON.stringify({ data: [{ filename: 'photos.json', idiom: 'universal' }], info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
console.log(`Imported ${catalog.length} photos`);
