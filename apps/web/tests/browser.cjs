/* Run with npm run test:e2e while the web and audio services are running.
   The test audio is generated, never an example or simulated analysis response. */
const { chromium }=require('playwright');
const assert=require('node:assert/strict');
const baseUrl=process.env.CADENCE_TEST_URL || 'http://localhost:3000';
function makeWav(offset=0){
  const sr=22050, seq=[60,62,64,65,67,64,62,60], count=Math.round(sr*.46)*seq.length;
  const b=Buffer.alloc(44+count*2);b.write('RIFF',0);b.writeUInt32LE(36+count*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(sr,24);b.writeUInt32LE(sr*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);
  for(let i=0;i<count;i++){const n=Math.floor(i/Math.round(sr*.46)),t=(i%Math.round(sr*.46))/sr;const env=t<.4?Math.min(1,t/.025,(.4-t)/.035):0;const v=.45*env*Math.sin(2*Math.PI*440*2**((seq[n]+offset-69)/12)*t);b.writeInt16LE(Math.round(v*32767),44+i*2)}return b;
}
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['microphone']});const page=await ctx.newPage();let errors=[];page.on('pageerror',e=>errors.push(e.message));
 let interrupted=false;await page.route('**/api/jobs/*',async route=>{if(!interrupted && route.request().method()==='GET'){interrupted=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'temporary test outage'})})}else await route.continue()});
 try {
  await page.goto(baseUrl);await page.getByRole('tab',{name:'Upload a file'}).click();await page.locator('input[type=file]').setInputFiles({name:'fixture.wav',mimeType:'audio/wav',buffer:makeWav()});
  await page.getByRole('button',{name:'Analyse melody'}).click();await page.getByText('Notes & tonic solfa').waitFor({timeout:90000});
  assert.equal((await page.locator('.key-name').innerText()).replace(/\s+/g,' ').trim(),'Cmajor');
  assert.equal(await page.locator('.solfa-note').count(),8);assert.ok(interrupted,'polling should retry a temporary service error');
  await page.locator('.solfa-note').first().click();await page.getByLabel('Correct original pitch').selectOption('61');assert.match(await page.locator('.solfa-note').first().innerText(),/di/);
  await page.getByRole('button',{name:'Apply timing'}).click();await page.getByLabel('Target tonic').selectOption('7');
  await page.getByRole('button',{name:'Save project'}).click();await page.getByText('Saved on this device.').waitFor();
  await page.getByRole('button',{name:'Recent projects'}).click();await page.locator('.project-open').first().click();assert.match(await page.locator('.solfa-note').first().innerText(),/di/);assert.equal(await page.getByLabel('Target tonic').inputValue(),'7');
  await page.getByRole('button',{name:'Play section'}).click();await page.waitForTimeout(300);assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).count(),1);
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'Export text'}).click();assert.ok((await dl).suggestedFilename().endsWith('.txt'));
  const jsonDownload=page.waitForEvent('download');await page.getByRole('button',{name:'JSON',exact:true}).click();const jsonPath=await (await jsonDownload).path();const exported=JSON.parse(require('node:fs').readFileSync(jsonPath,'utf8'));assert.equal(exported.key.tonic,0);assert.equal(exported.referenceKey.tonic,0);assert.equal(exported.notes[0].confidence,null);assert.equal(exported.displayedNotes[0].midi,68);
  const midiDownload=page.waitForEvent('download');await page.getByRole('button',{name:'MIDI',exact:true}).click();const midi= require('node:fs').readFileSync(await (await midiDownload).path());assert.equal(midi.subarray(0,4).toString(),'MThd');
  await page.getByLabel('To (s)').fill('1.4');await page.getByRole('button',{name:'Analyse section'}).click();await page.waitForFunction(()=>document.querySelectorAll('.solfa-note').length<8,{timeout:60000});assert.ok(await page.locator('.solfa-note').count()>=2);
  await page.getByRole('button',{name:'New analysis'}).click();await page.getByRole('tab',{name:'Upload a file'}).click();await page.locator('input[type=file]').setInputFiles({name:'transposed.wav',mimeType:'audio/wav',buffer:makeWav(7)});await page.getByRole('button',{name:'Analyse melody'}).click();await page.getByText('Notes & tonic solfa').waitFor({timeout:90000});assert.equal((await page.locator('.key-name').innerText()).replace(/\s+/g,'').trim(),'Gmajor');await page.getByRole('button',{name:'Save project'}).click();await page.getByText('Saved on this device.').waitFor();await page.getByRole('button',{name:'Recent projects'}).click();const ids=await page.getByLabel('First recording').locator('option').evaluateAll(opts=>opts.slice(1).map(o=>o.value));await page.getByLabel('First recording').selectOption(ids[0]);await page.getByLabel('Second recording').selectOption(ids[0]);await page.getByText('Identical interval sequence').waitFor();await page.getByLabel('Second recording').selectOption(ids[1]);await page.getByText(/interval similarity/).waitFor();
  await page.getByRole('button',{name:'New analysis'}).click();await page.getByRole('tab',{name:'Record audio'}).click();await page.getByRole('button',{name:'Start recording',exact:true}).first().click();await page.getByText('Listening to you').waitFor({timeout:15000});await page.waitForTimeout(1200);await page.getByRole('button',{name:'Stop recording'}).click();await page.getByLabel('Preview recording').waitFor({timeout:10000});
  const mobile=await browser.newPage({viewport:{width:375,height:812}});await mobile.goto(baseUrl);await mobile.waitForTimeout(800);const widths=await mobile.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(widths[0]<=widths[1],`mobile horizontal overflow ${widths}`);await mobile.close();
  assert.deepEqual(errors,[]);console.log('Browser workflow passed: upload, real analysis, edit, transpose, local save/reopen, section playback, text/JSON/MIDI export, section analysis, two-project comparison, mock microphone, mobile viewport.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
