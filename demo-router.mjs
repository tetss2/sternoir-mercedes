import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';

const ttl=24*60*60*1000;
const digest=token=>createHash('sha256').update(token).digest('hex');

// Every visitor gets a separate SQLite database and both test roles inside it.
// No demo request is ever dispatched to the production database or sessions.
export function createDemoRouter({createApp,dataDir,publicDir,appUrl,production,rate}) {
  const root=resolve(dataDir,'demo-sessions');
  mkdirSync(root,{recursive:true});
  const opened=new Map();
  function closeOne(key){const app=opened.get(key);if(app){app.db.close();opened.delete(key);}}
  function metadata(key){try{return JSON.parse(readFileSync(resolve(root,key,'session.json'),'utf8'));}catch{return null;}}
  function cleanup(){
    for(const key of readdirSync(root)){
      if(!/^[a-f0-9]{64}$/.test(key))continue;
      if((metadata(key)?.expiresAt||0)<Date.now()){closeOne(key);rmSync(resolve(root,key),{recursive:true,force:true});}
    }
  }
  const cleanTimer=setInterval(cleanup,15*60*1000);cleanTimer.unref();cleanup();
  const tokenFor=req=>req.headers.cookie?.match(/(?:^|;\s*)sternoir_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
  function getApp(key){
    if(opened.has(key))return opened.get(key);
    if(opened.size>=24)closeOne(opened.keys().next().value);
    const app=createApp({dataDir:resolve(root,key),publicDir,appUrl,production,demo:true});
    opened.set(key,app);return app;
  }
  function seed(app){
    const db=app.db, time=new Date().toISOString(), customer=randomUUID(), admin=randomUUID(), car=randomUUID();
    db.prepare('INSERT INTO users(id,name,email,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)').run(customer,'Александр · тестовый клиент','client@sternoir.example','+7 (000) 000-00-00','disabled','customer',time);
    db.prepare('INSERT INTO users(id,name,email,phone,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)').run(admin,'Алексей · мастер-приёмщик','advisor@sternoir.example','+7 (000) 000-00-00','disabled','admin',time);
    db.prepare('INSERT INTO cars VALUES(?,?,?,?,?,?,?,?)').run(car,customer,'Mercedes-AMG G 63','2025','STERNOIR','',0,time);
    const order=randomUUID(),quote=randomUUID();
    db.prepare('INSERT INTO orders(id,public_id,customer_id,car_id,name,phone,model,service,symptom,status,created_at,updated_at,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(order,'DEMO-'+randomBytes(3).toString('hex').toUpperCase(),customer,car,'Александр · тестовый клиент','+7 (000) 000-00-00','Mercedes-AMG G 63','Техническое обслуживание','Плановое обслуживание и проверка тормозов.','awaiting_approval',time,time,time);
    const items=[{title:'Комплексная диагностика',quantity:1,unitPrice:4500},{title:'Замена масла и фильтра · работа',quantity:1,unitPrice:6500},{title:'Масляный фильтр · учебная позиция',quantity:1,unitPrice:3800}];
    db.prepare('INSERT INTO quotes(id,order_id,version,items,total,note,status,created_at) VALUES(?,?,?,?,?,?,?,?)').run(quote,order,1,JSON.stringify(items),14800,'Тестовая смета. Согласование ничего не оплачивает.','pending',time);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(randomUUID(),order,customer,'booking_created','Тестовая запись создана. Здесь сохраняются действия по заказу.',time);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(randomUUID(),order,admin,'quote_created','Подготовлена смета: 14 800 ₽. Можно согласовать со стороны клиента.',time);
    db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)').run(randomUUID(),order,admin,'admin','Александр, смета готова. Проверьте состав работ и подтвердите её в кабинете. Это демонстрация — реальный визит не назначается.',time);
  }
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  return {
    async handle(req,res,path){
      if(req.method!=='GET'){
        const expected=appUrl?new URL(appUrl).origin:`${production?'https':'http'}://${req.headers.host}`;
        if(req.headers.origin!==expected||req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'Откройте тест на сайте STERNOIR.'});
      }
      let token=tokenFor(req),key=token?digest(token):null,meta=key?metadata(key):null;
      const valid=!!meta&&meta.expiresAt>Date.now();
      if(['/api/demo/start','/api/demo/reset'].includes(path)&&req.method==='POST'){
        rate(req,'demo-start',20,3600000);
        let length=0;for await(const part of req){length+=part.length;if(length>1024)return json(res,413,{error:'Слишком большой запрос.'});}
        if(path==='/api/demo/reset'&&valid){closeOne(key);rmSync(resolve(root,key),{recursive:true,force:true});meta=null;}
        if(!valid||path==='/api/demo/reset'){
          cleanup();
          if(readdirSync(root).length>=300)return json(res,429,{error:'Все тестовые сеансы заняты. Попробуйте позже.'});
          token=randomBytes(32).toString('hex');key=digest(token);
          const app=getApp(key);seed(app);meta={expiresAt:Date.now()+ttl};
          writeFileSync(resolve(root,key,'session.json'),JSON.stringify(meta),{mode:0o600});
        }
        res.setHeader('Set-Cookie',`sternoir_demo=${token}; Path=/api/demo; HttpOnly; SameSite=Lax; Max-Age=${Math.max(1,Math.floor((meta.expiresAt-Date.now())/1000))}${production?'; Secure':''}`);
        return json(res,200,{demo:true,expiresAt:meta.expiresAt});
      }
      const match=/^\/api\/demo\/(customer|admin)(\/.*)$/.exec(path);
      if(!match)return json(res,404,{error:'Раздел теста не найден.'});
      if(!valid||!existsSync(resolve(root,key,'sternoir.sqlite')))return json(res,401,{error:'Тестовый сеанс завершён. Откройте кабинет заново.'});
      rate(req,'demo-api',300,60000);
      const app=getApp(key);
      req.url='/api'+match[2];req.demoRole=match[1];
      app.server.emit('request',req,res);
    },
    close(){clearInterval(cleanTimer);for(const key of [...opened.keys()])closeOne(key);}
  };
}
