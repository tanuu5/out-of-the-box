// dist/ のビルド結果から、JS と CSS を埋め込んだ 1 ファイルの HTML を作る
// （Claude の Artifact として公開するため。外部スクリプトを読まない形にする）
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const assets = resolve(dist, 'assets');
const files = readdirSync(assets);
const jsFile = files.find((f) => f.endsWith('.js'));
const cssFile = files.find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('dist/assets に JS / CSS が見つかりません。先に npm run build を実行してください。');

const js = readFileSync(resolve(assets, jsFile), 'utf8').replace(/<\/script/gi, '<\\/script');
const css = readFileSync(resolve(assets, cssFile), 'utf8');
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');

const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, 'OUT OF THE BOX'])[1];
const fonts = (html.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/) ?? [''])[0];
const body = (html.match(/<body>([\s\S]*)<\/body>/) ?? [, ''])[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();

const out = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;

const outDir = resolve(root, 'dist-single');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'out-of-the-box.html');
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${(out.length / 1024).toFixed(0)} KB)`);
