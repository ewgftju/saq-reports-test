import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for(const name of ['index.html','styles.css','app.js','data.js','engine.js','export.js','templates.js','saq-mark.svg','saq-logo.png','saq-shell.css']) await copyFile(name,`dist/${name}`);
console.log('Static application built successfully.');
