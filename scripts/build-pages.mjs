import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as ui from '../public/ui.js';
import {renderBasic} from '../public/basic-pages.js';
import {renderCatalog} from '../public/catalog-pages.js';
import {services,models} from '../public/content.js';
import {operations,seasonalPrograms,repairStories,journalArticles} from '../public/catalog-data.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const archive=resolve(root,'public/assets/mobile-v1.tar.gz');
if(existsSync(archive))execFileSync('tar',['-xzf',archive,'-C',resolve(root,'public/assets')]);
const read=name=>readFileSync(resolve(root,name),'utf8');
const template=read('scripts/page-shell.html');
writeFileSync(resolve(root,'public/site.css'),['fonts','style','portal','catalog','hero'].map(name=>read('public/'+name+'.css')).join('\n'));
const paths=new Set(['/about','/privacy','/account','/admin','/demo/customer','/demo/admin','/','/services','/models','/pricing','/parts','/pre-purchase','/seasonal','/stories','/guarantee','/reviews','/journal','/club','/contacts','/process','/amg','/credits',...services.map(s=>'/services/'+s.slug),...models.flatMap(m=>['/models/'+m.slug,...m.generations.map(g=>'/models/'+m.slug+'/'+g.id)]),...operations.map(o=>'/work/'+o.slug),...seasonalPrograms.map(x=>'/seasonal/'+x.slug),...repairStories.map(x=>'/stories/'+x.slug),...journalArticles.map(x=>'/journal/'+x.slug)]);
let count=0;
for(const path of paths){
  const page=renderCatalog(path,ui)||renderBasic(path)||{title:path.endsWith('/admin')?'Управление сервисом':'Мой автомобиль',html:'<div class="wrap section" role="status">Открываем кабинет…</div>'};
  const html=template.replace(/<title>.*?<\/title>/,`<title>${ui.esc(page.title)} — STERNOIR</title>`)
    .replace('<!-- page-preload -->',path==='/'?'<link rel="preload" as="image" href="/assets/mobile-v1/hero-g63-poster.webp">':'')
    .replace('<header id="header"></header>','<header id="header">'+ui.headerMarkup(path)+'</header>')
    .replace('<main id="main" tabindex="-1"></main>',`<main id="main" tabindex="-1" data-prerendered="true" data-path="${ui.esc(path)}">${page.html}</main>`)
    .replace('<footer id="footer"></footer>','<footer id="footer">'+ui.footerMarkup()+'</footer>');
  const file=resolve(root,path==='/'?'public/index.html':'public/pages'+path+'.html');
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,html);count++;
}
console.log(`Prerendered ${count} public routes.`);
