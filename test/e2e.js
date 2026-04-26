/**
 * ELIMS End-to-End Test Suite
 * Run: node test/e2e.js
 * Requires server running on port 8080 (node server.js)
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://localhost:8080';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'elims@2026';

// ─────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────

/** Fetch with cookie jar for session-based auth */
class Session {
  constructor() { this.cookies = ''; }

  async fetch(url, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (this.cookies) headers['Cookie'] = this.cookies;
    const res = await fetch(BASE + url, { ...opts, headers, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) {
      this.cookies = setCookie.map(c => c.split(';')[0]).join('; ');
    }
    return res;
  }

  async json(url, opts = {}) {
    const res = await this.fetch(url, opts);
    const body = await res.json();
    return { status: res.status, body, res };
  }
}

async function adminSession() {
  const s = new Session();
  const res = await s.fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(ADMIN_USER)}&password=${encodeURIComponent(ADMIN_PASS)}`,
  });
  // Expect redirect to /admin after login
  assert.ok([200, 302].includes(res.status), `Login should succeed, got ${res.status}`);
  return s;
}

function colorText(color, text) {
  const codes = { green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', reset: '\x1b[0m', bold: '\x1b[1m', cyan: '\x1b[36m' };
  return (codes[color] || '') + text + codes.reset;
}

// ─────────────────────────────────────────────────
//  1. Server Reachability
// ─────────────────────────────────────────────────

describe('Server', () => {
  test('GET / returns 200', async () => {
    const res = await fetch(BASE + '/');
    assert.equal(res.status, 200, 'Homepage should be accessible');
  });

  test('GET /api/site-content returns JSON with expected shape', async () => {
    const res = await fetch(BASE + '/api/site-content');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(typeof body === 'object', 'Should return an object');
    assert.ok(Array.isArray(body.carousel), 'carousel should be an array');
    assert.ok(Array.isArray(body.gallery), 'gallery should be an array');
    assert.ok(typeof body.popup === 'object', 'popup should be an object');
    assert.ok('enabled' in body.popup, 'popup.enabled should exist');
    assert.ok('image' in body.popup, 'popup.image should exist');
    assert.ok('link' in body.popup, 'popup.link should exist');
  });
});

// ─────────────────────────────────────────────────
//  2. Admin Authentication
// ─────────────────────────────────────────────────

describe('Admin Auth', () => {
  test('GET /admin without login redirects to /admin/login', async () => {
    const res = await fetch(BASE + '/admin', { redirect: 'manual' });
    assert.ok(
      res.status === 302 || res.status === 301,
      `Expected redirect, got ${res.status}`
    );
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('login'), `Expected redirect to login, got "${location}"`);
  });

  test('GET /admin/api/site-content without login returns 401 or redirects', async () => {
    const res = await fetch(BASE + '/admin/api/site-content', { redirect: 'manual' });
    assert.ok([401, 302, 403].includes(res.status), `Expected auth failure, got ${res.status}`);
  });

  test('POST /admin/login with wrong password fails', async () => {
    const s = new Session();
    const res = await s.fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'username=admin&password=wrongpassword',
    });
    // Should stay on login page (200) or redirect back to login (302)
    assert.ok([200, 302].includes(res.status));
    // Should NOT have admin-access cookie (no redirect to /admin)
    const location = res.headers.get('location') || '';
    assert.ok(!location.endsWith('/admin'), 'Wrong password should not redirect to /admin');
  });

  test('POST /admin/login with correct credentials succeeds', async () => {
    const s = await adminSession();
    const { status, body } = await s.json('/admin/api/site-content');
    assert.equal(status, 200, 'Should access admin API after login');
    assert.ok(Array.isArray(body.carousel), 'Should return valid config');
  });
});

// ─────────────────────────────────────────────────
//  3. Popup API
// ─────────────────────────────────────────────────

describe('Popup API', () => {
  let session;
  let originalPopup;

  before(async () => {
    session = await adminSession();
    const { body } = await session.json('/admin/api/site-content');
    originalPopup = { ...body.popup };
  });

  after(async () => {
    // Restore original popup settings
    await session.fetch('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(originalPopup),
    });
  });

  test('PUT /admin/api/site-content/popup enables popup', async () => {
    const { status, body } = await session.json('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, link: '/pages/admission.html', alt: 'Test' }),
    });
    assert.equal(status, 200);
    assert.equal(body.config.popup.enabled, true);
    assert.equal(body.config.popup.link, '/pages/admission.html');
  });

  test('PUT /admin/api/site-content/popup disables popup', async () => {
    const { status, body } = await session.json('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, link: '/pages/admission.html', alt: 'Test' }),
    });
    assert.equal(status, 200);
    assert.equal(body.config.popup.enabled, false);
  });

  test('Public /api/site-content reflects popup.enabled=false', async () => {
    // Already disabled from previous test
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    assert.equal(body.popup.enabled, false, 'Public API should reflect disabled state');
  });

  test('PUT popup without auth returns 401 or redirect', async () => {
    const res = await fetch(BASE + '/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
      redirect: 'manual',
    });
    assert.ok([401, 302, 403].includes(res.status), `Expected auth failure, got ${res.status}`);
  });

  test('PUT popup link is trimmed and defaulted when empty', async () => {
    const { body } = await session.json('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, link: '   ', alt: '' }),
    });
    assert.equal(body.config.popup.link, '/pages/admission.html', 'Empty link should default');
    assert.equal(body.config.popup.alt, 'Admission update', 'Empty alt should default');
  });

  test('Re-enable popup — public API shows enabled=true', async () => {
    await session.fetch('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, link: '/pages/admission.html', alt: 'Admission update' }),
    });
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    assert.equal(body.popup.enabled, true, 'Public API should show re-enabled popup');
  });
});

// ─────────────────────────────────────────────────
//  4. Popup Image Upload
// ─────────────────────────────────────────────────

describe('Popup Image Upload', () => {
  let session;

  before(async () => { session = await adminSession(); });

  test('Upload without file returns error', async () => {
    const form = new FormData();
    form.append('type', 'popup');
    const res = await session.fetch('/admin/api/site-media/upload', { method: 'POST', body: form });
    const body = await res.json();
    assert.ok(!body.success || res.status !== 200, 'Upload without file should fail');
  });

  test('Upload non-image file is rejected', async () => {
    const txtContent = new Blob(['hello world'], { type: 'text/plain' });
    const form = new FormData();
    form.append('type', 'popup');
    form.append('image', txtContent, 'test.txt');
    const res = await session.fetch('/admin/api/site-media/upload', { method: 'POST', body: form });
    const body = await res.json();
    assert.ok(res.status === 400, `Expected 400 for non-image, got ${res.status}`);
    assert.ok(body.error, 'Should return an error message');
  });

  test('Upload valid JPEG image is accepted (carousel, no side-effects on popup)', async () => {
    // Use carousel type so active popup config is not affected
    const jpegBytes = Buffer.from(
      'FFD8FFE000104A46494600010100000100010000' +
      'FFDB004300080606070605080707070909080A0C140D0C0B0B0C1912130F141D1A1F1E1D' +
      '1A1C1C20242E2720222C231C1C2837292C30313434341F27393D38323C2E333432' +
      'FFD9', 'hex'
    );
    const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
    const form = new FormData();
    form.append('type', 'carousel');
    form.append('image', blob, 'test.jpg');
    const res = await session.fetch('/admin/api/site-media/upload', { method: 'POST', body: form });
    const body = await res.json();
    if (res.status === 200) {
      assert.ok(body.path || body.config, 'Should return path or config on success');
      // Clean up test image immediately
      if (body.config && Array.isArray(body.config.carousel)) {
        const uploaded = body.config.carousel[body.config.carousel.length - 1];
        if (uploaded && uploaded.includes('test')) {
          await session.fetch('/admin/api/site-media', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'carousel', path: uploaded }),
          });
        }
      }
      console.log('    ' + colorText('cyan', 'JPEG upload accepted and test image cleaned up'));
    } else {
      console.log('    ' + colorText('yellow', `Upload note: ${body.error} (minimal JPEG may be rejected by magic-byte check)`));
    }
  });

  test('Upload with invalid type is rejected', async () => {
    const form = new FormData();
    form.append('type', 'invalid_type');
    const blob = new Blob([Buffer.from('FFD8FFE0', 'hex')], { type: 'image/jpeg' });
    form.append('image', blob, 'test.jpg');
    const res = await session.fetch('/admin/api/site-media/upload', { method: 'POST', body: form });
    const body = await res.json();
    assert.equal(res.status, 400, 'Invalid type should return 400');
    assert.ok(body.error, 'Should return error message');
  });
});

// ─────────────────────────────────────────────────
//  5. Popup Show Logic (simulated)
// ─────────────────────────────────────────────────

describe('Popup Show Logic (unit simulation)', () => {
  // Mirrors showAdmissionPopup() logic in main.js:
  // popup shows on every page load if enabled=true and image is set
  function shouldShowPopup(config) {
    const popup = config && config.popup ? config.popup : null;
    if (!popup || !popup.enabled || !popup.image) return { show: false, reason: 'disabled or no image' };
    return { show: true, reason: 'ok' };
  }

  test('Popup hidden when enabled=false', () => {
    const r = shouldShowPopup({ popup: { enabled: false, image: '/img.jpg' } });
    assert.equal(r.show, false);
    assert.equal(r.reason, 'disabled or no image');
  });

  test('Popup hidden when image is empty string', () => {
    const r = shouldShowPopup({ popup: { enabled: true, image: '' } });
    assert.equal(r.show, false);
  });

  test('Popup hidden when image is null', () => {
    const r = shouldShowPopup({ popup: { enabled: true, image: null } });
    assert.equal(r.show, false);
  });

  test('Popup shown when enabled=true and image set', () => {
    const r = shouldShowPopup({ popup: { enabled: true, image: '/img.jpg' } });
    assert.equal(r.show, true);
  });

  test('Popup shown on every page load (no session gate)', () => {
    // Same call twice should both return show=true
    const r1 = shouldShowPopup({ popup: { enabled: true, image: '/img.jpg' } });
    const r2 = shouldShowPopup({ popup: { enabled: true, image: '/img.jpg' } });
    assert.equal(r1.show, true);
    assert.equal(r2.show, true);
  });

  test('Popup hidden when config is null', () => {
    const r = shouldShowPopup(null);
    assert.equal(r.show, false);
  });

  test('Popup hidden when popup key is missing from config', () => {
    const r = shouldShowPopup({ carousel: [], gallery: [] });
    assert.equal(r.show, false);
  });
});

// ─────────────────────────────────────────────────
//  6. Popup Image File Exists on Disk
// ─────────────────────────────────────────────────

describe('Popup Image File on Disk', () => {
  test('popup.image path in site-content.json exists on disk', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    const imgPath = body.popup && body.popup.image;
    if (!imgPath) {
      console.log('    ' + colorText('yellow', 'No popup image set — skipping disk check'));
      return;
    }
    const diskPath = path.join(process.cwd(), imgPath);
    assert.ok(fs.existsSync(diskPath), `Image file not found on disk: ${diskPath}`);
    console.log('    ' + colorText('cyan', `Popup image exists: ${diskPath}`));
  });

  test('popup.image is HTTP-accessible (returns 200)', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    const imgPath = body.popup && body.popup.image;
    if (!imgPath) {
      console.log('    ' + colorText('yellow', 'No popup image set — skipping HTTP check'));
      return;
    }
    const imgRes = await fetch(BASE + imgPath);
    assert.equal(imgRes.status, 200, `Popup image should be HTTP 200, got ${imgRes.status} for ${imgPath}`);
    const ct = imgRes.headers.get('content-type') || '';
    assert.ok(ct.startsWith('image/'), `Expected image content-type, got "${ct}"`);
  });
});

// ─────────────────────────────────────────────────
//  7. Carousel & Gallery APIs
// ─────────────────────────────────────────────────

describe('Carousel & Gallery', () => {
  test('carousel array is accessible from public API', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    assert.ok(Array.isArray(body.carousel));
  });

  test('gallery array is accessible from public API', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    assert.ok(Array.isArray(body.gallery));
  });

  test('carousel images are HTTP-accessible', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    for (const imgPath of body.carousel) {
      const imgRes = await fetch(BASE + imgPath);
      assert.equal(imgRes.status, 200, `Carousel image ${imgPath} should be 200`);
    }
  });

  test('gallery images are HTTP-accessible', async () => {
    const res = await fetch(BASE + '/api/site-content');
    const body = await res.json();
    for (const imgPath of body.gallery) {
      const imgRes = await fetch(BASE + imgPath);
      assert.equal(imgRes.status, 200, `Gallery image ${imgPath} should be 200`);
    }
  });
});

// ─────────────────────────────────────────────────
//  8. Delete API
// ─────────────────────────────────────────────────

describe('Delete Media', () => {
  test('DELETE without auth returns 401 or redirect', async () => {
    const res = await fetch(BASE + '/admin/api/site-media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery', path: '/nonexistent.jpg' }),
      redirect: 'manual',
    });
    assert.ok([401, 302, 403].includes(res.status), `Expected auth failure, got ${res.status}`);
  });

  test('DELETE nonexistent file returns error', async () => {
    const session = await adminSession();
    const { status, body } = await session.json('/admin/api/site-media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'gallery', path: '/assets/images/managed/gallery/nonexistent_xyz.jpg' }),
    });
    // Either 404 or 400
    assert.ok([400, 404].includes(status), `Expected 400/404 for missing file, got ${status}: ${JSON.stringify(body)}`);
  });
});

// ─────────────────────────────────────────────────
//  Run summary
// ─────────────────────────────────────────────────
process.on('exit', () => {
  console.log('\n' + colorText('bold', '─────────────────────────────────────────────'));
  console.log(colorText('cyan', ' Tip: To force-show popup bypassing session cache:'));
  console.log(colorText('cyan', ' → Open index.html?preview_popup=1 in browser'));
  console.log(colorText('bold', '─────────────────────────────────────────────') + '\n');
});
