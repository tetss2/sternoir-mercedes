import {createReadStream, readFileSync, statSync} from 'node:fs';
import {extname} from 'node:path';
import {brotliCompressSync, gzipSync, constants} from 'node:zlib';

const compressed = new Map();
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff':'font/woff','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};

export function serveFile(req, res, file) {
  const stat=statSync(file), type=types[extname(file)]||'application/octet-stream';
  const versioned=/[?&]v=/.test(req.url)||/\/(?:mobile-v1|hero-g63-mobile-v1)/.test(file);
  const etag=`"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  res.setHeader('Content-Type',type);
  res.setHeader('Cache-Control',type.startsWith('text/html')?'no-cache':versioned?'public, max-age=31536000, immutable':'public, max-age=3600');
  res.setHeader('ETag',etag);
  res.setHeader('Accept-Ranges','bytes');
  if (/^(text\/|application\/json|image\/svg)/.test(type)) res.setHeader('Vary','Accept-Encoding');
  if(req.headers['if-none-match']===etag&&!req.headers.range){res.writeHead(304);return res.end();}
  const range=req.headers.range;
  if(range && (!req.headers['if-range']||req.headers['if-range']===etag)) {
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
    const start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));
    const end=match[1]&&match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});return res.end();}
    res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});
    if(req.method==='HEAD')return res.end();
    return stream(file,res,{start,end});
  }
  const accepted=String(req.headers['accept-encoding']||'').split(',').map(s=>s.trim()).filter(s=>!/(?:^|;)\s*q=0(?:\.0*)?$/.test(s));
  const encoding=accepted.some(s=>/^br(?:;|$)/.test(s))?'br':accepted.some(s=>/^gzip(?:;|$)/.test(s))?'gzip':null;
  if(encoding&&/^(text\/|application\/json|image\/svg)/.test(type)&&stat.size>512&&stat.size<1024*1024){
    const key=file+etag+encoding;
    if(!compressed.has(key)){
      if(compressed.size>300)compressed.clear();
      const source=readFileSync(file);
      compressed.set(key,encoding==='br'?brotliCompressSync(source,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}):gzipSync(source,{level:6}));
    }
    const body=compressed.get(key);
    res.writeHead(200,{'Content-Encoding':encoding,'Content-Length':body.length});
    return res.end(req.method==='HEAD'?undefined:body);
  }
  res.writeHead(200,{'Content-Length':stat.size});
  if(req.method==='HEAD')return res.end();
  stream(file,res);
}
function stream(file,res,options){
  const input=createReadStream(file,options);
  input.on('error',()=>res.destroy());
  res.on('close',()=>input.destroy());
  input.pipe(res);
}
