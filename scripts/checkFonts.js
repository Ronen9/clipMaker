const fs = require('fs');
const path = require('path');

const fontPath = path.join(process.cwd(), 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

if (!fs.existsSync(fontPath)) {
  console.error('Error: Required font file not found:', fontPath);
  console.error('Please ensure the font file is present before running the application.');
  process.exit(1);
}

console.log('Font file found:', fontPath);
