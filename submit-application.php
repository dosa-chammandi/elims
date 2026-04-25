<?php
/**
 * ELIMS College of Pharmacy — Online Admission Form Handler
 * Validates input, saves uploaded files, and sends notification email.
 *
 * Deploy this file at the project root alongside index.html.
 * Ensure the web server has write permission to the uploads/ directory.
 */

declare(strict_types=1);

/* ── Response helper ───────────────────────────────────── */
function jsonResponse(bool $success, string $message = '', string $appNo = ''): void
{
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success'            => $success,
        'message'            => $message,
        'application_number' => $appNo,
    ]);
    exit;
}

/* ── Only accept POST ──────────────────────────────────── */
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    jsonResponse(false, 'Method not allowed.');
}

/* ── Sanitise a plain text string ─────────────────────── */
function clean(string $val): string
{
    return htmlspecialchars(trim($val), ENT_QUOTES, 'UTF-8');
}

/* ── Required text fields ──────────────────────────────── */
$required = [
    'application_number', 'course_applied_for', 'quota',
    'full_name', 'date_of_birth', 'gender', 'nationality',
    'category', 'email',
    'comm_address', 'comm_district', 'comm_state', 'comm_pin', 'comm_phone',
    'parent_name', 'relationship', 'parent_phone',
    'pcb_percentage',
    'applicant_signature', 'parent_signature', 'declaration_date', 'declaration_place',
];

$errors = [];

foreach ($required as $field) {
    if (empty($_POST[$field])) {
        $errors[] = "Missing required field: {$field}";
    }
}

/* ── Email validation ──────────────────────────────────── */
if (!empty($_POST['email']) && !filter_var($_POST['email'], FILTER_VALIDATE_EMAIL)) {
    $errors[] = 'Invalid email address.';
}

/* ── PIN code validation ───────────────────────────────── */
if (!empty($_POST['comm_pin']) && !preg_match('/^\d{6}$/', $_POST['comm_pin'])) {
    $errors[] = 'Invalid PIN code.';
}

/* ── Aadhaar validation (if provided) ─────────────────── */
if (!empty($_POST['aadhaar_number'])) {
    $aadhaar = preg_replace('/\s/', '', $_POST['aadhaar_number']);
    if (!preg_match('/^\d{12}$/', $aadhaar)) {
        $errors[] = 'Invalid Aadhaar number.';
    }
}

/* ── Declaration checkbox ─────────────────────────────── */
if (empty($_POST['agree_declaration'])) {
    $errors[] = 'Declaration must be accepted.';
}

if (!empty($errors)) {
    jsonResponse(false, implode(' | ', $errors));
}

/* ── Application number ────────────────────────────────── */
$appNo = clean($_POST['application_number']);
// Only allow safe characters (alphanumeric and hyphens) to prevent path traversal
if (!preg_match('/^[A-Z0-9\-]+$/i', $appNo)) {
    jsonResponse(false, 'Invalid application number format.');
}

/* ── Upload directory ──────────────────────────────────── */
$uploadBase = __DIR__ . '/uploads/applications/' . $appNo . '/';
if (!is_dir($uploadBase)) {
    if (!mkdir($uploadBase, 0750, true) && !is_dir($uploadBase)) {
        jsonResponse(false, 'Server error: could not create upload directory. Please contact the admissions office.');
    }
}

/* ── Allowed MIME types ────────────────────────────────── */
$allowedMime = ['application/pdf', 'image/jpeg', 'image/png'];
$maxFileBytes = 2 * 1024 * 1024; // 2 MB

/**
 * Move a single uploaded file safely.
 * Returns the saved filename or empty string on failure.
 */
function saveUpload(array $fileEntry, string $destDir, string $fieldName): string
{
    global $allowedMime, $maxFileBytes;

    if ($fileEntry['error'] !== UPLOAD_ERR_OK) {
        return '';
    }
    if ($fileEntry['size'] > $maxFileBytes) {
        return '';
    }

    // Validate MIME via finfo (do NOT trust $_FILES['type'])
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($fileEntry['tmp_name']);
    if (!in_array($mime, $allowedMime, true)) {
        return '';
    }

    // Build a safe filename
    $ext      = ($mime === 'application/pdf') ? 'pdf' : (($mime === 'image/png') ? 'png' : 'jpg');
    $safeName = $fieldName . '_' . bin2hex(random_bytes(6)) . '.' . $ext;
    $dest     = $destDir . $safeName;

    if (!move_uploaded_file($fileEntry['tmp_name'], $dest)) {
        return '';
    }
    return $safeName;
}

/* ── Single-file uploads ───────────────────────────────── */
$singleDocs = [
    'applicant_photo', 'doc_allotment_memo', 'doc_fee_receipt',
    'doc_mark_list', 'doc_tc', 'doc_migration', 'doc_eligibility',
    'doc_caste', 'doc_pharmacy_reg', 'doc_fitness', 'doc_vaccination',
];

$savedFiles = [];
foreach ($singleDocs as $field) {
    if (!empty($_FILES[$field]['name'])) {
        $saved = saveUpload($_FILES[$field], $uploadBase, $field);
        $savedFiles[$field] = $saved ?: 'upload_failed';
    }
}

/* ── Multi-file uploads ────────────────────────────────── */
$multiDocs = ['doc_photos', 'doc_additional'];
foreach ($multiDocs as $field) {
    if (!empty($_FILES[$field]['name'][0])) {
        $count = count($_FILES[$field]['name']);
        $savedFiles[$field] = [];
        for ($i = 0; $i < $count; $i++) {
            $entry = [
                'name'     => $_FILES[$field]['name'][$i],
                'type'     => $_FILES[$field]['type'][$i],
                'tmp_name' => $_FILES[$field]['tmp_name'][$i],
                'error'    => $_FILES[$field]['error'][$i],
                'size'     => $_FILES[$field]['size'][$i],
            ];
            $saved = saveUpload($entry, $uploadBase, $field . '_' . $i);
            if ($saved) {
                $savedFiles[$field][] = $saved;
            }
        }
    }
}

/* ── Collect form data ─────────────────────────────────── */
$data = [];
$textFields = [
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
foreach ($textFields as $f) {
    $data[$f] = isset($_POST[$f]) ? clean($_POST[$f]) : '';
}

/* ── Build email body ──────────────────────────────────── */
$to      = 'elimspharmacy@gmail.com';
$subject = "[Online Application] {$data['course_applied_for']} — {$data['full_name']} ({$data['application_number']})";

$body  = "ELIMS College of Pharmacy — Online Admission Application\n";
$body .= str_repeat('=', 60) . "\n\n";
$body .= "APPLICATION NUMBER : {$data['application_number']}\n";
$body .= "COURSE             : {$data['course_applied_for']}\n";
$body .= "QUOTA              : {$data['quota']}\n\n";

$body .= "── PERSONAL DETAILS ──\n";
$body .= "Name        : {$data['full_name']}\n";
$body .= "DOB         : {$data['date_of_birth']}   Age: {$data['age']}\n";
$body .= "Gender      : {$data['gender']}\n";
$body .= "Blood Group : {$data['blood_group']}\n";
$body .= "Aadhaar     : {$data['aadhaar_number']}\n";
$body .= "Category    : {$data['category']}   Religion: {$data['religion']}\n";
$body .= "Caste       : {$data['caste_or_community']}\n";
$body .= "Nationality : {$data['nationality']}\n";
$body .= "Email       : {$data['email']}\n";
$body .= "Phone       : {$data['comm_phone']}\n\n";

$body .= "── ADDRESS ──\n";
$sameAddr = !empty($_POST['same_address']);
$body .= "Communication: {$data['comm_address']}, {$data['comm_district']}, {$data['comm_state']} — {$data['comm_pin']}\n";
if ($sameAddr) {
    $body .= "Permanent    : Same as communication address\n\n";
} else {
    $body .= "Permanent    : {$data['perm_address']}, {$data['perm_district']}, {$data['perm_state']} — {$data['perm_pin']}\n\n";
}

$body .= "── ACADEMIC RECORDS ──\n";
if (!empty($_POST['acad']) && is_array($_POST['acad'])) {
    foreach ($_POST['acad'] as $row) {
        $exam = clean($row['exam'] ?? '');
        $board = clean($row['board'] ?? '');
        $year = clean($row['year'] ?? '');
        $pct = clean($row['percentage'] ?? '');
        if ($exam) {
            $body .= "{$exam}: {$board} ({$year}) — {$pct}%\n";
        }
    }
}
$body .= "\n";

$body .= "── ENTRANCE EXAM ──\n";
$body .= "KEAM Rank : {$data['keam_rank']}\n";
$body .= "GPAT Score: {$data['gpat_score']}\n";
$body .= "Roll No.  : {$data['entrance_roll_no']}\n\n";

$body .= "PCB/PCM %  : {$data['pcb_percentage']}%\n\n";

$body .= "── PARENT / GUARDIAN ──\n";
$body .= "Name         : {$data['parent_name']} ({$data['relationship']})\n";
$body .= "Occupation   : {$data['occupation']}, {$data['designation']}\n";
$body .= "Annual Income: ₹{$data['annual_income']}\n";
$body .= "Phone        : {$data['parent_phone']}\n";
$body .= "Email        : {$data['parent_email']}\n\n";

$body .= "── OTHER ──\n";
$body .= "Hostel Required   : " . (!empty($_POST['hostel_required']) ? 'Yes' : 'No') . "\n";
$body .= "Scholarship       : " . (!empty($_POST['scholarship_received']) ? 'Yes — ' . $data['scholarship_details'] : 'No') . "\n\n";

$body .= "── DECLARATION ──\n";
$body .= "Applicant Signature : {$data['applicant_signature']}\n";
$body .= "Parent Signature    : {$data['parent_signature']}\n";
$body .= "Date / Place        : {$data['declaration_date']}, {$data['declaration_place']}\n\n";

$body .= "── UPLOADED FILES ──\n";
foreach ($savedFiles as $field => $file) {
    if (is_array($file)) {
        $body .= "{$field}: " . implode(', ', $file) . "\n";
    } else {
        $body .= "{$field}: {$file}\n";
    }
}
$body .= "\n";
$body .= "Files saved to: uploads/applications/{$appNo}/\n";
$body .= str_repeat('-', 60) . "\n";
$body .= "This is an automated notification from the ELIMS online admission system.\n";

$headers  = "From: noreply@elimspharmacycollege.com\r\n";
$headers .= "Reply-To: {$data['email']}\r\n";
$headers .= "X-Mailer: PHP/" . phpversion() . "\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

/* ── Send email ────────────────────────────────────────── */
$mailSent = mail($to, $subject, $body, $headers);

/* ── Send confirmation to applicant ───────────────────── */
if ($mailSent && !empty($data['email'])) {
    $confSubject = "Application Received — {$data['application_number']} | ELIMS College of Pharmacy";
    $confBody  = "Dear {$data['full_name']},\n\n";
    $confBody .= "Thank you for applying to ELIMS College of Pharmacy, Thrissur.\n\n";
    $confBody .= "Your application has been received successfully.\n\n";
    $confBody .= "Application Number : {$data['application_number']}\n";
    $confBody .= "Course Applied For : {$data['course_applied_for']}\n";
    $confBody .= "Quota              : {$data['quota']}\n\n";
    $confBody .= "Please keep this number for future reference and follow-up.\n\n";
    $confBody .= "The admissions office will review your application and contact you at:\n";
    $confBody .= "Phone : {$data['comm_phone']}\n";
    $confBody .= "Email : {$data['email']}\n\n";
    $confBody .= "For queries:\n";
    $confBody .= "Phone : +91 (0) 487 296 5395 / +91 79075 55133\n";
    $confBody .= "Email : elimspharmacy@gmail.com\n\n";
    $confBody .= "Warm regards,\n";
    $confBody .= "Admissions Office\n";
    $confBody .= "ELIMS College of Pharmacy\n";
    $confBody .= "Ramavarmapuram P O, Villadam, Thrissur — 680631, Kerala\n";

    $confHeaders  = "From: admissions@elimspharmacycollege.com\r\n";
    $confHeaders .= "Reply-To: elimspharmacy@gmail.com\r\n";
    $confHeaders .= "Content-Type: text/plain; charset=UTF-8\r\n";

    mail($data['email'], $confSubject, $confBody, $confHeaders);
}

/* ── Respond ───────────────────────────────────────────── */
jsonResponse(true, 'Application submitted successfully.', $appNo);
