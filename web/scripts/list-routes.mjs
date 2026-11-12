import fs from "fs";
import path from "path";
function walk(d){let r=[];for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())r=r.concat(walk(p));else if(/^page\.tsx?$/.test(f.name))r.push(p);}return r;}
const base="src/app";
const files=walk(base);
const routes=files.map(f=>{let rel=path.relative(base,f).replace(/\\/g,"/");rel=rel.replace(/\/page\.tsx?$/,"");if(rel==="page")rel="";return "/"+rel;}).filter(r=>!r.includes("["));
fs.writeFileSync("C:/Users/syedm/AppData/Local/Temp/opencode/routes.json", JSON.stringify(routes));
console.log(routes.length);