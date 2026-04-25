'use strict';

/**
 * ELIMS College of Pharmacy — Online Admission Server
 * Serves the static site, handles form submissions, and provides an admin panel.
 *
 * Run:  node server.js       (or: npm start)
 *
 * Environment variables (optional):
 *   PORT           — HTTP port (default 8080)
 *   ADMIN_USER     — Admin username (default: admin)
 *   ADMIN_PASS     — Admin password (default: elims@2026)  ← CHANGE IN PRODUCTION
 *   SESSION_SECRET — Cookie signing secret (auto-generated if not set)
 *   SMTP_HOST      — SMTP hostname (default: smtp.gmail.com)
 *   SMTP_PORT      — SMTP port (default: 587)
 *   SMTP_USER      — SMTP username / sender email
 *   SMTP_PASS      — SMTP password / app password
 */

const express    = require('express');
const session    = require('express-session');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');

/* ────────────────────────────────────────────────────────
   EMAIL CONFIG — update before deploying to production
   ──────────────────────────────────────────────────────── */
const EMAIL_CONFIG = {
  host:    process.env.SMTP_HOST || 'smtp.gmail.com',
  port:    parseInt(process.env.SMTP_PORT  || '587', 10),
  secure:  false,
  auth: {
    user: process.env.SMTP_USER || 'elimspharmacy@gmail.com',
    pass: process.env.SMTP_PASS || '',
  },
};
const ADMIN_EMAIL  = 'elimspharmacy@gmail.com';
const FROM_ADDRESS = '"ELIMS Admissions" <noreply@elimspharmacycollege.com>';
const REPLY_TO     = ADMIN_EMAIL;

/* ────────────────────────────────────────────────────────
   ADMIN CREDENTIALS
   ──────────────────────────────────────────────────────── */
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'elims@2026';

/* ────────────────────────────────────────────────────────
   DATA STORAGE — applications persisted as JSON
   ──────────────────────────────────────────────────────── */
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'applications.json');
const SITE_FILE = path.join(DATA_DIR, 'site-content.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

function getDefaultSiteContent() {
  const popupCandidates = [
    'assets/images/pop_image.webp',
    'assets/images/pop_image.png',
    'assets/images/pop_image.jpg',
    'assets/images/pop_image.jpeg',
  ];
  const popupImage = popupCandidates.find(rel => fs.existsSync(path.join(__dirname, rel))) || '';

  return {
    carousel: [],
    gallery: [],
    popup: {
      enabled: Boolean(popupImage),
      image: popupImage,
      link: '/pages/admission.html',
      alt: 'Admission update',
    },
  };
}

if (!fs.existsSync(SITE_FILE)) {
  fs.writeFileSync(SITE_FILE, JSON.stringify(getDefaultSiteContent(), null, 2), 'utf8');
}

function loadApplications() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function saveApplication(appData) {
  const apps = loadApplications();
  const idx  = apps.findIndex(a => a.application_number === appData.application_number);
  if (idx >= 0) apps[idx] = { ...apps[idx], ...appData };
  else apps.push(appData);
  fs.writeFileSync(DATA_FILE, JSON.stringify(apps, null, 2), 'utf8');
}

function loadSiteContent() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'));
    return {
      carousel: Array.isArray(parsed.carousel) ? parsed.carousel : [],
      gallery: Array.isArray(parsed.gallery) ? parsed.gallery : [],
      popup: {
        enabled: Boolean(parsed.popup && parsed.popup.enabled),
        image: parsed.popup && typeof parsed.popup.image === 'string' ? parsed.popup.image : '',
        link: parsed.popup && typeof parsed.popup.link === 'string' ? parsed.popup.link : '/pages/admission.html',
        alt: parsed.popup && typeof parsed.popup.alt === 'string' ? parsed.popup.alt : 'Admission update',
      },
    };
  } catch {
    return getDefaultSiteContent();
  }
}

function saveSiteContent(data) {
  fs.writeFileSync(SITE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/* ────────────────────────────────────────────────────────
   SERVER SETUP
   ──────────────────────────────────────────────────────── */
const app  = express();
const PORT = process.env.PORT || 8080;

/* ── Session middleware ── */
app.use(session({
  secret:            process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave:            false,
  saveUninitialized: false,
  cookie:            { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 },
}));

/* ── Body parsers (for admin login form) ── */
app.use('/admin/login', express.urlencoded({ extended: false }));

/* ── Protect /uploads from direct public access ── */
app.use('/uploads', (req, res) => res.status(403).send('Forbidden'));

/* ── Serve static files (public site) ── */
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  dotfiles: 'deny',
}));

/* ────────────────────────────────────────────────────────
   MIME VALIDATION via magic bytes (no extra dependency)
   ──────────────────────────────────────────────────────── */
const MAGIC = {
  pdf:  Buffer.from([0x25, 0x50, 0x44, 0x46]),             // %PDF
  png:  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  jpeg: Buffer.from([0xFF, 0xD8, 0xFF]),
};

function detectMime(filePath) {
  const buf = Buffer.alloc(8);
  const fd  = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  if (buf.slice(0, 4).equals(MAGIC.pdf))  return 'application/pdf';
  if (buf.slice(0, 8).equals(MAGIC.png))  return 'image/png';
  if (buf.slice(0, 3).equals(MAGIC.jpeg)) return 'image/jpeg';
  return null;
}

function mimeToExt(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'image/png')       return 'png';
  return 'jpg';
}

/* ────────────────────────────────────────────────────────
   MULTER — temp storage, then validated & moved
   ──────────────────────────────────────────────────────── */
const TMP_DIR = path.join(__dirname, 'uploads', 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const SITE_MEDIA_BASE = path.join(__dirname, 'assets', 'images', 'managed');
const SITE_MEDIA_DIRS = {
  carousel: path.join(SITE_MEDIA_BASE, 'carousel'),
  gallery:  path.join(SITE_MEDIA_BASE, 'gallery'),
  popup:    path.join(SITE_MEDIA_BASE, 'popup'),
};
Object.values(SITE_MEDIA_DIRS).forEach(dir => fs.mkdirSync(dir, { recursive: true }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TMP_DIR),
  filename:    (_req,  file, cb) =>
    cb(null, `${file.fieldname}_${crypto.randomBytes(8).toString('hex')}`),
});

const UPLOAD_FIELDS = [
  { name: 'applicant_photo',    maxCount: 1 },
  { name: 'doc_allotment_memo', maxCount: 1 },
  { name: 'doc_fee_receipt',    maxCount: 1 },
  { name: 'doc_mark_list',      maxCount: 1 },
  { name: 'doc_tc',             maxCount: 1 },
  { name: 'doc_migration',      maxCount: 1 },
  { name: 'doc_eligibility',    maxCount: 1 },
  { name: 'doc_caste',          maxCount: 1 },
  { name: 'doc_pharmacy_reg',   maxCount: 1 },
  { name: 'doc_fitness',        maxCount: 1 },
  { name: 'doc_vaccination',    maxCount: 1 },
  { name: 'doc_photos',         maxCount: 10 },
  { name: 'doc_additional',     maxCount: 10 },
];

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },   // 2 MB per file
}).fields(UPLOAD_FIELDS);

/* ────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────── */
function cleanText(val) {
  if (typeof val !== 'string') return '';
  return val.trim().replace(/[<>"'&]/g, c => ({
    '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;',
  }[c]));
}

function jsonResp(res, success, message, appNo = '') {
  return res.json({ success, message, application_number: appNo });
}

function toPublicPath(absPath) {
  const rel = path.relative(__dirname, absPath).replace(/\\/g, '/');
  return rel.startsWith('/') ? rel : `/${rel}`;
}

function isManagedMediaPath(relPath) {
  return typeof relPath === 'string' && relPath.startsWith('/assets/images/managed/');
}

/**
 * Validate MIME, move file from tmp → destDir with a safe name.
 * Returns the saved filename or null.
 */
function saveUpload(file, destDir, fieldName) {
  const mime = detectMime(file.path);
  if (!mime) {
    fs.unlinkSync(file.path);
    return null;
  }
  const ext      = mimeToExt(mime);
  const safeName = `${fieldName}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const dest     = path.join(destDir, safeName);
  fs.renameSync(file.path, dest);
  return safeName;
}

/* ────────────────────────────────────────────────────────
   POST /submit-application  (also accepts .php path)
   ──────────────────────────────────────────────────────── */
function handleSubmit(req, res) {
  const body  = req.body  || {};
  const files = req.files || {};

  /* Required fields */
  const REQUIRED = [
    'application_number', 'course_applied_for', 'quota',
    'full_name', 'date_of_birth', 'gender', 'nationality',
    'category', 'email',
    'comm_address', 'comm_district', 'comm_state', 'comm_pin', 'comm_phone',
    'parent_name', 'relationship', 'parent_phone',
    'pcb_percentage',
    'applicant_signature', 'parent_signature', 'declaration_date', 'declaration_place',
  ];
  const errors = REQUIRED.filter(f => !body[f] || !String(body[f]).trim());
  if (errors.length) {
    return jsonResp(res, false, `Missing required fields: ${errors.join(', ')}`);
  }

  /* Validate email */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return jsonResp(res, false, 'Invalid email address.');
  }

  /* Validate PIN */
  if (!/^\d{6}$/.test(body.comm_pin)) {
    return jsonResp(res, false, 'Invalid PIN code (must be 6 digits).');
  }

  /* Validate Aadhaar if provided */
  if (body.aadhaar_number) {
    const aadhaar = body.aadhaar_number.replace(/\s/g, '');
    if (!/^\d{12}$/.test(aadhaar)) {
      return jsonResp(res, false, 'Invalid Aadhaar number (must be 12 digits).');
    }
  }

  /* Validate declaration */
  if (!body.agree_declaration) {
    return jsonResp(res, false, 'Declaration must be accepted.');
  }

  /* Validate & sanitise application number — prevent path traversal */
  const appNo = String(body.application_number).trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(appNo)) {
    return jsonResp(res, false, 'Invalid application number format.');
  }

  /* Create upload directory */
  const appDir = path.join(__dirname, 'uploads', 'applications', appNo);
  try {
    fs.mkdirSync(appDir, { recursive: true });
  } catch {
    return jsonResp(res, false, 'Server error: could not create upload directory.');
  }

  /* Process uploaded files */
  const savedFiles = {};
  const SINGLE_DOCS = [
    'applicant_photo', 'doc_allotment_memo', 'doc_fee_receipt',
    'doc_mark_list', 'doc_tc', 'doc_migration', 'doc_eligibility',
    'doc_caste', 'doc_pharmacy_reg', 'doc_fitness', 'doc_vaccination',
  ];

  for (const field of SINGLE_DOCS) {
    if (files[field] && files[field][0]) {
      savedFiles[field] = saveUpload(files[field][0], appDir, field) || 'upload_failed';
    }
  }

  for (const field of ['doc_photos', 'doc_additional']) {
    if (files[field] && files[field].length) {
      savedFiles[field] = files[field]
        .map((f, i) => saveUpload(f, appDir, `${field}_${i}`))
        .filter(Boolean);
    }
  }

  /* Clean all text fields */
  const TEXT_FIELDS = [
    'application_number', 'course_applied_for', 'quota',
    'full_name', 'date_of_birth', 'age', 'gender', 'blood_group',
    'aadhaar_number', 'religion', 'caste_or_community', 'category',
    'email', 'nationality', 'place_of_birth',
    'comm_address', 'comm_district', 'comm_state', 'comm_pin', 'comm_phone',
    'perm_address', 'perm_district', 'perm_state', 'perm_pin', 'perm_phone',
    'keam_rank', 'gpat_score', 'entrance_roll_no',
    'dpharm_yr1', 'dpharm_yr2', 'dpharm_total_max', 'dpharm_total_scored', 'dpharm_percentage',
    'pcb_percentage',
    'parent_name', 'relationship', 'occupation', 'designation',
    'annual_income', 'official_address', 'parent_phone', 'parent_email',
    'scholarship_details', 'hostel_required', 'scholarship_received',
    'applicant_signature', 'parent_signature', 'declaration_date', 'declaration_place',
  ];
  const d = {};
  for (const f of TEXT_FIELDS) d[f] = cleanText(body[f] || '');

  /* Build email body */
  const sep  = '='.repeat(60);
  const sep2 = '-'.repeat(60);

  let emailBody = `ELIMS College of Pharmacy — Online Admission Application\n${sep}\n\n`;
  emailBody += `APPLICATION NUMBER : ${d.application_number}\n`;
  emailBody += `COURSE             : ${d.course_applied_for}\n`;
  emailBody += `QUOTA              : ${d.quota}\n\n`;

  emailBody += `── PERSONAL DETAILS ──\n`;
  emailBody += `Name        : ${d.full_name}\n`;
  emailBody += `DOB         : ${d.date_of_birth}   Age: ${d.age}\n`;
  emailBody += `Gender      : ${d.gender}\n`;
  emailBody += `Blood Group : ${d.blood_group}\n`;
  emailBody += `Aadhaar     : ${d.aadhaar_number}\n`;
  emailBody += `Category    : ${d.category}   Religion: ${d.religion}\n`;
  emailBody += `Caste       : ${d.caste_or_community}\n`;
  emailBody += `Nationality : ${d.nationality}\n`;
  emailBody += `Email       : ${d.email}\n`;
  emailBody += `Phone       : ${d.comm_phone}\n\n`;

  emailBody += `── ADDRESS ──\n`;
  emailBody += `Communication: ${d.comm_address}, ${d.comm_district}, ${d.comm_state} — ${d.comm_pin}\n`;
  if (body.same_address) {
    emailBody += `Permanent    : Same as communication address\n\n`;
  } else {
    emailBody += `Permanent    : ${d.perm_address}, ${d.perm_district}, ${d.perm_state} — ${d.perm_pin}\n\n`;
  }

  emailBody += `── ACADEMIC RECORDS ──\n`;
  if (Array.isArray(body.acad)) {
    for (const row of body.acad) {
      const exam = cleanText(row.exam || '');
      if (exam) {
        emailBody += `${exam}: ${cleanText(row.board || '')} (${cleanText(row.year || '')}) — ${cleanText(row.percentage || '')}%\n`;
      }
    }
  }
  emailBody += `\nPCB/PCM % : ${d.pcb_percentage}%\n\n`;

  emailBody += `── ENTRANCE EXAM ──\n`;
  emailBody += `KEAM Rank : ${d.keam_rank}\n`;
  emailBody += `GPAT Score: ${d.gpat_score}\n`;
  emailBody += `Roll No.  : ${d.entrance_roll_no}\n\n`;

  emailBody += `── PARENT / GUARDIAN ──\n`;
  emailBody += `Name          : ${d.parent_name} (${d.relationship})\n`;
  emailBody += `Occupation    : ${d.occupation}, ${d.designation}\n`;
  emailBody += `Annual Income : ₹${d.annual_income}\n`;
  emailBody += `Phone         : ${d.parent_phone}\n`;
  emailBody += `Email         : ${d.parent_email}\n\n`;

  emailBody += `── OTHER ──\n`;
  emailBody += `Hostel Required : ${body.hostel_required ? 'Yes' : 'No'}\n`;
  emailBody += `Scholarship     : ${body.scholarship_received ? 'Yes — ' + d.scholarship_details : 'No'}\n\n`;

  emailBody += `── DECLARATION ──\n`;
  emailBody += `Applicant Signature : ${d.applicant_signature}\n`;
  emailBody += `Parent Signature    : ${d.parent_signature}\n`;
  emailBody += `Date / Place        : ${d.declaration_date}, ${d.declaration_place}\n\n`;

  emailBody += `── UPLOADED FILES ──\n`;
  for (const [field, file] of Object.entries(savedFiles)) {
    emailBody += `${field}: ${Array.isArray(file) ? file.join(', ') : file}\n`;
  }
  emailBody += `\nFiles saved to: uploads/applications/${appNo}/\n`;
  emailBody += `${sep2}\nThis is an automated notification from the ELIMS online admission system.\n`;

  /* Send emails */
  const transporter = nodemailer.createTransport(EMAIL_CONFIG);

  const adminMail = {
    from:    FROM_ADDRESS,
    replyTo: d.email,
    to:      ADMIN_EMAIL,
    subject: `[Online Application] ${d.course_applied_for} — ${d.full_name} (${appNo})`,
    text:    emailBody,
  };

  const confirmMail = {
    from:    FROM_ADDRESS,
    replyTo: REPLY_TO,
    to:      d.email,
    subject: `Application Received — ${appNo} | ELIMS College of Pharmacy`,
    text:    [
      `Dear ${d.full_name},`,
      '',
      'Thank you for applying to ELIMS College of Pharmacy, Thrissur.',
      '',
      'Your application has been received successfully.',
      '',
      `Application Number : ${appNo}`,
      `Course Applied For : ${d.course_applied_for}`,
      `Quota              : ${d.quota}`,
      '',
      'Please keep this number for future reference and follow-up.',
      '',
      'The admissions office will review your application and contact you at:',
      `Phone : ${d.comm_phone}`,
      `Email : ${d.email}`,
      '',
      'For queries:',
      'Phone : +91 (0) 487 296 5395 / +91 79075 55133',
      'Email : elimspharmacy@gmail.com',
      '',
      'Warm regards,',
      'Admissions Office',
      'ELIMS College of Pharmacy',
      'Ramavarmapuram P O, Villadam, Thrissur — 680631, Kerala',
    ].join('\n'),
  };

  /* Fire-and-forget emails; don't fail the user if email fails */
  transporter.sendMail(adminMail).catch(err =>
    console.error('Admin email error:', err.message)
  );
  transporter.sendMail(confirmMail).catch(err =>
    console.error('Confirm email error:', err.message)
  );

  /* Persist application to data store */
  saveApplication({
    application_number: appNo,
    submitted_at:       new Date().toISOString(),
    status:             'pending',
    ...d,
    same_address:        !!body.same_address,
    hostel_required:     !!body.hostel_required,
    scholarship_received: !!body.scholarship_received,
    acad:                Array.isArray(body.acad) ? body.acad.map(r => ({
      exam:       cleanText(r.exam || ''),
      board:      cleanText(r.board || ''),
      year:       cleanText(r.year || ''),
      percentage: cleanText(r.percentage || ''),
    })) : [],
    uploaded_files: savedFiles,
  });

  return jsonResp(res, true, 'Application submitted successfully.', appNo);
}

app.post('/submit-application',     (req, res) => upload(req, res, err => {
  if (err) return jsonResp(res, false, `Upload error: ${err.message}`);
  handleSubmit(req, res);
}));

// Also accept requests to the old .php path so existing links keep working
app.post('/submit-application.php', (req, res) => upload(req, res, err => {
  if (err) return jsonResp(res, false, `Upload error: ${err.message}`);
  handleSubmit(req, res);
}));

/* ────────────────────────────────────────────────────────
   SITE CONTENT APIs (carousel, gallery, popup)
   ──────────────────────────────────────────────────────── */
app.get('/api/site-content', (_req, res) => {
  res.json(loadSiteContent());
});

const siteMediaUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
}).single('image');

app.get('/admin/api/site-content', requireAdmin, (_req, res) => {
  res.json(loadSiteContent());
});

app.put('/admin/api/site-content/popup', requireAdmin, express.json(), (req, res) => {
  const body = req.body || {};
  const config = loadSiteContent();
  config.popup.enabled = Boolean(body.enabled);
  if (typeof body.link === 'string') config.popup.link = body.link.trim() || '/pages/admission.html';
  if (typeof body.alt === 'string') config.popup.alt = body.alt.trim() || 'Admission update';
  saveSiteContent(config);
  res.json({ success: true, config });
});

app.post('/admin/api/site-media/upload', requireAdmin, (req, res) => {
  siteMediaUpload(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    const type = String((req.body && req.body.type) || '').trim();
    if (!['carousel', 'gallery', 'popup'].includes(type)) {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid media type' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const mime = detectMime(req.file.path);
    if (!mime || !mime.startsWith('image/')) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Only JPG/PNG images are allowed' });
    }

    const ext = mimeToExt(mime);
    const safeName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const dest = path.join(SITE_MEDIA_DIRS[type], safeName);
    fs.renameSync(req.file.path, dest);
    const publicPath = toPublicPath(dest);

    const config = loadSiteContent();
    if (type === 'popup') {
      config.popup.image = publicPath;
      config.popup.enabled = true;
    } else {
      config[type].push(publicPath);
    }
    saveSiteContent(config);

    return res.json({ success: true, path: publicPath, config });
  });
});

app.delete('/admin/api/site-media', requireAdmin, express.json(), (req, res) => {
  const body = req.body || {};
  const type = String(body.type || '').trim();
  const relPath = String(body.path || '').trim();
  if (!['carousel', 'gallery', 'popup'].includes(type)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }
  if (!isManagedMediaPath(relPath)) {
    return res.status(400).json({ error: 'Invalid media path' });
  }

  const config = loadSiteContent();
  if (type === 'popup') {
    if (config.popup.image === relPath) config.popup.image = '';
  } else {
    config[type] = config[type].filter(p => p !== relPath);
  }
  saveSiteContent(config);

  const abs = path.resolve(__dirname, '.' + relPath);
  const managedBase = path.resolve(__dirname, 'assets/images/managed');
  if (abs.startsWith(managedBase + path.sep) && fs.existsSync(abs)) {
    fs.unlinkSync(abs);
  }

  return res.json({ success: true, config });
});

/* ────────────────────────────────────────────────────────
   ADMIN PANEL
   ──────────────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminLoggedIn) return next();
  res.redirect('/admin/login');
}

/* Login page */
app.get('/admin/login', (req, res) => {
  if (req.session && req.session.adminLoggedIn) return res.redirect('/admin');
  const err = req.session.loginError || '';
  delete req.session.loginError;
  res.send(adminLoginHTML(err));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.adminLoggedIn = true;
    res.redirect('/admin');
  } else {
    req.session.loginError = 'Invalid username or password.';
    res.redirect('/admin/login');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* Dashboard */
app.get('/admin', requireAdmin, (_req, res) => res.send(adminDashboardHTML()));
app.get('/admin/site', requireAdmin, (_req, res) => res.send(adminSiteHTML()));

/* API — list all applications */
app.get('/admin/api/applications', requireAdmin, (_req, res) => {
  const apps = loadApplications().map(a => ({
    application_number: a.application_number,
    submitted_at:       a.submitted_at,
    status:             a.status || 'pending',
    full_name:          a.full_name,
    course_applied_for: a.course_applied_for,
    quota:              a.quota,
    email:              a.email,
    comm_phone:         a.comm_phone,
    gender:             a.gender,
    category:           a.category,
  }));
  res.json(apps);
});

/* API — get single application detail */
app.get('/admin/api/applications/:appNo', requireAdmin, (req, res) => {
  const appNo = req.params.appNo.toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(appNo)) return res.status(400).json({ error: 'Invalid id' });
  const app = loadApplications().find(a => a.application_number === appNo);
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json(app);
});

/* API — update status */
app.post('/admin/api/applications/:appNo/status', requireAdmin,
  express.json(),
  (req, res) => {
    const appNo = req.params.appNo.toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(appNo)) return res.status(400).json({ error: 'Invalid id' });
    const { status } = req.body || {};
    const VALID = ['pending', 'reviewed', 'accepted', 'rejected'];
    if (!VALID.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const apps = loadApplications();
    const idx  = apps.findIndex(a => a.application_number === appNo);
    if (idx < 0) return res.status(404).json({ error: 'Not found' });
    apps[idx].status = status;
    fs.writeFileSync(DATA_FILE, JSON.stringify(apps, null, 2), 'utf8');
    res.json({ success: true });
  }
);

/* Serve uploaded files — admin only, path-traversal safe */
app.get('/admin/files/:appNo/:filename', requireAdmin, (req, res) => {
  const appNo    = req.params.appNo.toUpperCase();
  const filename = req.params.filename;
  if (!/^[A-Z0-9-]+$/.test(appNo) || !/^[a-z0-9_.%-]+$/i.test(filename)) {
    return res.status(400).send('Bad request');
  }
  const base     = path.join(__dirname, 'uploads', 'applications');
  const filePath = path.resolve(base, appNo, filename);
  // Double-check resolved path is inside uploads/applications
  if (!filePath.startsWith(base + path.sep)) return res.status(403).send('Forbidden');
  if (!fs.existsSync(filePath))              return res.status(404).send('Not found');
  res.sendFile(filePath);
});

/* ────────────────────────────────────────────────────────
   ADMIN HTML TEMPLATES
   ──────────────────────────────────────────────────────── */
function adminLoginHTML(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — ELIMS</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f0f4f8;font-family:Inter,system-ui,sans-serif}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12);
        padding:2.5rem;width:100%;max-width:380px}
  .logo{text-align:center;margin-bottom:2rem}
  .logo h1{font-size:1.25rem;color:#1B2A4A;font-weight:700}
  .logo p{font-size:.8rem;color:#64748b;margin-top:.25rem}
  label{display:block;font-size:.85rem;font-weight:600;color:#374151;margin-bottom:.4rem}
  input{width:100%;padding:.65rem .9rem;border:1.5px solid #d1d5db;border-radius:8px;
        font-size:.95rem;outline:none;transition:border .2s}
  input:focus{border-color:#2E8B57}
  .field{margin-bottom:1.2rem}
  .btn{width:100%;padding:.75rem;background:#1B2A4A;color:#fff;border:none;
       border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;margin-top:.5rem}
  .btn:hover{background:#2E8B57}
  .error{background:#fef2f2;color:#dc2626;border:1px solid #fca5a5;border-radius:8px;
         padding:.75rem 1rem;margin-bottom:1rem;font-size:.875rem}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>ELIMS Admin Panel</h1>
    <p>College of Pharmacy, Thrissur</p>
  </div>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST" action="/admin/login">
    <div class="field">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" autocomplete="username" required>
    </div>
    <div class="field">
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
    </div>
    <button class="btn" type="submit">Sign In</button>
  </form>
</div>
</body></html>`;
}

function adminDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard — ELIMS Admissions</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
a{color:inherit;text-decoration:none}

/* ── Header ── */
.hdr{background:#1B2A4A;color:#fff;display:flex;align-items:center;
     justify-content:space-between;padding:.9rem 1.5rem;position:sticky;top:0;z-index:100}
.hdr h1{font-size:1.05rem;font-weight:700}
.hdr small{color:#94a3b8;font-size:.78rem;display:block}
.logout{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);
        color:#fff;padding:.4rem .9rem;border-radius:6px;font-size:.85rem;cursor:pointer;
        text-decoration:none}
.logout:hover{background:rgba(255,255,255,.2)}

/* ── Layout ── */
.main{max-width:1300px;margin:0 auto;padding:1.5rem}

/* ── Stats ── */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem}
.stat{background:#fff;border-radius:10px;padding:1rem 1.25rem;border-left:4px solid #cbd5e1}
.stat.total  {border-color:#1B2A4A}.stat.pending {border-color:#f59e0b}
.stat.reviewed{border-color:#3b82f6}.stat.accepted{border-color:#22c55e}
.stat.rejected{border-color:#ef4444}
.stat__num{font-size:2rem;font-weight:700;line-height:1}
.stat__label{font-size:.78rem;color:#64748b;margin-top:.25rem;text-transform:uppercase;letter-spacing:.05em}

/* ── Toolbar ── */
.toolbar{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem;align-items:center}
.toolbar input,.toolbar select{padding:.5rem .8rem;border:1.5px solid #e2e8f0;border-radius:8px;
  font-size:.875rem;outline:none;background:#fff}
.toolbar input:focus,.toolbar select:focus{border-color:#2E8B57}
.toolbar input{flex:1;min-width:200px}

/* ── Table ── */
.tbl-wrap{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.06)}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th{background:#f8fafc;padding:.8rem 1rem;text-align:left;font-weight:600;
   color:#475569;border-bottom:2px solid #e2e8f0;white-space:nowrap}
td{padding:.8rem 1rem;border-bottom:1px solid #f1f5f9;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.data-row{cursor:pointer;transition:background .15s}
tr.data-row:hover{background:#f8fafc}
.no-data{text-align:center;color:#94a3b8;padding:3rem;font-size:.95rem}

/* ── Status badge ── */
.badge{display:inline-block;padding:.2rem .6rem;border-radius:20px;font-size:.75rem;font-weight:600}
.badge.pending  {background:#fef3c7;color:#92400e}
.badge.reviewed {background:#dbeafe;color:#1e40af}
.badge.accepted {background:#dcfce7;color:#166534}
.badge.rejected {background:#fee2e2;color:#991b1b}

/* ── Detail modal ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;
         align-items:flex-start;justify-content:center;padding:2rem 1rem;overflow-y:auto}
.overlay.open{display:flex}
.modal{background:#fff;border-radius:14px;width:100%;max-width:860px;margin:auto;
       box-shadow:0 20px 60px rgba(0,0,0,.25)}
.modal__hdr{display:flex;align-items:center;justify-content:space-between;
            padding:1.2rem 1.5rem;border-bottom:1px solid #e2e8f0}
.modal__hdr h2{font-size:1.05rem;font-weight:700;color:#1B2A4A}
.close-btn{background:none;border:none;font-size:1.4rem;cursor:pointer;color:#94a3b8;line-height:1}
.close-btn:hover{color:#1e293b}
.modal__body{padding:1.5rem;overflow-y:auto;max-height:75vh}

/* ── Detail sections ── */
.dsec{margin-bottom:1.5rem}
.dsec h3{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
          color:#94a3b8;margin-bottom:.75rem;padding-bottom:.4rem;border-bottom:1px solid #f1f5f9}
.dg{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.6rem}
.df{background:#f8fafc;padding:.5rem .75rem;border-radius:6px}
.df dt{font-size:.72rem;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.df dd{font-size:.9rem;color:#1e293b;margin-top:.1rem;word-break:break-all}
.full-width{grid-column:1/-1}

/* ── Status selector in modal ── */
.status-bar{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;
            padding:1rem 1.5rem;background:#f8fafc;border-top:1px solid #e2e8f0;
            border-radius:0 0 14px 14px}
.status-bar label{font-size:.875rem;font-weight:600;color:#475569}
.status-sel{padding:.45rem .8rem;border:1.5px solid #e2e8f0;border-radius:8px;
            font-size:.875rem;outline:none;background:#fff}
.status-sel:focus{border-color:#2E8B57}
.save-btn{padding:.45rem 1.1rem;background:#2E8B57;color:#fff;border:none;
          border-radius:8px;font-size:.875rem;font-weight:600;cursor:pointer}
.save-btn:hover{background:#1B2A4A}
.save-msg{font-size:.8rem;color:#22c55e;font-weight:600}

/* ── Files ── */
.file-list{list-style:none;display:flex;flex-wrap:wrap;gap:.5rem}
.file-list a{display:inline-flex;align-items:center;gap:.3rem;padding:.3rem .7rem;
             background:#eff6ff;color:#1d4ed8;border-radius:6px;font-size:.8rem;
             font-weight:500;text-decoration:none;border:1px solid #bfdbfe}
.file-list a:hover{background:#dbeafe}

/* ── Responsive ── */
@media(max-width:640px){
  th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5){display:none}
  .modal{border-radius:0}.overlay{padding:0}
}
</style>
</head>
<body>

<header class="hdr">
  <div>
    <h1>ELIMS Admin Panel</h1>
    <small>Admissions Dashboard 2026–27</small>
  </div>
  <div style="display:flex; gap:.6rem; align-items:center;">
    <a href="/admin/site" class="logout">Site Manager</a>
    <a href="/admin/logout" class="logout">Sign Out</a>
  </div>
</header>

<main class="main">
  <!-- Stats -->
  <div class="stats" id="stats">
    <div class="stat total">  <div class="stat__num" id="s-total">—</div>  <div class="stat__label">Total</div></div>
    <div class="stat pending"> <div class="stat__num" id="s-pending">—</div> <div class="stat__label">Pending</div></div>
    <div class="stat reviewed"><div class="stat__num" id="s-reviewed">—</div><div class="stat__label">Reviewed</div></div>
    <div class="stat accepted"><div class="stat__num" id="s-accepted">—</div><div class="stat__label">Accepted</div></div>
    <div class="stat rejected"><div class="stat__num" id="s-rejected">—</div><div class="stat__label">Rejected</div></div>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <input  id="search"        type="search"  placeholder="Search name or application number…">
    <select id="filterCourse"  ><option value="">All Courses</option></select>
    <select id="filterStatus"  >
      <option value="">All Statuses</option>
      <option value="pending">Pending</option>
      <option value="reviewed">Reviewed</option>
      <option value="accepted">Accepted</option>
      <option value="rejected">Rejected</option>
    </select>
  </div>

  <!-- Table -->
  <div class="tbl-wrap">
    <table id="appTable">
      <thead>
        <tr>
          <th>App. No.</th>
          <th>Name</th>
          <th>Course</th>
          <th>Quota</th>
          <th>Phone</th>
          <th>Submitted</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody id="tbody"><tr><td colspan="7" class="no-data">Loading…</td></tr></tbody>
    </table>
  </div>
</main>

<!-- Detail modal -->
<div class="overlay" id="overlay" role="dialog" aria-modal="true">
  <div class="modal">
    <div class="modal__hdr">
      <h2 id="modal-title">Application Details</h2>
      <button class="close-btn" id="closeModal" aria-label="Close">&#x2715;</button>
    </div>
    <div class="modal__body" id="modal-body"></div>
    <div class="status-bar">
      <label for="statusSel">Status:</label>
      <select class="status-sel" id="statusSel">
        <option value="pending">Pending</option>
        <option value="reviewed">Reviewed</option>
        <option value="accepted">Accepted</option>
        <option value="rejected">Rejected</option>
      </select>
      <button class="save-btn" id="saveStatus">Save</button>
      <span class="save-msg" id="saveMsg" style="display:none">Saved ✓</span>
    </div>
  </div>
</div>

<script>
let allApps = [];
let currentAppNo = null;

/* ── Load list ── */
async function loadList() {
  const res  = await fetch('/admin/api/applications');
  allApps    = await res.json();
  renderStats();
  populateCourseFilter();
  renderTable(allApps);
}

function renderStats() {
  const count = s => allApps.filter(a => (a.status || 'pending') === s).length;
  document.getElementById('s-total').textContent    = allApps.length;
  document.getElementById('s-pending').textContent  = count('pending');
  document.getElementById('s-reviewed').textContent = count('reviewed');
  document.getElementById('s-accepted').textContent = count('accepted');
  document.getElementById('s-rejected').textContent = count('rejected');
}

function populateCourseFilter() {
  const sel     = document.getElementById('filterCourse');
  const courses = [...new Set(allApps.map(a => a.course_applied_for).filter(Boolean))].sort();
  courses.forEach(c => {
    const o = document.createElement('option');
    o.value = o.textContent = c;
    sel.appendChild(o);
  });
}

function renderTable(apps) {
  const tbody = document.getElementById('tbody');
  if (!apps.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="no-data">No applications found.</td></tr>';
    return;
  }
  tbody.innerHTML = apps.map(a => {
    const date    = a.submitted_at ? new Date(a.submitted_at).toLocaleDateString('en-IN') : '—';
    const status  = a.status || 'pending';
    return \`<tr class="data-row" data-appno="\${esc(a.application_number)}">
      <td><strong>\${esc(a.application_number)}</strong></td>
      <td>\${esc(a.full_name)}</td>
      <td>\${esc(a.course_applied_for)}</td>
      <td>\${esc(a.quota)}</td>
      <td>\${esc(a.comm_phone)}</td>
      <td>\${date}</td>
      <td><span class="badge \${status}">\${status}</span></td>
    </tr>\`;
  }).join('');
  tbody.querySelectorAll('tr.data-row').forEach(tr =>
    tr.addEventListener('click', () => openModal(tr.dataset.appno))
  );
}

/* ── Filter + search ── */
function applyFilters() {
  const q       = document.getElementById('search').value.toLowerCase();
  const course  = document.getElementById('filterCourse').value;
  const status  = document.getElementById('filterStatus').value;
  const filtered = allApps.filter(a => {
    if (course && a.course_applied_for !== course) return false;
    if (status && (a.status || 'pending') !== status) return false;
    if (q && !a.full_name.toLowerCase().includes(q) && !a.application_number.toLowerCase().includes(q)) return false;
    return true;
  });
  renderTable(filtered);
}

['search','filterCourse','filterStatus'].forEach(id =>
  document.getElementById(id).addEventListener('input', applyFilters)
);

/* ── Modal ── */
async function openModal(appNo) {
  currentAppNo = appNo;
  document.getElementById('modal-body').innerHTML = '<p style="padding:2rem;color:#94a3b8">Loading…</p>';
  document.getElementById('overlay').classList.add('open');
  const res  = await fetch('/admin/api/applications/' + encodeURIComponent(appNo));
  const data = await res.json();
  document.getElementById('modal-title').textContent = 'Application — ' + appNo;
  document.getElementById('statusSel').value = data.status || 'pending';
  document.getElementById('saveMsg').style.display = 'none';
  document.getElementById('modal-body').innerHTML = buildDetail(data);
}

document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  currentAppNo = null;
}

/* ── Save status ── */
document.getElementById('saveStatus').addEventListener('click', async () => {
  if (!currentAppNo) return;
  const status = document.getElementById('statusSel').value;
  await fetch('/admin/api/applications/' + encodeURIComponent(currentAppNo) + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  // Update local data
  const a = allApps.find(x => x.application_number === currentAppNo);
  if (a) a.status = status;
  renderStats();
  renderTable(applyFilters() || allApps);
  document.getElementById('saveMsg').style.display = 'inline';
  // Update badge in table
  document.querySelectorAll('[data-appno="' + currentAppNo + '"] .badge').forEach(b => {
    b.className = 'badge ' + status;
    b.textContent = status;
  });
});

/* ── Build detail HTML ── */
function buildDetail(d) {
  const f  = (label, val) => val
    ? \`<div class="df"><dt>\${label}</dt><dd>\${esc(String(val))}</dd></div>\`
    : '';
  const fw = (label, val) => val
    ? \`<div class="df full-width"><dt>\${label}</dt><dd>\${esc(String(val))}</dd></div>\`
    : '';

  let html = '';

  html += sec('Application', [
    f('App. Number', d.application_number),
    f('Submitted', d.submitted_at ? new Date(d.submitted_at).toLocaleString('en-IN') : ''),
    f('Course', d.course_applied_for),
    f('Quota', d.quota),
  ]);

  html += sec('Personal Details', [
    f('Full Name', d.full_name),
    f('Date of Birth', d.date_of_birth),
    f('Age', d.age),
    f('Gender', d.gender),
    f('Blood Group', d.blood_group),
    f('Aadhaar', d.aadhaar_number),
    f('Nationality', d.nationality),
    f('Religion', d.religion),
    f('Category', d.category),
    f('Caste/Community', d.caste_or_community),
    f('Place of Birth', d.place_of_birth),
    f('Email', d.email),
    f('Phone', d.comm_phone),
  ]);

  const commAddr = [d.comm_address, d.comm_district, d.comm_state, d.comm_pin].filter(Boolean).join(', ');
  const permAddr = d.same_address ? 'Same as communication' :
    [d.perm_address, d.perm_district, d.perm_state, d.perm_pin].filter(Boolean).join(', ');
  html += sec('Address', [fw('Communication', commAddr), fw('Permanent', permAddr)]);

  // Academic records
  let acadRows = '';
  if (Array.isArray(d.acad) && d.acad.length) {
    acadRows = \`<table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-top:.5rem">
      <tr style="background:#f8fafc"><th style="padding:.5rem;text-align:left">Exam</th>
        <th style="padding:.5rem;text-align:left">Board</th>
        <th style="padding:.5rem;text-align:left">Year</th>
        <th style="padding:.5rem;text-align:left">%</th></tr>
      \${d.acad.filter(r=>r.exam).map(r=>\`<tr>
        <td style="padding:.4rem .5rem;border-top:1px solid #f1f5f9">\${esc(r.exam)}</td>
        <td style="padding:.4rem .5rem;border-top:1px solid #f1f5f9">\${esc(r.board)}</td>
        <td style="padding:.4rem .5rem;border-top:1px solid #f1f5f9">\${esc(r.year)}</td>
        <td style="padding:.4rem .5rem;border-top:1px solid #f1f5f9">\${esc(r.percentage)}%</td>
      </tr>\`).join('')}</table>\`;
  }
  html += \`<div class="dsec"><h3>Academic Records</h3>\${acadRows || '<p style="color:#94a3b8;font-size:.85rem">No records</p>'}
    <div class="dg" style="margin-top:.75rem">
      \${f('PCB/PCM %', d.pcb_percentage)}
      \${f('KEAM Rank', d.keam_rank)}
      \${f('GPAT Score', d.gpat_score)}
      \${f('Entrance Roll No.', d.entrance_roll_no)}
    </div></div>\`;

  html += sec('Parent / Guardian', [
    f('Name', d.parent_name),
    f('Relationship', d.relationship),
    f('Occupation', d.occupation),
    f('Designation', d.designation),
    f('Annual Income', d.annual_income ? '₹' + d.annual_income : ''),
    f('Phone', d.parent_phone),
    f('Email', d.parent_email),
    fw('Official Address', d.official_address),
  ]);

  html += sec('Other', [
    f('Hostel Required', d.hostel_required ? 'Yes' : 'No'),
    f('Scholarship', d.scholarship_received ? 'Yes — ' + (d.scholarship_details || '') : 'No'),
  ]);

  // Uploaded files
  const files = d.uploaded_files || {};
  const links = Object.entries(files).flatMap(([field, val]) => {
    const names = Array.isArray(val) ? val : [val];
    return names.filter(n => n && n !== 'upload_failed').map(name =>
      \`<li><a href="/admin/files/\${encodeURIComponent(d.application_number)}/\${encodeURIComponent(name)}" target="_blank">\${esc(field.replace(/_/g,' '))} — \${esc(name)}</a></li>\`
    );
  }).join('');
  html += \`<div class="dsec"><h3>Uploaded Documents</h3>
    \${links ? \`<ul class="file-list">\${links}</ul>\` : '<p style="color:#94a3b8;font-size:.85rem">No files uploaded</p>'}
  </div>\`;

  return html;
}

function sec(title, fields) {
  const inner = fields.filter(Boolean).join('');
  return inner ? \`<div class="dsec"><h3>\${title}</h3><div class="dg">\${inner}</div></div>\` : '';
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── also re-render after filter ── */
function applyFilters() {
  const q      = document.getElementById('search').value.toLowerCase();
  const course = document.getElementById('filterCourse').value;
  const status = document.getElementById('filterStatus').value;
  const filtered = allApps.filter(a => {
    if (course && a.course_applied_for !== course) return false;
    if (status && (a.status || 'pending') !== status) return false;
    if (q && !a.full_name.toLowerCase().includes(q) && !a.application_number.toLowerCase().includes(q)) return false;
    return true;
  });
  renderTable(filtered);
}

loadList();
</script>
</body></html>`;
}

function adminSiteHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Manager — ELIMS Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
a{text-decoration:none;color:inherit}
.hdr{background:#1B2A4A;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.5rem}
.links{display:flex;gap:.6rem}
.btn-link{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);padding:.4rem .9rem;border-radius:6px;font-size:.85rem}
.main{max-width:1150px;margin:0 auto;padding:1.5rem}
.card{background:#fff;border-radius:12px;padding:1rem 1.1rem;box-shadow:0 1px 8px rgba(0,0,0,.06);margin-bottom:1rem}
.card h2{font-size:1rem;color:#1B2A4A;margin-bottom:.75rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}
input[type=file], input[type=text]{border:1px solid #dbe3ee;border-radius:8px;padding:.55rem .7rem;background:#fff}
input[type=text]{min-width:260px}
button{border:none;border-radius:8px;padding:.55rem .85rem;cursor:pointer;font-weight:600}
.btn-primary{background:#2E8B57;color:#fff}
.btn-danger{background:#ef4444;color:#fff}
.btn-muted{background:#e2e8f0;color:#334155}
.hint{font-size:.82rem;color:#64748b;margin-top:.45rem}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:.8rem;margin-top:.9rem}
.item{border:1px solid #e2e8f0;border-radius:10px;padding:.5rem;background:#f8fafc}
.thumb{width:100%;height:110px;object-fit:cover;border-radius:6px;background:#e2e8f0}
.item .actions{display:flex;justify-content:flex-end;margin-top:.45rem}
.status{font-size:.84rem;color:#166534;font-weight:600;min-height:1.2em}
@media (max-width:700px){.row{flex-direction:column;align-items:stretch} input[type=text]{min-width:0;width:100%}}
</style>
</head>
<body>
<header class="hdr">
  <div>
    <h1 style="font-size:1.05rem;">ELIMS Site Manager</h1>
    <small style="color:#94a3b8;">Carousel, Gallery, Popup Control</small>
  </div>
  <div class="links">
    <a class="btn-link" href="/admin">Applications</a>
    <a class="btn-link" href="/admin/logout">Sign Out</a>
  </div>
</header>

<main class="main">
  <div class="card">
    <h2>Carousel Images (Homepage)</h2>
    <div class="row">
      <input type="file" id="carouselFile" accept="image/png,image/jpeg,image/webp">
      <button class="btn-primary" id="addCarouselBtn">Upload to Carousel</button>
    </div>
    <p class="hint">Uploaded images are appended. Existing homepage slides will use these managed images first.</p>
    <div class="list" id="carouselList"></div>
  </div>

  <div class="card">
    <h2>Gallery Images</h2>
    <div class="row">
      <input type="file" id="galleryFile" accept="image/png,image/jpeg,image/webp">
      <button class="btn-primary" id="addGalleryBtn">Upload to Gallery</button>
    </div>
    <p class="hint">Gallery page will show these managed images when available.</p>
    <div class="list" id="galleryList"></div>
  </div>

  <div class="card">
    <h2>Admission Popup</h2>
    <div class="row" style="margin-bottom:.6rem;">
      <label style="display:flex;align-items:center;gap:.45rem;">
        <input type="checkbox" id="popupEnabled">
        <span>Enable popup for visitors</span>
      </label>
      <input type="text" id="popupLink" placeholder="Popup click link (e.g. /pages/admission.html)">
      <button class="btn-muted" id="savePopupBtn">Save Popup Settings</button>
    </div>
    <div class="row">
      <input type="file" id="popupFile" accept="image/png,image/jpeg,image/webp">
      <button class="btn-primary" id="uploadPopupBtn">Upload Popup Image</button>
    </div>
    <div class="list" id="popupList"></div>
  </div>
  <p class="status" id="statusText"></p>
</main>

<script>
let config = { carousel: [], gallery: [], popup: { enabled: false, image: '', link: '/pages/admission.html', alt: 'Admission update' } };

function setStatus(msg, isError) {
  const s = document.getElementById('statusText');
  s.textContent = msg || '';
  s.style.color = isError ? '#b91c1c' : '#166534';
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fileNameFromPath(p) {
  return (p || '').split('/').pop() || p;
}

function renderList(targetId, items, type) {
  const el = document.getElementById(targetId);
  if (!items || !items.length) {
    el.innerHTML = '<div class="hint">No images yet.</div>';
    return;
  }

  el.innerHTML = items.map((p) => {
    return '<div class="item">'
      + '<img class="thumb" src="' + p + '" alt="' + fileNameFromPath(p).replace(/"/g, '&quot;') + '">' 
      + '<div class="actions">'
      + '<button class="btn-danger" data-type="' + type + '" data-path="' + p + '">Delete</button>'
      + '</div>'
      + '</div>';
  }).join('');

  el.querySelectorAll('button[data-type]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('/admin/api/site-media', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: btn.dataset.type, path: btn.dataset.path }),
        });
        await loadConfig();
        setStatus('Image deleted successfully.', false);
      } catch (err) {
        setStatus(err.message, true);
      }
    });
  });
}

function renderPopup() {
  document.getElementById('popupEnabled').checked = !!(config.popup && config.popup.enabled);
  document.getElementById('popupLink').value = (config.popup && config.popup.link) || '/pages/admission.html';
  const list = config.popup && config.popup.image ? [config.popup.image] : [];
  renderList('popupList', list, 'popup');
}

async function loadConfig() {
  config = await api('/admin/api/site-content');
  renderList('carouselList', config.carousel || [], 'carousel');
  renderList('galleryList', config.gallery || [], 'gallery');
  renderPopup();
}

async function uploadByType(type, inputId) {
  const input = document.getElementById(inputId);
  if (!input.files || !input.files[0]) {
    setStatus('Please choose an image first.', true);
    return;
  }
  const fd = new FormData();
  fd.append('type', type);
  fd.append('image', input.files[0]);
  try {
    await api('/admin/api/site-media/upload', { method: 'POST', body: fd });
    input.value = '';
    await loadConfig();
    setStatus('Image uploaded successfully.', false);
  } catch (err) {
    setStatus(err.message, true);
  }
}

document.getElementById('addCarouselBtn').addEventListener('click', () => uploadByType('carousel', 'carouselFile'));
document.getElementById('addGalleryBtn').addEventListener('click', () => uploadByType('gallery', 'galleryFile'));
document.getElementById('uploadPopupBtn').addEventListener('click', () => uploadByType('popup', 'popupFile'));

document.getElementById('savePopupBtn').addEventListener('click', async () => {
  try {
    await api('/admin/api/site-content/popup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: document.getElementById('popupEnabled').checked,
        link: document.getElementById('popupLink').value,
        alt: 'Admission update',
      }),
    });
    await loadConfig();
    setStatus('Popup settings saved.', false);
  } catch (err) {
    setStatus(err.message, true);
  }
});

loadConfig().catch(err => setStatus(err.message, true));
</script>
</body>
</html>`;
}

/* ────────────────────────────────────────────────────────
   START
   ──────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`ELIMS server running at http://localhost:${PORT}`);
  console.log(`Open the site at http://localhost:${PORT}/index.html`);
  console.log(`Admin panel  at http://localhost:${PORT}/admin`);
});
