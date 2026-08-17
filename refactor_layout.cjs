const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src', 'pages');

const files = fs.readdirSync(srcDir).filter(f => f.startsWith('Step') && f !== 'Step1_SourceData.tsx');

for (const file of files) {
  const filePath = path.join(srcDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Update imports
  content = content.replace(/PageSidebar\s*,?\s*/g, '');
  content = content.replace(/PageMain\s*,?\s*/g, '');
  content = content.replace(/PageRight\s*,?\s*/g, '');
  
  if (!content.includes('PageLayout')) {
    content = content.replace(/import\s*{([^}]*)}\s*from\s*['"]@\/components\/shared['"];/g, (match, p1) => {
      const parts = p1.split(',').map(s => s.trim()).filter(Boolean);
      return `import { PageLayout, PageGrid, GridCol, ${parts.join(', ')} } from '@/components/shared';`;
    });
  }

  // Replace structure
  content = content.replace(/<div className="flex flex-1[^>]*>/, '<PageLayout>\n      <PageGrid>');
  
  // PageSidebar -> GridCol span={3}
  content = content.replace(/<PageSidebar([^>]*)>([\s\S]*?)<\/PageSidebar>/, (match, attrs, inner) => {
    // try to extract title and subtitle
    const titleMatch = attrs.match(/title="([^"]+)"/);
    const subtitleMatch = attrs.match(/subtitle="([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : '';
    const subtitle = subtitleMatch ? subtitleMatch[1] : '';
    
    let res = `<GridCol span={3}>\n          <Card>\n            <CardHeader title="${title}" ${subtitle ? `subtitle="${subtitle}"` : ''} />\n            <CardBody className="p-2 space-y-1">\n              ${inner}\n            </CardBody>\n          </Card>\n        </GridCol>`;
    return res;
  });

  // PageMain -> GridCol span={6} or span={9}
  // If there's a PageRight, span=6. Else span=9
  const hasPageRight = content.includes('<PageRight>');
  const mainSpan = hasPageRight ? 6 : 9;
  
  content = content.replace(/<PageMain>([\s\S]*?)<\/PageMain>/, `<GridCol span={${mainSpan}}>$1</GridCol>`);

  // PageRight -> GridCol span={3}
  content = content.replace(/<PageRight>([\s\S]*?)<\/PageRight>/, `<GridCol span={3}>\n          <Card>\n            <CardBody className="p-3 space-y-4">\n              $1\n            </CardBody>\n          </Card>\n        </GridCol>`);

  // End tags
  content = content.replace(/<\/div>\n\s*\);\n}/, '      </PageGrid>\n    </PageLayout>\n  );\n}');

  // Also replace `<PageSidebar title=...` if it was split on multiple lines (regex might miss it if attrs have newlines)
  
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated ${file}`);
}
