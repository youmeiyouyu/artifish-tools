#!/usr/bin/env node
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const SUPABASE_URL = 'https://ipohnmmfgqpaosomfscn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AMvm24uVkmYTZ8vEgG6cLQ_UGrqahjv';

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(destPath);
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
  });
}

async function uploadToSupabase(localPath, fileName) {
  const fileBuffer = fs.readFileSync(localPath);
  const base64 = fileBuffer.toString('base64');
  
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/works/${fileName}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'image/png',
      'x-upsert': 'true'
    },
    body: fileBuffer
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload failed: ${text}`);
  }
  
  return `${SUPABASE_URL}/storage/v1/object/public/works/${fileName}`;
}

async function takeScreenshot(url, workId) {
  console.log(`Taking screenshot of: ${url}`);
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait a bit for any dynamic content
    await new Promise(r => setTimeout(r, 2000));
  } catch (err) {
    console.log('Page load warning:', err.message);
  }
  
  const screenshotPath = `/tmp/screenshot-${workId}.png`;
  await page.screenshot({ 
    path: screenshotPath, 
    type: 'png',
    fullPage: false 
  });
  
  await browser.close();
  
  // Generate filename
  const fileName = `thumbnail-${workId}-${Date.now()}.png`;
  
  // Upload to Supabase
  console.log('Uploading to Supabase...');
  const publicUrl = await uploadToSupabase(screenshotPath, fileName);
  
  // Cleanup
  fs.unlinkSync(screenshotPath);
  
  return publicUrl;
}

async function updateWorkThumbnail(workId, imageUrl) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/works?id=eq.${workId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ image_url: imageUrl })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Update failed: ${text}`);
  }
  
  console.log('Work thumbnail updated!');
}

async function main() {
  const workId = process.argv[2];
  const demoUrl = process.argv[3];
  
  if (!workId || !demoUrl) {
    console.log('Usage: node screenshot.js <work_id> <demo_url>');
    console.log('Example: node screenshot.js b704c40f-a67d-453b-8442-d0d613cec03b https://artifish-demos.pages.dev/artifish-form-final');
    process.exit(1);
  }
  
  try {
    const imageUrl = await takeScreenshot(demoUrl, workId);
    console.log('Screenshot URL:', imageUrl);
    
    await updateWorkThumbnail(workId, imageUrl);
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
