'use strict'
// Non-embedded Japanese CID fonts must render in the browser and desktop app.
// Generate anonymous fixtures instead of committing a user's survey drawing.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const assert = require('node:assert/strict')
const root = __dirname
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { stdio: 'inherit', windowsHide: true })
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, protocol } = require('electron')
app.on('window-all-closed', () => {})
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kozu-pdf-fonts-')))
protocol.registerSchemesAsPrivileged([{ scheme: 'pdfres', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }])

function fixture() {
  const hex = value => [...value].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  const stream = `BT /F0 20 Tf 20 120 Td <${hex('現況測量図')}> Tj ET\nBT /F1 20 Tf 20 70 Td <${hex('区画1 道路')}> Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 160] /Resources << /Font << /F0 4 0 R /F1 6 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /MS-Gothic /Encoding /UniJIS-UCS2-HW-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MS-Gothic /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 9 0 R /DW 1000 >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /MS-Mincho /Encoding /UniJIS-UCS2-H /DescendantFonts [7 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /MS-Mincho /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 10 0 R /DW 1000 >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /FontDescriptor /FontName /MS-Gothic /Flags 4 /FontBBox [-100 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>',
    '<< /Type /FontDescriptor /FontName /MS-Mincho /Flags 6 /FontBBox [-100 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>'
  ]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i+1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf).toString('base64')
}

app.whenReady().then(async () => {
  const requests = []
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    requests.push(pathname)
    const file = path.resolve(root, '.' + pathname)
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end() }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); return res.end() }
      const type = { '.js':'text/javascript', '.html':'text/html', '.css':'text/css' }[path.extname(file)] || 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': type }); res.end(data)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  protocol.handle('pdfres', request => {
    const url = new URL(request.url)
    try { return new Response(fs.readFileSync(path.join(root, 'node_modules/pdfjs-dist', url.host, path.basename(url.pathname)))) }
    catch { return new Response('missing', {status:404}) }
  })
  const checks = [], out = path.join(root, 'output')
  fs.mkdirSync(out, { recursive: true })
  try {
    for (const mode of ['browser','desktop']) {
      const logs = []
      const win = new BrowserWindow({show:false, webPreferences:{sandbox:false, backgroundThrottling:false, ...(mode === 'desktop' ? {preload:path.join(root,'preload-v210.js')} : {})}})
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 1 && /failed|error|unable/i.test(message)) logs.push(message) })
      try {
        if (mode === 'desktop') await win.loadFile(path.join(root,'index-v210.html'))
        else await win.loadURL(`http://127.0.0.1:${server.address().port}/index-v210.html`)
        const result = await win.webContents.executeJavaScript(`(async()=>{
          const K=window.KozuV210;
          const bytes=Uint8Array.from(atob(${JSON.stringify(fixture())}),c=>c.charCodeAt(0));
          const loaded=await K.IO.loadPdfBytes(bytes);
          const page=await loaded.runtime.pdf.getPage(1), text=await page.getTextContent();
          const rendered=await K.IO.renderPdfPage(loaded.runtime,1,{scale:2});
          const pixels=rendered.canvas.getContext('2d').getImageData(0,0,rendered.width,rendered.height).data;
          let dark=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100)dark++;
          const result={text:text.items.map(x=>x.str).join(' '),dark,desktop:Boolean(window.kozuDesktop),png:rendered.canvas.toDataURL()};
          await loaded.runtime.destroy();return result;
        })()`, true)
        assert.equal(result.desktop, mode === 'desktop')
        assert.ok(result.text.includes('現況測量図') && result.text.includes('道路'), 'Japanese CID text is missing')
        assert.ok(result.dark > 500, `Text glyphs were not painted: ${result.dark}`)
        assert.deepEqual(logs, [], 'Font loading emitted errors')
        if (mode === 'browser') {
          assert.ok(requests.includes('/node_modules/pdfjs-dist/cmaps/UniJIS-UCS2-HW-H.bcmap'))
          assert.ok(!requests.some(url => url.startsWith('/vendor/node_modules/')))
        }
        fs.writeFileSync(path.join(out, `qa-pdf-fonts-${mode}.png`), Buffer.from(result.png.split(',')[1], 'base64'))
        delete result.png; checks.push({mode,pass:true,...result}); console.log(`PASS ${mode}: ${result.dark} text pixels`)
      } finally { win.destroy() }
    }
    fs.writeFileSync(path.join(out,'qa-v210-pdf-fonts-report.json'),JSON.stringify({pass:true,checks},null,2))
  } finally { server.close() }
  process.exit(0)
}).catch(error => { console.error(error); process.exit(1) })
