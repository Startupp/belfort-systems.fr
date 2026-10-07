// Met un GLB au format du jeu : un maillage, un materiau, une texture de couleur, base au sol.
// usage : node opt.mjs src dst triangles yaw taille_texture qualite   (BLOC=1 : aligne sur la grille, emprise exacte 1 x 1 ; KEEP=1 : garde l'echelle)
import {NodeIO} from '@gltf-transform/core';
import {dedup,weld,simplify,flatten,join,prune,textureCompress} from '@gltf-transform/functions';
import {MeshoptSimplifier} from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'fs';
const [,, src,dst,trisS,yawS,texS,qS]=process.argv; const tris=+trisS, tex=+texS||512, q=+qS||80; let yaw=(+yawS||0)*Math.PI/180;
const io=new NodeIO(); const doc=await io.read(src); const root=doc.getRoot();
for(const m of root.listMeshes())for(const p of m.listPrimitives())for(const k of p.listSemantics())if(k!=='POSITION'&&k!=='TEXCOORD_0')p.setAttribute(k,null);
await doc.transform(dedup(),flatten(),join(),weld());
const cnt=()=>{let c=0;for(const m of root.listMeshes())for(const p of m.listPrimitives())c+=(p.getIndices()?p.getIndices().getCount():p.getAttribute('POSITION').getCount())/3;return c};
const c0=cnt();
if(c0>tris){await MeshoptSimplifier.ready;await doc.transform(simplify({simplifier:MeshoptSimplifier,ratio:tris/c0,error:1,lockBorder:false}));}
const mul=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
const prims=[];const v=[0,0,0];
for(const n of root.listNodes()){const me=n.getMesh();if(!me)continue;const wm=n.getWorldMatrix();
  for(const p of me.listPrimitives()){const P=p.getAttribute('POSITION');for(let i=0;i<P.getCount();i++)P.setElement(i,mul(wm,P.getElement(i,v)));prims.push(p);}
  n.setMatrix([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);let par=n.getParentNode&&n.getParentNode();while(par){par.setMatrix([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);par=par.getParentNode();}}
const each=f=>{for(const p of prims){const P=p.getAttribute('POSITION');for(let i=0;i<P.getCount();i++){P.getElement(i,v);P.setElement(i,f(v));}}};
const bbox=()=>{let mn=[1e9,1e9,1e9],mx=[-1e9,-1e9,-1e9];for(const p of prims){const P=p.getAttribute('POSITION');for(let i=0;i<P.getCount();i++){P.getElement(i,v);for(let a=0;a<3;a++){mn[a]=Math.min(mn[a],v[a]);mx[a]=Math.max(mx[a],v[a]);}}}return [mn,mx]};
if(process.env.BLOC){ // angle qui donne la plus petite emprise au sol : les faces du cube suivent alors les axes
  let best=1e18,ba=0;for(let d=0;d<90;d+=0.5){const a=d*Math.PI/180,c=Math.cos(a),s=Math.sin(a);let x0=1e9,x1=-1e9,z0=1e9,z1=-1e9;
    for(const p of prims){const P=p.getAttribute('POSITION');for(let i=0;i<P.getCount();i++){P.getElement(i,v);const x=v[0]*c+v[2]*s,z=-v[0]*s+v[2]*c;x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);}}
    const ar=(x1-x0)*(z1-z0);if(ar<best){best=ar;ba=a;}}
  yaw+=ba;}
const cy=Math.cos(yaw),sy=Math.sin(yaw);each(w=>[w[0]*cy+w[2]*sy,w[1],-w[0]*sy+w[2]*cy]);
let [mn,mx]=bbox();const cx=(mn[0]+mx[0])/2,cz=(mn[2]+mx[2])/2;
if(process.env.BLOC){const sx=1/(mx[0]-mn[0]),sz=1/(mx[2]-mn[2]),syy=(sx+sz)/2;each(w=>[(w[0]-cx)*sx,(w[1]-mn[1])*syy,(w[2]-cz)*sz]);}
else if(!process.env.KEEP){const s=1/Math.max(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]);each(w=>[(w[0]-cx)*s,(w[1]-mn[1])*s,(w[2]-cz)*s]);}
for(const p of prims){const P=p.getAttribute('POSITION').getArray(),I=p.getIndices().getArray(),N=new Float32Array(P.length);
  for(let t=0;t<I.length;t+=3){const a=I[t]*3,b=I[t+1]*3,c=I[t+2]*3;const ux=P[b]-P[a],uy=P[b+1]-P[a+1],uz=P[b+2]-P[a+2],vx=P[c]-P[a],vy=P[c+1]-P[a+1],vz=P[c+2]-P[a+2];const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;for(const k of [a,b,c]){N[k]+=nx;N[k+1]+=ny;N[k+2]+=nz;}}
  for(let i=0;i<N.length;i+=3){const l=Math.hypot(N[i],N[i+1],N[i+2])||1;N[i]/=l;N[i+1]/=l;N[i+2]/=l;}
  p.setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(N).setBuffer(root.listBuffers()[0]));}
for(const m of root.listMaterials()){m.setMetallicFactor(0).setRoughnessFactor(1).setNormalTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0,0,0]).setAlphaMode('OPAQUE').setDoubleSided(false);}
await doc.transform(prune(),textureCompress({encoder:sharp,targetFormat:'jpeg',resize:[tex,tex],quality:q}));
for(const sc of root.listScenes())sc.setName('scene');
await io.write(dst,doc);[mn,mx]=bbox();
let verts=0;for(const p of prims)verts+=p.getAttribute('POSITION').getCount();
console.log(dst.split('/').pop(),'tris',c0,'->',cnt(),'sommets',verts,Math.round(fs.statSync(dst).size/1024)+'ko','dim',[mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]].map(x=>x.toFixed(2)).join('x'));
