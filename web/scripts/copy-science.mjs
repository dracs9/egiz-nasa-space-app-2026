// Package the official NASA distribution, licenses and fonts locally. Loaded only on demand.
import { cp, mkdir } from 'node:fs/promises';
const source = new URL('../node_modules/openmct/', import.meta.url);
const destination = new URL('../public/vendor/openmct/', import.meta.url);
await mkdir(destination, {recursive:true});
await cp(new URL('dist/',source),destination,{recursive:true,filter:path=>!path.endsWith('.map')});
for(const file of ['LICENSE.md','copyright-notice.html','copyright-notice.js'])
  await cp(new URL(file,source),new URL(file,destination));
console.log('Egiz: packaged NASA Open MCT 4.3.1, licenses, fonts and workers (lazy workspace).');
