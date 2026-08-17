const fs = require('fs');
const path = require('path');

function walkSync(dir, filelist) {
  let files = fs.readdirSync(dir);
  filelist = filelist || [];
  files.forEach(function(file) {
    if (fs.statSync(path.join(dir, file)).isDirectory()) {
      filelist = walkSync(path.join(dir, file), filelist);
    }
    else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        filelist.push(path.join(dir, file));
      }
    }
  });
  return filelist;
}

const files = walkSync('./src', []);
let changed = 0;
files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  // Replace fetch('/api/...
  content = content.replace(/fetch\('(\/api\/[^']+)'/g, "fetch(`${import.meta.env.VITE_BACKEND_URL}$1`");
  content = content.replace(/fetch\("(\/api\/[^"]+)"/g, "fetch(`${import.meta.env.VITE_BACKEND_URL}$1`");
  // Replace fetch(`/api/...`)
  content = content.replace(/fetch\(`(\/api\/[^`]+)`/g, "fetch(`${import.meta.env.VITE_BACKEND_URL}$1`");
  
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    changed++;
  }
});
console.log(`Updated ${changed} files.`);
