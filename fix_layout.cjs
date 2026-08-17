const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'pages');
const files = fs.readdirSync(srcDir).filter(f => f.startsWith('Step') && f !== 'Step1_SourceData.tsx');

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Step A: We have a <PageGrid> block that contains the corrupted layout.
  const gridMatch = content.match(/<PageGrid>([\s\S]*?)<\/PageGrid>/);
  if (!gridMatch) continue;
  
  let inner = gridMatch[1];
  
  // We need to parse inner into 3 parts: Sidebar, Main, Right.
  // The Sidebar starts with `<title=` or `<>` (if no title).
  // Let's use a trick: the corrupted tags were at the top level of inner.
  // We know the tags are exactly `      <title=...` and `      </>` and `      <>`.
  
  // Let's replace the top-level corrupted tags with unique markers!
  // Since inner is just a string, let's do a line-by-line replacement.
  let lines = inner.split('\n');
  let part = 0; // 0=sidebar, 1=main, 2=right
  let outLines = [];
  
  let hasRight = inner.includes('      <>\n') && inner.split('      <>\n').length > 2; 
  // actually wait, if there are two `<>\n`, then there's Main and Right.
  let mainSpan = inner.split('      <>').length > 2 ? 6 : 9;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.match(/^      <title=(.*)>$/)) {
      let attrs = line.match(/^      <title=(.*)>$/)[1];
      outLines.push(`      {/* Left Column */}`);
      outLines.push(`      <GridCol span={3}>`);
      outLines.push(`        <Card>`);
      outLines.push(`          <CardHeader title=${attrs} />`);
      outLines.push(`          <CardBody className="p-3 space-y-3">`);
    }
    else if (line === '      <>') {
      part++;
      if (part === 1) { // Main
        outLines.push(`      {/* Middle Column */}`);
        outLines.push(`      <GridCol span={${mainSpan}}>`);
      } else if (part === 2) { // Right
        outLines.push(`      {/* Right Column */}`);
        outLines.push(`      <GridCol span={3}>`);
        outLines.push(`        <Card>`);
        outLines.push(`          <CardBody className="p-3 space-y-4">`);
      }
    }
    else if (line === '      </>') {
      if (part === 0) { // end sidebar
        outLines.push(`          </CardBody>`);
        outLines.push(`        </Card>`);
        outLines.push(`      </GridCol>`);
      } else if (part === 1) { // end main
        outLines.push(`      </GridCol>`);
      } else if (part === 2) { // end right
        outLines.push(`          </CardBody>`);
        outLines.push(`        </Card>`);
        outLines.push(`      </GridCol>`);
      }
    }
    else {
      outLines.push(line);
    }
  }

  content = content.replace(gridMatch[0], `<PageGrid>\n${outLines.join('\n')}\n      </PageGrid>`);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Fixed ${file}`);
}
