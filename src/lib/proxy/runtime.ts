import { PROXY_PREFIX } from "./url";

// Script injected at the top of every proxied HTML document. It keeps dynamic
// JS requests, navigation, cookies and client-side routing inside the proxy.
const RUNTIME = String.raw`(function(){
if(window.__pxy)return;window.__pxy=1;
var P=__PREFIX__,O=location.origin,FB=__TARGET__;
function parse(p){var r=p.slice(P.length);var m=r.match(/^(https?|wss?)\/([^\/?#]+)(.*)$/i);if(!m)return null;var t=m[3]||'/';if(t.charAt(0)!=='/')t='/'+t;try{return new URL(m[1]+'://'+m[2]+t)}catch(e){return null}}
function cur(){var l=location.pathname+location.search+location.hash;if(l.indexOf(P)===0){var u=parse(l);if(u){FB=u.href;return u.href}}return FB}
function toP(u){if(u==null)return u;var s=String(u);if(!s||s.charAt(0)==='#'||/^(data|blob|javascript|about|mailto|tel|sms|chrome-extension):/i.test(s))return u;var a;try{a=new URL(s,cur())}catch(e){return u}
if(a.origin===O){if(a.pathname.indexOf(P)===0)return a.href;try{a=new URL(a.pathname+a.search+a.hash,cur())}catch(e){return u}}
var pr=a.protocol.slice(0,-1);if(!/^(https?|wss?)$/.test(pr))return u;return O+P+pr+'/'+a.host+a.pathname+a.search+a.hash}
window.__pxyToP=toP;
try{var OR=window.Request;var NR=function(u,o){if(!(u instanceof OR))u=toP(u);return new OR(u,o)};NR.prototype=OR.prototype;Object.defineProperty(NR,Symbol.hasInstance,{value:function(x){return x instanceof OR}});window.Request=NR;}catch(e){}
try{var of=window.fetch;window.fetch=function(i,o){var self=this;try{if(typeof Request!=='undefined'&&i instanceof OR){var n=toP(i.url);var q=i;if(n===i.url)return of.call(self,i,o);var init={method:q.method,headers:q.headers,mode:q.mode==='navigate'?'same-origin':q.mode,credentials:q.credentials,cache:q.cache,redirect:q.redirect,referrer:q.referrer,integrity:'',keepalive:q.keepalive,signal:q.signal};if(q.method==='GET'||q.method==='HEAD')return of.call(self,new Request(n,init),o);return q.arrayBuffer().then(function(b){if(b&&b.byteLength)init.body=b;return of.call(self,new Request(n,init),o)})}if(o&&o.body&&typeof ReadableStream!=='undefined'&&o.body instanceof ReadableStream){var oo2=o;return new Response(o.body).arrayBuffer().then(function(b){var c={};for(var k in oo2)c[k]=oo2[k];c.body=b;delete c.duplex;return of.call(self,toP(i),c)})}i=toP(i)}catch(e){}return of.call(self,i,o)}}catch(e){}
try{var oo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=toP(u);return oo.apply(this,arguments)}}catch(e){}
try{var OW=window.WebSocket;var W=function(u,p){var x=String(toP(u)).replace(/^http/,'ws');return p===undefined?new OW(x):new OW(x,p)};W.prototype=OW.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){W[k]=OW[k]});window.WebSocket=W}catch(e){}
try{var OE=window.EventSource;if(OE){var E=function(u,c){return new OE(toP(u),c)};E.prototype=OE.prototype;window.EventSource=E}}catch(e){}
try{var sb=navigator.sendBeacon&&navigator.sendBeacon.bind(navigator);if(sb)navigator.sendBeacon=function(u,d){return sb(toP(u),d)}}catch(e){}
try{var wo=window.open;window.open=function(u,t,f){return wo.call(window,u?toP(u):u,t,f)}}catch(e){}
try{if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('Service workers are disabled in the proxy'))}}}catch(e){}
var RS=History.prototype.replaceState;function fix(){try{if(location.pathname.indexOf(P)!==0){var b=new URL(FB);var d=new URL(location.pathname+location.search+location.hash,b.origin);RS.call(history,history.state,'',P+b.protocol.slice(0,-1)+'/'+b.host+d.pathname+d.search+d.hash)}}catch(e){}}setInterval(fix,200);
function notify(){fix();try{if(parent!==window)parent.postMessage({__proxy:1,type:'nav',url:cur(),title:document.title},O)}catch(e){}}
['pushState','replaceState'].forEach(function(k){var f=History.prototype[k];History.prototype[k]=function(s,t,u){if(u!=null)arguments[2]=toP(u);var r=f.apply(this,arguments);notify();return r}});
function hook(C,p){try{if(!C)return;var d=Object.getOwnPropertyDescriptor(C.prototype,p);if(!d||!d.set)return;Object.defineProperty(C.prototype,p,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){d.set.call(this,toP(v))}})}catch(e){}}
[[window.HTMLImageElement,'src'],[window.HTMLScriptElement,'src'],[window.HTMLLinkElement,'href'],[window.HTMLMediaElement,'src'],[window.HTMLSourceElement,'src'],[window.HTMLIFrameElement,'src'],[window.HTMLAnchorElement,'href'],[window.HTMLFormElement,'action'],[window.HTMLEmbedElement,'src'],[window.HTMLObjectElement,'data'],[window.HTMLTrackElement,'src'],[window.HTMLInputElement,'src'],[window.HTMLVideoElement,'poster']].forEach(function(x){hook(x[0],x[1])});
try{var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){var l=String(n).toLowerCase();if((l==='src'||l==='href'||l==='action'||l==='poster'||l==='data'||l==='formaction')&&typeof v==='string')v=toP(v);return sa.call(this,n,v)}}catch(e){}
try{var cd=Object.getOwnPropertyDescriptor(Document.prototype,'cookie');if(cd&&cd.set){Object.defineProperty(document,'cookie',{configurable:true,get:function(){return cd.get.call(document)},set:function(v){try{var cu=new URL(cur());var parts=String(v).split(';').filter(function(x){return !/^\s*(domain|path)\s*=/i.test(x)});parts.push('path='+P+cu.protocol.slice(0,-1)+'/'+cu.host+'/');v=parts.join(';')}catch(e){}cd.set.call(document,v)}})}}catch(e){}
window.addEventListener('popstate',notify);window.addEventListener('hashchange',notify);document.addEventListener('DOMContentLoaded',notify);window.addEventListener('load',notify);
try{new MutationObserver(function(){notify()}).observe(document.querySelector('title')||document.documentElement,{childList:true,subtree:!document.querySelector('title')})}catch(e){}
})();`;

export function buildRuntime(targetHref: string): string {
  const safe = (v: string) => JSON.stringify(v).replace(/</g, "\\u003c");
  return RUNTIME.replace("__PREFIX__", safe(PROXY_PREFIX)).replace("__TARGET__", safe(targetHref));
}
