import test from 'node:test';
import assert from 'node:assert/strict';
import {bindHeroFilm} from '../public/hero-film.js';

// Exercise the actual media controller with browser events. No browser-specific
// user-agent marker is required for the iPhone/Telegram safety boundary.
function browserFixture(t, {mobile = true, userAgent = 'iPhone', touch = 5, wide = false, rejectPlay = false} = {}) {
  const calls = {play:0, load:0, context:0, resize:0, frames:0};
  const attrs = new Map();
  const video = new EventTarget();
  Object.assign(video, {paused:true, readyState:2, videoWidth:1280, videoHeight:720, currentTime:0,
    dataset:{mobileSrc:'/mobile.mp4', desktopSrc:'/desktop.mp4'},
    getAttribute:name=>attrs.get(name) || null,
    removeAttribute:name=>attrs.delete(name),
    play:() => { calls.play++; if (rejectPlay) return Promise.reject(new Error('Autoplay blocked')); video.paused=false;video.dispatchEvent(new Event('playing'));return Promise.resolve(); },
    pause:() => { if (!video.paused) {video.paused=true;video.dispatchEvent(new Event('pause'));} },
    load:() => {calls.load++;},
    requestVideoFrameCallback:() => {calls.frames++;return calls.frames;},
    cancelVideoFrameCallback:() => {},
  });
  Object.defineProperty(video,'src',{set:value=>attrs.set('src',value),get:()=>attrs.get('src') || ''});
  const poster = Object.assign(new EventTarget(), {complete:true,naturalWidth:768,naturalHeight:432});
  const canvas = {width:1,height:1,getContext:() => {calls.context++;return {drawImage:()=>{}};}};
  const classes = new Set();
  const surface = {
    classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),toggle:(n,on)=>on?classes.add(n):classes.delete(n)},
    querySelector:selector=>selector==='canvas'?canvas:poster,
    getBoundingClientRect:()=>({width:wide?2560:mobile?390:1366,height:wide?720:mobile?220:800}),
  };
  video.closest=()=>surface;
  const control=Object.assign(new EventTarget(), {setAttribute:()=>{},innerHTML:''});
  const doc=Object.assign(new EventTarget(),{hidden:false});
  const win=new EventTarget();
  const motion=Object.assign(new EventTarget(),{matches:false});
  let intersection;
  const globals={
    document:doc,window:win,devicePixelRatio:3,
    navigator:{userAgent,maxTouchPoints:touch},
    matchMedia:query=>query.includes('prefers-reduced')?motion:{matches:query.includes('max-width')?mobile:touch>0},
    IntersectionObserver:class{constructor(callback){intersection=callback;}observe(){}disconnect(){}},
    ResizeObserver:class{constructor(){calls.resize++;}observe(){}disconnect(){}},
  };
  for(const [key,value] of Object.entries(globals)){
    const old=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
    t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);
  }
  const dispose=bindHeroFilm(video,control,paused=>paused?'play':'pause');
  t.after(dispose);
  return {calls,video,poster,control,canvas,win,dispose,visible:()=>intersection([{isIntersecting:true}])};
}

test('iPhone starts with no media source, decoder or canvas; a click plays and navigation releases it',async t=>{
  const f=browserFixture(t);
  f.visible();f.poster.dispatchEvent(new Event('load'));
  assert.equal(f.video.src,'');assert.equal(f.calls.play,0);assert.equal(f.calls.load,0);
  assert.equal(f.calls.context,0);assert.equal(f.calls.resize,0);assert.equal(f.calls.frames,0);
  f.control.dispatchEvent(new Event('click'));await Promise.resolve();
  assert.equal(f.video.src,'/mobile.mp4');assert.equal(f.calls.play,1);assert.equal(f.calls.context,0);
  f.dispose();assert.equal(f.video.src,'');assert.equal(f.video.paused,true);assert.equal(f.calls.load,1);
  f.poster.dispatchEvent(new Event('load'));assert.equal(f.calls.play,1);
});

test('an iOS webview with a wide viewport remains manual and a slow poster never consumes the play gesture',async t=>{
  const f=browserFixture(t,{mobile:false,touch:0,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',wide:true});
  f.poster.complete=false;f.visible();assert.equal(f.video.src,'');assert.equal(f.calls.context,0);
  f.control.dispatchEvent(new Event('click'));await Promise.resolve();
  assert.equal(f.video.src,'/mobile.mp4');assert.equal(f.calls.play,1);
  f.win.dispatchEvent(new Event('pagehide'));assert.equal(f.video.src,'');assert.equal(f.canvas.width,1);
  f.win.dispatchEvent(new Event('pageshow'));f.visible();assert.equal(f.video.src,'');assert.equal(f.calls.play,1);
});

test('desktop autoplay rejection does not cause repeated play requests from observers',async t=>{
  const f=browserFixture(t,{mobile:false,touch:0,userAgent:'Desktop',rejectPlay:true});
  f.visible();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.video.src,'/desktop.mp4');assert.equal(f.calls.play,1);assert.equal(f.calls.context,0);
  f.visible();f.poster.dispatchEvent(new Event('load'));assert.equal(f.calls.play,1);
  f.control.dispatchEvent(new Event('click'));await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.play,2);
});

test('ultrawide desktop retains the panorama and releases the backing store on exit',async t=>{
  const f=browserFixture(t,{mobile:false,touch:0,userAgent:'Desktop',wide:true});
  assert.equal(f.calls.context,1);assert.equal(f.canvas.width,3840);
  f.visible();await Promise.resolve();assert.equal(f.video.src,'/desktop.mp4');assert.ok(f.calls.frames>0);
  f.dispose();assert.equal(f.canvas.width,1);assert.equal(f.canvas.height,1);assert.equal(f.video.src,'');
});
