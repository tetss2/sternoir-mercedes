import {mkdirSync,chownSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const directory=process.env.DATA_DIR||'/data';
if(process.getuid?.()===0){
  mkdirSync(directory,{recursive:true});
  for(const file of [directory,...['sternoir.sqlite','sternoir.sqlite-wal','sternoir.sqlite-shm'].map(name=>resolve(directory,name))])if(existsSync(file))chownSync(file,1000,1000);
  process.setgid(1000);process.setuid(1000);
}
const {createApp}=await import('./server.mjs');
const app=createApp();
app.server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('STERNOIR server ready'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>app.close().then(()=>process.exit(0)));
