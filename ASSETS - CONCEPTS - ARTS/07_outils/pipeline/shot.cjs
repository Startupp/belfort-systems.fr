const {chromium}=require('playwright');
(async()=>{const [,, out,cols,T,az,d,...f]=process.argv;
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle']});const p=await b.newPage();p.on('console',m=>console.log(m.text()));p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto(`http://localhost:8123/view.html?cols=${cols}&t=${T}&az=${az}&d=${d}&f=${f.join(',')}`);await p.waitForFunction('document.title==="done"',{timeout:100000});
await (await p.$('#c')).screenshot({path:out,type:'jpeg',quality:72});await b.close();console.log('ok',out);})()
