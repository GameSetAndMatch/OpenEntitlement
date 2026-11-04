/** Publish canonical spec sources without maintaining a second copy. */
import { readFile, writeFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const docs = resolve(root, 'website/src/content/docs');
const repo = 'https://github.com/GameSetAndMatch/openentitlement/blob/main/';
const files = [
  { source: 'GLOSSARY.md', target: 'reference/glossary.md', title: 'Glossary' },
  ...((await readdir(resolve(root, 'spec/sections'))).filter((f) => f.endsWith('.md')).sort().map((f) => ({ source: `spec/sections/${f}`, target: `specification/${f}`, title: f.replace(/^\d+-/, '').replace('.md', '').replaceAll('-', ' ') }))),
];
const routes = new Map(files.map((f) => [resolve(root, f.source), `/${f.target.replace(/\.md$/, '')}/`]));
await rm(resolve(docs, 'specification'), { recursive: true, force: true });
for (const file of files) {
  let content = await readFile(resolve(root, file.source), 'utf8');
  const heading = /^# (.+)$/m.exec(content)?.[1] ?? file.title;
  content = content.replace(/^# .+\r?\n/, '');
  content = content.replace(/\]\(([^\s)]+)\)/g, (match, href) => {
    if (/^(?:https?:|mailto:|#|\/)/.test(href)) return match;
    const [path, fragment] = href.split('#');
    const absolute = resolve(root, dirname(file.source), path);
    const dest = routes.get(absolute);
    return `](${dest ? dest + (fragment ? '#' + fragment : '') : repo + relative(root, absolute).replaceAll('\\', '/') + (fragment ? '#' + fragment : '')})`;
  });
  const frontmatter = `---\ntitle: ${JSON.stringify(heading)}\neditUrl: ${JSON.stringify('https://github.com/GameSetAndMatch/openentitlement/edit/main/' + file.source)}\n---\n\n`;
  await mkdir(dirname(resolve(docs, file.target)), { recursive: true });
  await writeFile(resolve(docs, file.target), frontmatter + content);
}
await cp(resolve(root, 'spec/oerep.openapi.json'), resolve(root, 'website/public/oerep.openapi.json'));
