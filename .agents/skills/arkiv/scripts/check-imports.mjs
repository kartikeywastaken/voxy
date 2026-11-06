import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const sdk='@arkiv-network/sdk', maxBytes=256*1024;
async function read(file){const h=await fs.open(file,constants.O_RDONLY|(constants.O_NONBLOCK??0));try{const s=await h.stat();if(!s.isFile()||s.size>maxBytes)throw Error('unmeasured');return await h.readFile('utf8');}finally{await h.close();}}
// Deliberately small lexical subset. Comments and quoted text are not imports.
export function tokens(text){
 const out=[];let i=0;
 while(i<text.length){
  const rest=text.slice(i);let m;
  if((m=/^\s+|^\/\/[^\n]*|^\/\*[\s\S]*?\*\//.exec(rest))){i+=m[0].length;continue;}
  if(text[i]==='/')throw Error('unmeasured'); // Avoid interpreting regex literals as source imports.
  const q=text[i];
  if(q==='"'||q==="'"||q==='`'){
   let value='',escaped=false,closed=false;i++;
   for(;i<text.length;i++){const c=text[i];if(c==='\\'){escaped=true;i++;continue;}if(c===q){closed=true;i++;break;}value+=c;}
   if(!closed)throw Error('unmeasured');out.push({kind:q==='`'||escaped?'opaque':'string',value});continue;
  }
  if((m=/^[A-Za-z_$][\w$]*/.exec(rest))){out.push({kind:'name',value:m[0]});i+=m[0].length;continue;}
  out.push({kind:'punct',value:q});i++;
 }
 return out;
}
function imports(text){
 const t=tokens(text),found=[];
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i].value!=='import'||t[i-1]?.value==='.'||!['{','type'].includes(t[i+1]?.value))continue;
  let j=i+1;if(t[j]?.value==='type')j++;if(t[j]?.value!=='{')continue;
  const names=[];j++;
  while(j<t.length&&t[j].value!=='}'){
   if(t[j].value==='type'&&t[j+1]?.kind==='name')j++;
   if(t[j]?.kind!=='name')throw Error('unmeasured');names.push(t[j++].value);
   if(t[j]?.value==='as'){j++;if(t[j++]?.kind!=='name')throw Error('unmeasured');}
   if(t[j]?.value===',')j++;else if(t[j]?.value!=='}')throw Error('unmeasured');
  }
  if(t[j+1]?.value!=='from'||t[j+2]?.kind!=='string')continue;
  const spec=t[j+2].value;if(spec!==sdk&&!spec.startsWith(sdk+'/')){i=j+2;continue;}
  // Diagnostics echo subpaths and names into the agent's context. Anything outside
  // the plain package-subpath and identifier grammar stays unmeasured, never echoed.
  if(spec.length>128||!(spec===sdk||/^@arkiv-network\/sdk(?:\/[a-z0-9][a-z0-9._-]*)+$/.test(spec))||names.some(n=>n.length>64))throw Error('unmeasured');
  found.push({spec,names});i=j+2;
 }
 return found;
}
function typeTargets(value){
 if(value===undefined||value===null)return [];
 if(Array.isArray(value))throw Error('unmeasured');
 if(typeof value==='string'){
  if(/\.d\.(ts|mts|cts)$/.test(value))return [value];
  // The published SDK also exposes a Bun TypeScript entrypoint. Read its
  // export declarations as text; never execute it or ignore that branch.
  if(/\.[cm]?ts$/.test(value))return [value];
  // TypeScript substitutes declaration extensions for explicit JS export targets.
  if(/\.mjs$/.test(value))return [value.slice(0,-4)+'.d.mts'];
  if(/\.cjs$/.test(value))return [value.slice(0,-4)+'.d.cts'];
  if(/\.js$/.test(value))return [value.slice(0,-3)+'.d.ts'];
  throw Error('unmeasured');
 }
 if(typeof value!=='object')throw Error('unmeasured');
 // An uninspected condition can select a different declaration set. Do not
 // infer absence from just the default branch when resolution is unknown.
 if(Object.keys(value).some(k=>!['types','import','require','default','bun'].includes(k)))throw Error('unmeasured');
 return [...new Set(['types','import','require','default','bun'].flatMap(k=>typeTargets(value[k])))];
}
// One check reads each declaration file at most once: re-export diamonds reuse the
// cached names, and the whole check stops at a fixed file count.
async function exportsOf(root,entry,seen=new Set(),ctx={cache:new Map(),reads:0}){
 const real=await fs.realpath(path.resolve(root,entry));
 if(!real.startsWith(root+path.sep)||seen.size>=32||seen.has(real))throw Error('unmeasured');
 if(ctx.cache.has(real))return ctx.cache.get(real);
 if(++ctx.reads>128)throw Error('unmeasured');seen.add(real);
 const t=tokens(await read(real)),names=new Set();
 // Namespace members and ambient module declarations have their own scope.
 // This reader does not resolve those scopes or declaration merging.
 if(t.some((token,i)=>token.kind==='name'&&(
  (['namespace','module'].includes(token.value)&&['name','string'].includes(t[i+1]?.kind))||
  (token.value==='global'&&t[i-1]?.value==='declare')
 )))throw Error('unmeasured');
 for(let i=0;i<t.length;i++){
  if(t[i].kind!=='name'||t[i].value!=='export')continue;
  let j=i+1;if(t[j]?.value==='declare')j++;
  if(['const','let','var','function','class','interface','enum','namespace','type'].includes(t[j]?.value)&&t[j+1]?.kind==='name'){
   // This small reader does not parse compound variable/type declarations.
   // Refuse an ambiguous comma rather than falsely declaring a later name absent.
   if(['const','let','var'].includes(t[j].value))for(let k=j+2;k<t.length&&t[k].value!==';';k++)if(t[k].value===',')throw Error('unmeasured');
   names.add(t[j+1].value);continue;
  }
  if(t[j]?.value==='type')j++;
  if(t[j]?.value==='default'){names.add('default');continue;}
  if(t[j]?.value==='*'){
   if(t[j+1]?.value!=='from'||t[j+2]?.kind!=='string'||!t[j+2].value.startsWith('.'))throw Error('unmeasured');
   const ref=t[j+2].value.replace(/\.js$/,'.d.ts');
   for(const name of await exportsOf(root,path.relative(root,path.resolve(path.dirname(real),ref)),new Set(seen),ctx))names.add(name);continue;
  }
  if(t[j]?.value!=='{')throw Error('unmeasured');j++;
  while(j<t.length&&t[j].value!=='}'){
   if(t[j].value==='type'&&t[j+1]?.kind==='name')j++;
   if(t[j]?.kind!=='name')throw Error('unmeasured');let name=t[j++].value;
   if(t[j]?.value==='as'){j++;if(t[j]?.kind!=='name')throw Error('unmeasured');name=t[j++].value;}
   names.add(name);if(t[j]?.value===',')j++;else if(t[j]?.value!=='}')throw Error('unmeasured');
  }
 }
 ctx.cache.set(real,names);return names;
}
export async function checkFile(file,cwd){
 const result={measured:false,diagnostics:[]};
 try{
  if(!path.isAbsolute(file)||!path.isAbsolute(cwd)||!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(file))return result;
  const workspace=await fs.realpath(cwd),target=await fs.realpath(file);
  if(!target.startsWith(workspace+path.sep))return result;
  const requested=imports(await read(target));if(!requested.length)return result;
  let dir=path.dirname(target),root,pkg;
  for(let depth=0;depth<32;depth++){
   try{const candidate=path.join(dir,'node_modules',...sdk.split('/'));pkg=JSON.parse(await read(path.join(candidate,'package.json')));root=await fs.realpath(candidate);break;}catch(e){if(e.code!=='ENOENT')throw e;}
   const parent=path.dirname(dir);if(parent===dir)break;dir=parent;
  }
  if(!pkg||pkg.name!==sdk||!pkg.exports||typeof pkg.exports!=='object'||Array.isArray(pkg.exports))return result;
  // Conditional main exports and fallback arrays are valid package shapes, but
  // this reader supports only explicit subpath maps. Their lack of a literal
  // "." key is not evidence that the SDK root cannot be imported.
  if(Object.keys(pkg.exports).some(k=>(k!=='.'&&!k.startsWith('./'))||k.includes('*')))return result;
  const ctx={cache:new Map(),reads:0};
  for(const item of requested){
   const subpath=item.spec===sdk?'.':'.'+item.spec.slice(sdk.length);
   if(!Object.hasOwn(pkg.exports,subpath)||pkg.exports[subpath]===null){result.diagnostics.push({code:'ARKIV_IMPORT_SUBPATH',subpath});continue;}
   const entries=typeTargets(pkg.exports[subpath]);if(!entries.length)throw Error('unmeasured');
   // A missing name is reported only when absent from every readable standard
   // declaration/Bun source target. Missing targets leave it unmeasured.
   const names=new Set();for(const entry of entries)for(const name of await exportsOf(root,entry,new Set(),ctx))names.add(name);
   for(const name of item.names)if(!names.has(name))result.diagnostics.push({code:'ARKIV_IMPORT_NAME',subpath,name});
  }
  result.measured=true;return result;
 }catch{return {measured:false,diagnostics:[]};}
}
export async function hook(input){
 if(input?.hook_event_name!=='PostToolUse'||!['Write','Edit'].includes(input.tool_name)||typeof input.tool_input?.file_path!=='string'||typeof input.cwd!=='string')return {};
 const r=await checkFile(input.tool_input.file_path,input.cwd);
 if(!r.measured||!r.diagnostics.length)return {};
 return {hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:'Arkiv import check: '+r.diagnostics.map(d=>d.code==='ARKIV_IMPORT_SUBPATH'?`The installed SDK does not export subpath ${d.subpath}.`:`The installed declarations for ${d.subpath} do not export ${d.name}.`).join(' ')+' Inspect the installed declarations before changing the integration. This advisory check does not authorize installation or network calls.'}};
}
async function main(){
 if(process.argv[2]==='--hook'){let s='';for await(const b of process.stdin){s+=b;if(Buffer.byteLength(s)>32768)return;}const r=await hook(JSON.parse(s));if(Object.keys(r).length)console.log(JSON.stringify(r));}
 else console.log(JSON.stringify(await checkFile(path.resolve(process.argv[2]??''),process.cwd())));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{process.exitCode=0;});
