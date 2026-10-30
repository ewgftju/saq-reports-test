import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for(const name of ['navigation.js','navigation.css','analytics-data.js','analytics-engine.js','analytics-view.js','analytics.css','index.html','styles.css','app.js','data.js','feature-flags.js','archive-schemas.js','form-registry.js','received-schemas.js','received-engine.js','received-demo-data.js','professional-schemas.js','professional-engine.js','professional-demo-data.js','archive-engine.js','archive-demo-data.js','archive-ui.js','catalog.js','catalog-view.js','catalog.css','linked-data.js','report-help.js','engine.js','export.js','templates.js','saq-mark.svg','saq-logo.png','saq-shell.css']) await copyFile(name,`dist/${name}`);
console.log('Static application built successfully.');
