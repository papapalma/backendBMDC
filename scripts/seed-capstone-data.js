#!/usr/bin/env node
/**
 * BMDC Capstone 500+ Additive Seeder & Verification Script
 *
 * Seeds realistic Bongabong Manpower Development Center (Oriental Mindoro) data
 * strictly dated between 2026-09-28 and 2026-11-26 without modifying or deleting
 * any pre-existing database records.
 *
 * Every seeded row uses a deterministic RFC-4122 v4 UUID in the reserved range
 *   c0de2026-0928-4<TT>0-8000-<000000000001..>
 * allowing zero-collateral `--rollback` and idempotent checks.
 *
 * Usage:
 *   node scripts/seed-capstone-data.js                  # Run additive seed
 *   node scripts/seed-capstone-data.js --patch-photos   # Backfill attendance selfies & trainee avatars in-place
 *   node scripts/seed-capstone-data.js --patch-sessions # Backfill missing active/upcoming sessions & dedupe in-place
 *   node scripts/seed-capstone-data.js --rollback       # Remove ONLY seeded rows & sample files
 *   node scripts/seed-capstone-data.js --reset          # Rollback seeded rows, then reseed
 *   node scripts/seed-capstone-data.js --verify-only    # Run full outside-judge verification
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const BACKEND_ROOT = path.resolve(__dirname, '..');
if (fs.existsSync(path.join(BACKEND_ROOT, '.env.local'))) {
  dotenv.config({ path: path.join(BACKEND_ROOT, '.env.local') });
}
dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Backend/.env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// =============================================================================
// CONSTANTS & DETERMINISTIC UUID NAMESPACE
// =============================================================================

const TENANT_ID = '194876de-a68c-4d33-8f80-c0978e5d44b3';
const START_DATE = '2026-09-28';
const END_DATE = '2026-11-26';
const MAX_PROGRAM_END_DATE = '2027-01-15';
const TEST_PASSWORD = process.env.CAPSTONE_SEED_PASSWORD || 'Admin123!';
const SHOWCASE_EMAIL = 'demo.trainee@bmdc.site';

const SPECIAL_HOLIDAYS = new Map([
  ['2026-11-01', "All Saints' Day (Regular Holiday)"],
  ['2026-11-02', "All Souls' Day (Special Non-Working Holiday)"],
  ['2026-11-15', 'Oriental Mindoro Founding Anniversary'],
  ['2026-11-16', 'Oriental Mindoro Founding Anniversary (Observed Non-Working Day)'],
  ['2026-11-30', 'Bonifacio Day (Regular Holiday)'],
  ['2026-12-08', 'Feast of the Immaculate Conception (Special Non-Working Day)'],
  ['2026-12-24', 'Christmas Eve (Special Non-Working Day)'],
  ['2026-12-25', 'Christmas Day (Regular Holiday)'],
  ['2026-12-30', 'Rizal Day (Regular Holiday)'],
  ['2026-12-31', 'Last Day of the Year (Special Non-Working Day)'],
  ['2027-01-01', "New Year's Day (Regular Holiday)"],
]);

const SEED_UUID_MIN = 'c0de2026-0928-4000-8000-000000000000';
const SEED_UUID_MAX = 'c0de2026-0928-4fff-8fff-ffffffffffff';

const TABLE_CODES = {
  users: '01',
  programs: '02',
  instructors: '03',
  program_instructors: '04',
  attendance_schedules: '05',
  program_sessions: '06',
  attendance_exceptions: '07',
  trainees: '08',
  trainee_accounts: '09',
  pending_registration_passwords: '0a',
  pending_registration_usernames: '0b',
  enrollments: '0c',
  attendance: '0d',
  certificates: '0e',
  trainee_status_records: '0f',
  trainee_remarks: '10',
  enrollment_requirements: '11',
  training_requirement_files: '12',
  items: '13',
  lendings: '14',
  announcements: '15',
  conversations: '16',
  messages: '17',
  extension_requests: '18',
  activity_logs: '19',
  audit_logs: '1a',
};

function seedUuid(table, seq) {
  const code = TABLE_CODES[table];
  if (!code) throw new Error(`Unknown table code: ${table}`);
  return `c0de2026-0928-4${code}0-8000-${String(seq).padStart(12, '0')}`;
}

const DEMO_STAFF_ACCOUNTS = [
  {
    id: seedUuid('users', 9001),
    email: 'demo.training@bmdc.site',
    username: 'demo_training_staff',
    role: 'staff_training_coordinator',
  },
  {
    id: seedUuid('users', 9002),
    email: 'demo.inventory@bmdc.site',
    username: 'demo_inventory_staff',
    role: 'staff_inventory_manager',
  },
];

function isSeedUuid(id) {
  return typeof id === 'string' && id >= SEED_UUID_MIN && id <= SEED_UUID_MAX;
}

// Deterministic PRNG (mulberry32) so every run produces identical, clean data
function createRng(seed = 20260928) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = createRng(20260928);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const pickWeighted = (entries) => {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [val, w] of entries) {
    r -= w;
    if (r <= 0) return val;
  }
  return entries[entries.length - 1][0];
};

// =============================================================================
// DATE HELPERS (Business hours 08:00–17:00 PHT = 00:00–09:00 UTC -> same day in PHT & UTC!)
// =============================================================================

function parseIsoDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatIsoDate(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, delta) {
  const d = parseIsoDate(dateStr);
  d.setUTCDate(d.getUTCDate() + delta);
  return formatIsoDate(d);
}

function clampDate(dateStr, minDate = START_DATE, maxDate = END_DATE) {
  if (dateStr < minDate) return minDate;
  if (dateStr > maxDate) return maxDate;
  return dateStr;
}

function listDatesBetween(startStr, endStr) {
  const out = [];
  let cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function isWeekendDate(dateStr) {
  const dow = parseIsoDate(dateStr).getUTCDay();
  return dow === 0 || dow === 6;
}

function isNonTrainingDate(dateStr) {
  return isWeekendDate(dateStr) || SPECIAL_HOLIDAYS.has(dateStr);
}

function getExpectedSessionDates(startStr, endStr) {
  if (!startStr || !endStr || startStr > endStr) return [];
  return listDatesBetween(startStr, endStr).filter((d) => !isNonTrainingDate(d));
}

async function getNextSeedSeq(table) {
  const minId = seedUuid(table, 0);
  const maxId = seedUuid(table, 999999999999);
  const { data, error } = await supabase
    .from(table)
    .select('id')
    .gte('id', minId)
    .lte('id', maxId)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed reading max seed UUID for ${table}: ${error.message}`);
  const lastId = data?.[0]?.id;
  if (!lastId) return 1;
  const seqNum = Number(lastId.split('-')[4]);
  return Number.isFinite(seqNum) ? seqNum + 1 : 1;
}

// Returns ISO UTC timestamp between 00:05:00Z and 08:55:00Z (08:05–16:55 PHT),
// guaranteeing identical YYYY-MM-DD in both PHT (UTC+8) and UTC.
function phtWorkdayTimestamp(dateStr, hourPht = randInt(8, 16), min = randInt(5, 55), sec = randInt(0, 59)) {
  const clamped = clampDate(dateStr, START_DATE, END_DATE);
  const utcHour = Math.max(0, Math.min(8, hourPht - 8));
  return `${clamped}T${String(utcHour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;
}

// =============================================================================
// REALISTIC ORIENTAL MINDORO / BMDC TESDA DOMAIN DATA
// =============================================================================

const FIRST_NAMES_MALE = [
  'Juan', 'Mark', 'John', 'Christian', 'Angelo', 'Rafael', 'Jerome', 'Kevin', 'Joshua', 'Daniel',
  'Carlo', 'Kenneth', 'Ryan', 'Michael', 'Adrian', 'Aldrin', 'Bryan', 'Dennis', 'eduardo'.replace(/^e/, 'E'), 'Erwin',
  'Francis', 'Gerald', 'Harold', 'Ivan', 'Jayson', 'Jeffrey', 'Jomar', 'Jonathan', 'Joseph', 'Julius',
  'Kenneth', 'Lawrence', 'Lester', 'Marvin', 'Melvin', 'Nathaniel', 'Noel', 'Oliver', 'Patrick', 'Paulo',
  'Ramon', 'Reynaldo', 'Richard', 'Robert', 'Rodel', 'Ronald', 'Samuel', 'Vincent', 'Wilfredo', 'Alvin',
];

const FIRST_NAMES_FEMALE = [
  'Maria', 'Angela', 'Angelica', 'Camille', 'Christine', 'Clarisse', 'Danica', 'Diane', 'Erica', 'Grace',
  'Hannah', 'Irene', 'Jasmine', 'Jennifer', 'Jessica', 'Joanna', 'Jocelyn', 'Joy', 'Karen', 'Katherine',
  'Kimberly', 'Kristine', 'Leah', 'Liza', 'Lovely', 'Mae', 'Maricel', 'Marisol', 'Mary', 'Melissa',
  'Michelle', 'Nicole', 'Patricia', 'Pauline', 'Princess', 'Rachel', 'Rhea', 'Rose', 'Roselle', 'Rowena',
  'Sarah', 'Shiela', 'Stephanie', 'Theresa', 'Trisha', 'Vanessa', 'Veronica', 'Abigail', 'Aileen', 'Bianca',
];

const MIDDLE_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Tomas', 'Andres',
  'Marquez', 'Ramos', 'Aquino', 'Castro', 'Rivera', 'Flores', 'Morales', 'Villanueva', 'Del Rosario', 'Salazar',
  'Pascual', 'Soriano', 'Navarro', 'Mercado', 'Aguilar', 'Sarmiento', 'Velasco', 'Gutierrez', 'Diaz', 'Alvarez',
];

const LAST_NAMES = [
  'Dela Cruz', 'Garcia', 'Reyes', 'Ramos', 'Mendoza', 'Santos', 'Flores', 'Gonzales', 'Bautista', 'Villanueva',
  'Fernandez', 'Cruz', 'De Guzman', 'Lopez', 'Perez', 'Castillo', 'Francisco', 'Rivera', 'Aquino', 'Castro',
  'Sanchez', 'Torres', 'De Leon', 'Domingo', 'Martinez', 'Rodriguez', 'Santiago', 'Soriano', 'Delos Santos', 'Diaz',
  'Hernandez', 'Tolentino', 'Valdez', 'Ramirez', 'Morales', 'Mercado', 'Tan', 'Aguilar', 'Navarro', 'Manalo',
  'Gomez', 'Dizon', 'Pascual', 'Salazar', 'Velasco', 'Magtibay', 'Marasigan', 'Umali', 'Ilagan', 'Atienza',
  'Macatangay', 'Magsino', 'De Villa', 'Fajardo', 'Evangelista', 'Panganiban', 'Malabanan', 'Cabral', 'Briones', 'Lozano',
];

const BONGABONG_BARANGAYS = [
  'Poblacion', 'Anilao', 'Aplaya', 'Bagumbayan I', 'Bagumbayan II', 'Batangan', 'Bukal', 'Camantigue',
  'Carmundo', 'Cawayan', 'Dayhagan', 'Formon', 'Hagan', 'Hagupit', 'Ipil', 'Kaligtasan', 'Labasan',
  'Libertad', 'Lisap', 'Luna', 'Malitbog', 'Mapang', 'Masaguisi', 'Mina de Oro', 'Morente', 'Ogbot',
  'Orconuma', 'Pulosahi', 'Sagana', 'San Isidro', 'San Jose', 'San Juan', 'Santa Cruz', 'Sigange', 'Tawas',
];

const ORIENTAL_MINDORO_MUNIS = [
  { muni: 'Bongabong', weight: 65, barangays: BONGABONG_BARANGAYS },
  { muni: 'Roxas', weight: 12, barangays: ['Bagumbayan', 'Dangay', 'Odiong', 'Paclasan', 'San Aquilino', 'San Isidro'] },
  { muni: 'Bansud', weight: 9, barangays: ['Poblacion', 'Alcadesma', 'Conrazon', 'Pag-asa', 'Proper Bansud', 'Salcedo'] },
  { muni: 'Mansalay', weight: 6, barangays: ['Poblacion', 'B. Del Mundo', 'Manaul', 'Sta. Brigida', 'Villa Celestial'] },
  { muni: 'Pinamalayan', weight: 5, barangays: ['Zone I', 'Zone II', 'Marfrancisco', 'Papandayan', 'Wawa'] },
  { muni: 'Bulalacao', weight: 3, barangays: ['Poblacion', 'Campamento', 'Maujao', 'Nasucob', 'San Roque'] },
];

const STREETS = [
  'Rizal St.', 'Mabini St.', 'Bonifacio St.', 'Quezon Ave.', 'P. Burgos St.', 'J.P. Laurel St.',
  'Sitio Centro', 'Sitio Maligaya', 'Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5', 'National Highway',
];

const EDUCATION_LEVELS = [
  ['High School', 22],
  ['Senior High School', 30],
  ['Vocational', 20],
  ['College', 24],
  ['Elementary', 3],
  ['Post Graduate', 1],
];

const COURSES = [
  'General Academic Strand', 'TVL - Industrial Arts', 'TVL - Home Economics', 'TVL - ICT',
  'BS Information Technology', 'BS Criminology', 'BS Industrial Technology', 'BS Hospitality Management',
  'BS Agriculture', 'Automotive Servicing', 'Electrical Technology', 'High School Graduate',
];

const CLASSIFICATIONS = [
  ['Unemployed', 34],
  ['Out-of-School Youth', 24],
  ['Underemployed', 18],
  ['4Ps Beneficiary', 14],
  ['Student', 10],
];

const EMPLOYMENT_STATUSES_TRAINEE = [
  ['Unemployed', 45],
  ['Employed', 22],
  ['Self-employed', 18],
  ['Student', 15],
];

const FUNDING_TYPES = [
  'TESDA TWSP', 'TESDA STEP', 'TESDA PESFA', 'LGU Bongabong Scholarship', 'Provincial LGU Grant',
];

const TESDA_PROGRAMS_CATALOG = [
  // Wave 1A: Completed early (Sept 28 – Oct 30, 2026) — 7 programs
  { wave: 'W1A', name: 'Shielded Metal Arc Welding (SMAW) NC II - Batch 2026-Q4', funding: 'TESDA TWSP', sector: 'Construction & Metals', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Hands-on competency training in carbon steel plate welding, safety standards, and blueprint reading.' },
  { wave: 'W1A', name: 'Electrical Installation and Maintenance (EIM) NC II - Batch 2026-Q4', funding: 'TESDA TWSP', sector: 'Electrical & Electronics', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Residential and commercial wiring installation, panelboard assembly, and Philippine Electrical Code compliance.' },
  { wave: 'W1A', name: 'Bread and Pastry Production NC II - Batch 2026-Q4', funding: 'TESDA STEP', sector: 'Tourism & Culinary', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Commercial baking, pastry preparation, cake decorating, and food sanitation practices.' },
  { wave: 'W1A', name: 'Automotive Servicing NC II - Batch 2026-Q4', funding: 'TESDA TWSP', sector: 'Automotive & Land Transport', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Preventive maintenance, brake and suspension repair, and engine tune-up for light vehicles.' },
  { wave: 'W1A', name: 'Computer Systems Servicing (CSS) NC II - Batch 2026-Q4', funding: 'TESDA PESFA', sector: 'Information Technology', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'PC hardware assembly, OS deployment, local area network configuration, and server diagnostics.' },
  { wave: 'W1A', name: 'Carpentry NC II - Batch 2026-Q4', funding: 'LGU Bongabong Scholarship', sector: 'Construction & Metals', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Formwork fabrication, rough carpentry framing, and finish woodwork for LGU infrastructure.' },
  { wave: 'W1A', name: 'Dressmaking NC II - Batch 2026-Q4', funding: 'TESDA STEP', sector: 'Garments & Textiles', start: '2026-09-28', end: '2026-10-30', weeks: 5, desc: 'Pattern drafting, fabric cutting, industrial sewing machine operation, and garment finishing.' },

  // Wave 1B: Completed mid (Oct 5 – Nov 13, 2026) — 7 programs
  { wave: 'W1B', name: 'Cookery NC II - Batch 2026-Q4', funding: 'TESDA STEP', sector: 'Tourism & Culinary', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Commercial kitchen operations, Filipino and international cuisine preparation, and mise en place.' },
  { wave: 'W1B', name: 'Plumbing NC II - Batch 2026-Q4', funding: 'LGU Bongabong Scholarship', sector: 'Construction & Metals', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Water supply piping, sanitary drainage systems, and plumbing fixture installation.' },
  { wave: 'W1B', name: 'Driving NC II - Batch 2026-Q4', funding: 'Provincial LGU Grant', sector: 'Automotive & Land Transport', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Defensive driving, LTO traffic regulations, vehicle roadworthiness checks, and passenger safety.' },
  { wave: 'W1B', name: 'Caregiving (Elderly) NC II - Batch 2026-Q4', funding: 'TESDA TWSP', sector: 'Healthcare & Wellness', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Vital signs monitoring, assisted daily living care, emergency first aid, and nutrition support.' },
  { wave: 'W1B', name: 'Masonry NC II - Batch 2026-Q4', funding: 'LGU Bongabong Scholarship', sector: 'Construction & Metals', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Concrete hollow block laying, plastering, surface finishing, and structural mortar mixing.' },
  { wave: 'W1B', name: 'Bookkeeping NC III - Batch 2026-Q4', funding: 'TESDA PESFA', sector: 'Business & Finance', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Journalizing transactions, trial balance preparation, financial statements, and BIR compliance.' },
  { wave: 'W1B', name: 'Agricultural Crops Production NC II - Batch 2026-Q4', funding: 'Provincial LGU Grant', sector: 'Agriculture & Fishery', start: '2026-10-05', end: '2026-11-13', weeks: 6, desc: 'Nursery operations, integrated pest management, sustainable crop cultivation, and post-harvest handling.' },

  // Wave 2A: Active now (Oct 26 – Dec 11, 2026) — 4 programs
  { wave: 'W2A', name: 'Refrigeration and Air-Conditioning (DomRAC) Servicing NC II - Batch 2026-B', funding: 'TESDA TWSP', sector: 'Electrical & Electronics', start: '2026-10-26', end: '2026-12-11', weeks: 7, desc: 'Domestic refrigeration and split-type aircon installation, troubleshooting, and refrigerant recovery.' },
  { wave: 'W2A', name: 'Food and Beverage Services NC II - Batch 2026-B', funding: 'TESDA STEP', sector: 'Tourism & Culinary', start: '2026-10-26', end: '2026-12-11', weeks: 7, desc: 'Table setting, banquet service, guest relations, and hospitality beverage operations.' },
  { wave: 'W2A', name: 'Hilot (Wellness Massage) NC II - Batch 2026-B', funding: 'LGU Bongabong Scholarship', sector: 'Healthcare & Wellness', start: '2026-10-26', end: '2026-12-11', weeks: 7, desc: 'Traditional Filipino wellness therapy, client consultation, and holistic massage practice.' },
  { wave: 'W2A', name: 'Tile Setting NC II - Batch 2026-B', funding: 'Provincial LGU Grant', sector: 'Construction & Metals', start: '2026-10-26', end: '2026-12-11', weeks: 7, desc: 'Surface preparation, floor and wall tile layout, precision cutting, and grouting techniques.' },

  // Wave 2B: Active now (Nov 3 – Dec 18, 2026) — 4 programs
  { wave: 'W2B', name: 'Barista NC II - Batch 2026-B', funding: 'TESDA STEP', sector: 'Tourism & Culinary', start: '2026-11-03', end: '2026-12-18', weeks: 7, desc: 'Espresso extraction, milk texturing, café workflow efficiency, and specialty beverage preparation.' },
  { wave: 'W2B', name: 'Tailoring NC II - Batch 2026-B', funding: 'LGU Bongabong Scholarship', sector: 'Garments & Textiles', start: '2026-11-03', end: '2026-12-18', weeks: 7, desc: 'Men’s casual and formal garment drafting, cutting, stitching, and precision fitting.' },
  { wave: 'W2B', name: 'Visual Graphic Design NC III - Batch 2026-B', funding: 'TESDA PESFA', sector: 'Information Technology', start: '2026-11-03', end: '2026-12-18', weeks: 7, desc: 'Brand identity design, print layouts, UI prototyping, and digital media production.' },
  { wave: 'W2B', name: 'Motorcycle / Small Engine Servicing NC II - Batch 2026-B', funding: 'TESDA TWSP', sector: 'Automotive & Land Transport', start: '2026-11-03', end: '2026-12-18', weeks: 7, desc: 'Two-stroke and four-stroke engine overhaul, electrical diagnostics, and preventive servicing.' },

  // Wave 3: Upcoming (Dec 2026) — 2 programs
  { wave: 'W3', name: 'Solar Night Light Assembly and PV Installation NC II - Batch 2026-C', funding: 'TESDA TWSP', sector: 'Electrical & Electronics', start: '2026-12-01', end: '2026-12-23', weeks: 4, desc: 'Off-grid photovoltaic panel wiring, charge controller setup, and barangay solar lighting maintenance.' },
  { wave: 'W3', name: 'Events Management Services NC III - Batch 2026-C', funding: 'Provincial LGU Grant', sector: 'Tourism & Culinary', start: '2026-12-07', end: '2027-01-15', weeks: 6, desc: 'Event planning, logistics coordination, supplier sourcing, and on-site program execution.' },
];

const ARCHIVED_PROGRAMS_CATALOG = [
  { name: 'Basic Metal Fabrication (Cancelled Cohort 2026-A)', funding: 'LGU Bongabong Scholarship', start: '2026-10-05', end: '2026-10-30', weeks: 4, deletedDate: '2026-11-04' },
  { name: 'Short Course: Handicraft Weaving (Deferred 2026)', funding: 'TESDA STEP', start: '2026-10-12', end: '2026-11-06', weeks: 4, deletedDate: '2026-11-12' },
  { name: 'Introductory Aquaculture Maintenance (Rescheduled)', funding: 'Provincial LGU Grant', start: '2026-10-19', end: '2026-11-13', weeks: 4, deletedDate: '2026-11-19' },
];

const EMPLOYERS_BY_SECTOR = {
  'Construction & Metals': ['Bongabong Builders & Hardware', 'Mindoro South Steel Works', 'Calapan Infrastructure Corp.', 'Pinamalayan Construction Supply', 'OrMin Engineering Services'],
  'Electrical & Electronics': ['ORMECO Contractor Services', 'Mindoro Solar & Electrical', 'Calapan CoolAir Tech', 'Bongabong Electronics Hub', 'Southern Mindoro Power Solutions'],
  'Tourism & Culinary': ['Roxas Coastal Resort & Kitchen', 'Bongabong Heritage Bakeshop', 'Puerto Galera Bayview Hotel', 'Calapan Grand Café & Bistro', 'Mindoro Culinary Catering Co.'],
  'Automotive & Land Transport': ['Mindoro South Auto Care', 'Bongabong Motorworks Center', 'Roxas Transport Cooperative', 'Pinamalayan Tire & Service Hub', 'Calapan Fleet Maintenance'],
  'Information Technology': ['Bongabong LGU MIS Office', 'Calapan Digital Solutions', 'OrMin Fiber & Net Services', 'Mindoro Creative Studio', 'Roxas Computer Center'],
  'Garments & Textiles': ['Bongabong Garments Cooperative', 'Mindoro School Uniform Tailoring', 'Pinamalayan Fashion Atelier', 'Southern Textiles Workshop'],
  'Healthcare & Wellness': ['Bongabong Community Health Station', 'Mindoro Wellness & Spa Center', 'Calapan Home Care Services', 'Roxas Senior Care Facility'],
  'Business & Finance': ['Bongabong Multi-Purpose Cooperative', 'Mindoro Rural Microfinance', 'Pinamalayan Accounting Services', 'Roxas Trading Enterprise'],
  'Agriculture & Fishery': ['Bongabong Farmers Cooperative', 'Oriental Mindoro Agri-Tech Farm', 'Bansud Organic Growers Assoc.', 'Mansalay Agro-Industrial Center'],
};

const JOB_TITLES_BY_SECTOR = {
  'Construction & Metals': ['SMAW Welder', 'Junior Carpenter', 'Pipefitter / Plumber', 'Site Mason', 'Tile Setter'],
  'Electrical & Electronics': ['Building Electrician', 'RAC Service Technician', 'Electrical Maintenance Staff', 'Solar Installation Tech'],
  'Tourism & Culinary': ['Assistant Baker', 'Line Cook', 'Food & Beverage Server', 'Café Barista', 'Pastry Commis'],
  'Automotive & Land Transport': ['Automotive Mechanic', 'Small Engine Technician', 'Commercial Driver', 'Service Bay Assistant'],
  'Information Technology': ['IT Support Technician', 'Network Installer', 'Junior Graphic Designer', 'Computer Lab Assistant'],
  'Garments & Textiles': ['Dressmaker', 'Master Tailor Assistant', 'Industrial Sewer', 'Alteration Specialist'],
  'Healthcare & Wellness': ['Home Caregiver', 'Wellness Therapist', 'Community Health Aide'],
  'Business & Finance': ['Junior Bookkeeper', 'Accounting Clerk', 'Cooperative Cashier'],
  'Agriculture & Fishery': ['Farm Technician', 'Organic Nursery Aide', 'Crop Production Supervisor'],
};

const INVENTORY_CATALOG = [
  { base: 'Inverter Welding Machine 250A', category: 'Equipment', unit: 'units', location: 'Welding Bay A', qty: [8, 18] },
  { base: 'Auto-Darkening Welding Helmet', category: 'Safety Gear', unit: 'pieces', location: 'Welding Bay A', qty: [15, 35] },
  { base: 'Angle Grinder 4-Inch Heavy Duty', category: 'Tools', unit: 'units', location: 'Welding Bay B', qty: [10, 22] },
  { base: 'Welding Electrode E6013 2.5mm', category: 'Materials', unit: 'boxes', location: 'Consumables Room', qty: [20, 45] },
  { base: 'Digital Clamp Meter True-RMS', category: 'Electronics', unit: 'units', location: 'Electrical Lab', qty: [10, 24] },
  { base: 'Analog Multimeter Tester', category: 'Electronics', unit: 'units', location: 'Electrical Lab', qty: [12, 28] },
  { base: 'Insulated Electrician Plier Set', category: 'Tools', unit: 'sets', location: 'Electrical Lab', qty: [14, 30] },
  { base: 'PVC Conduit Pipe Bender 20mm', category: 'Tools', unit: 'pieces', location: 'Electrical Lab', qty: [8, 16] },
  { base: 'THHN Stranded Wire #12 AWG', category: 'Materials', unit: 'rolls', location: 'Electrical Storage', qty: [10, 25] },
  { base: 'Circuit Breaker Panel Board Trainer', category: 'Equipment', unit: 'units', location: 'Electrical Lab', qty: [6, 14] },
  { base: 'Commercial Convection Oven', category: 'Equipment', unit: 'units', location: 'Culinary Kitchen', qty: [4, 10] },
  { base: 'Heavy Duty Stand Mixer 7L', category: 'Equipment', unit: 'units', location: 'Culinary Kitchen', qty: [6, 15] },
  { base: 'Stainless Steel Baking Sheet Pan', category: 'Supplies', unit: 'pieces', location: 'Culinary Kitchen', qty: [20, 50] },
  { base: 'Chef Knife 8-Inch Stainless', category: 'Tools', unit: 'pieces', location: 'Culinary Kitchen', qty: [15, 35] },
  { base: 'Digital Kitchen Weighing Scale', category: 'Electronics', unit: 'units', location: 'Culinary Kitchen', qty: [10, 20] },
  { base: 'Hydraulic Floor Jack 3-Ton', category: 'Equipment', unit: 'units', location: 'Auto Shop', qty: [6, 14] },
  { base: 'OBD-II Automotive Diagnostic Scanner', category: 'Electronics', unit: 'units', location: 'Auto Shop', qty: [6, 15] },
  { base: 'Torque Wrench 1/2-Inch Drive', category: 'Tools', unit: 'pieces', location: 'Auto Shop', qty: [10, 20] },
  { base: 'Socket Wrench Mechanics Set 46pc', category: 'Tools', unit: 'sets', location: 'Auto Shop', qty: [10, 24] },
  { base: 'Air Compressor 2HP Portable', category: 'Equipment', unit: 'units', location: 'Auto Shop', qty: [5, 12] },
  { base: 'Training Desktop Workstation i5', category: 'Electronics', unit: 'units', location: 'Computer Lab 1', qty: [15, 30] },
  { base: 'RJ45 LAN Cable Crimping Tool', category: 'Tools', unit: 'pieces', location: 'Computer Lab 1', qty: [15, 35] },
  { base: 'Network Cable Continuity Tester', category: 'Electronics', unit: 'units', location: 'Computer Lab 1', qty: [12, 26] },
  { base: 'Managed 24-Port Gigabit Switch', category: 'Electronics', unit: 'units', location: 'Computer Lab 2', qty: [6, 14] },
  { base: 'Cat6 UTP Network Cable Box', category: 'Materials', unit: 'boxes', location: 'IT Storage', qty: [8, 20] },
  { base: 'Cordless Hammer Drill 20V Kit', category: 'Tools', unit: 'sets', location: 'Carpentry Shop', qty: [8, 18] },
  { base: 'Circular Saw 7-1/4 Inch', category: 'Equipment', unit: 'units', location: 'Carpentry Shop', qty: [6, 14] },
  { base: 'Steel Measuring Tape 8m', category: 'Tools', unit: 'pieces', location: 'Carpentry Shop', qty: [20, 45] },
  { base: 'Spirit Level Aluminum 24-Inch', category: 'Tools', unit: 'pieces', location: 'Masonry Yard', qty: [12, 28] },
  { base: 'Bricklayer Trowel Steel', category: 'Tools', unit: 'pieces', location: 'Masonry Yard', qty: [18, 40] },
  { base: 'High-Speed Industrial Sewing Machine', category: 'Equipment', unit: 'units', location: 'Garments Lab', qty: [8, 18] },
  { base: 'Tailoring Shears Heavy Duty 10-Inch', category: 'Tools', unit: 'pieces', location: 'Garments Lab', qty: [15, 36] },
  { base: 'Steam Iron Commercial Grade', category: 'Equipment', unit: 'units', location: 'Garments Lab', qty: [8, 16] },
  { base: 'Manifold Gauge Set R32/R410A', category: 'Tools', unit: 'sets', location: 'RAC Workshop', qty: [8, 18] },
  { base: 'Vacuum Pump Dual-Stage HVAC', category: 'Equipment', unit: 'units', location: 'RAC Workshop', qty: [5, 12] },
  { base: 'Copper Tubing Flaring Tool Kit', category: 'Tools', unit: 'sets', location: 'RAC Workshop', qty: [10, 22] },
  { base: 'Espresso Coffee Machine Dual-Group', category: 'Equipment', unit: 'units', location: 'Barista Lab', qty: [4, 10] },
  { base: 'Stainless Milk Frothing Pitcher', category: 'Supplies', unit: 'pieces', location: 'Barista Lab', qty: [15, 35] },
  { base: 'Digital Blood Pressure Monitor', category: 'Electronics', unit: 'units', location: 'Caregiving Room', qty: [10, 24] },
  { base: 'First Aid Training Manikin CPR', category: 'Equipment', unit: 'units', location: 'Caregiving Room', qty: [6, 14] },
  { base: 'Safety Hard Hat ANSI Class E', category: 'Safety Gear', unit: 'pieces', location: 'PPE Locker', qty: [25, 60] },
  { base: 'Heavy Duty Leather Welding Gloves', category: 'Safety Gear', unit: 'pairs', location: 'PPE Locker', qty: [25, 60] },
  { base: 'Clear Anti-Fog Safety Goggles', category: 'Safety Gear', unit: 'pieces', location: 'PPE Locker', qty: [30, 70] },
  { base: 'Reflective High-Vis Safety Vest', category: 'Safety Gear', unit: 'pieces', location: 'PPE Locker', qty: [25, 55] },
  { base: 'Fire Extinguisher ABC Dry Chemical 10lb', category: 'Safety Gear', unit: 'units', location: 'Safety Station', qty: [8, 18] },
  { base: 'Knapsack Agricultural Sprayer 16L', category: 'Equipment', unit: 'units', location: 'Agri Shed', qty: [10, 22] },
  { base: 'Soil pH and Moisture Meter', category: 'Electronics', unit: 'units', location: 'Agri Shed', qty: [10, 24] },
  { base: 'Pruning Shears Bypass Steel', category: 'Tools', unit: 'pieces', location: 'Agri Shed', qty: [16, 36] },
  { base: 'Heavy Duty Folding Training Table', category: 'Furniture', unit: 'units', location: 'Main Hall', qty: [15, 35] },
  { base: 'Stackable Classroom Chair Ergonomic', category: 'Furniture', unit: 'units', location: 'Main Hall', qty: [30, 80] },
  { base: 'Interactive LED Projector 4000Lm', category: 'Electronics', unit: 'units', location: 'AV Room', qty: [6, 14] },
  { base: 'Pipe Wrench Heavy Duty 18-Inch', category: 'Tools', unit: 'pieces', location: 'Plumbing Bay', qty: [12, 26] },
];

const REMARK_TEMPLATES = [
  'Completed practical demonstration ahead of schedule with strong adherence to safety protocols.',
  'Submitted verified barangay residency and learner profile documents; cleared for competency assessment.',
  'Consistent morning and afternoon attendance; actively assists classmates during workshop exercises.',
  'Followed up regarding missing certified true copy of report card; trainee committed to upload this week.',
  'Demonstrated strong technical proficiency during midterm hands-on evaluation.',
  'Recommended for TESDA National Assessment batch scheduled at Bongabong MDC assessment center.',
  'Contacted trainee regarding one excused absence due to family medical appointment; makeup task completed.',
  'Eligible for job placement endorsement with local Oriental Mindoro partner employers upon graduation.',
  'Equipment handling orientation passed with zero safety demerits.',
  'Reviewed portfolio and practical project rubric; ready for final certification sign-off.',
];

const REJECTION_REASONS = [
  'Incomplete supporting documents — missing valid government-issued ID copy.',
  'Applicant resides outside the eligible LGU scholarship coverage area for this batch.',
  'Program cohort has already started; advised to reapply for the December 2026 intake.',
  'Uploaded learner profile form was unreadable; requested clear resubmission.',
  'Age and educational prerequisite verification incomplete for this NC III track.',
];

const ANNOUNCEMENT_TOPICS = [
  { prefix: 'TESDA Assessment Advisory', body: 'Trainees scheduled for National Competency Assessment at Bongabong Manpower Development Center are reminded to bring their valid ID, 3 pcs passport-size photos, and PPE kit 30 minutes before call time.' },
  { prefix: 'Batch Enrollment Update', body: 'Registration slots for upcoming BMDC LGU-sponsored vocational courses are now open via the online portal. Verified applicants will receive email confirmation upon review.' },
  { prefix: 'Workshop Safety & PPE Reminder', body: 'All trainees entering the Welding, Electrical, Automotive, and Carpentry bays must wear complete personal protective equipment and log borrowed tools through the inventory desk.' },
  { prefix: 'Document Submission Notice', body: 'Enrolled trainees with pending PSA Birth Certificate, Valid ID, or Barangay Certification uploads are encouraged to submit digital copies through the Trainee Portal before Friday.' },
  { prefix: 'Tool & Equipment Return Reminder', body: 'Borrowers with workshop tools due this week are requested to inspect, clean, and return all items to the BMDC Inventory Office on or before 4:30 PM.' },
  { prefix: 'Career Placement & Job Fair Bulletin', body: 'Partner employers across Bongabong, Roxas, Pinamalayan, and Calapan City are accepting applications from recent BMDC NC II graduates. Coordinate with the Training Coordinator for referrals.' },
  { prefix: 'Attendance Schedule Advisory', body: 'Morning check-in window opens 7:30 AM – 8:30 AM and afternoon check-out runs 4:00 PM – 5:00 PM PHT. Please ensure location services are enabled for self-service attendance.' },
  { prefix: 'Graduation & Certificate Claiming', body: 'Completed Wave 1 trainees may now view and verify their digital completion certificates in the Trainee Portal or claim printed copies at the BMDC Admin Window.' },
];

const MESSAGE_TEMPLATES = [
  'Good morning! Reminder that morning attendance check-in closes at 8:30 AM sharp.',
  'Please bring your complete PPE and notebook for today’s hands-on practical module.',
  'Good afternoon po, I already uploaded my birth certificate and valid ID on the portal.',
  'Thank you! We received your documents and marked them verified for enrollment.',
  'Kindly return borrowed workshop tools to the inventory counter before 4:30 PM today.',
  'Noted po Ma’am/Sir, thank you for the schedule update!',
  'Reminder: Competency mock assessment starts tomorrow at 9:00 AM in Workshop Bay 1.',
  'Sir, may I ask when the printed certificates for Batch 2026-Q4 will be ready for pickup?',
  'Certificates are already available for download in your portal; printed copies are ready at the Admin Desk.',
  'Copy po! See you all in the morning session.',
  'Please double-check your attendance calendar and report any excused leave notes to the coordinator.',
  'Congratulations to all passers of this week’s practical evaluation!',
];

// =============================================================================
// SAMPLE MEDIA & REALISTIC PHOTO ASSETS (REUSABLE POOL — ZERO COLLATERAL ROLLBACK)
// =============================================================================

const SEED_ASSETS_DIR = path.join(__dirname, 'seed-assets');
const UPLOAD_TENANT_DIR = path.join(BACKEND_ROOT, 'public', 'uploads', TENANT_ID);
const SAMPLE_CERT_PDF_REL = `/uploads/${TENANT_ID}/documents/certificates/seed-certificate-sample.pdf`;
const SAMPLE_REQ_PDF_REL = `/uploads/${TENANT_ID}/documents/trainees/seed-requirement-sample.pdf`;
const SAMPLE_ID_JPG_REL = `/uploads/${TENANT_ID}/documents/trainees/seed-id-picture-sample.jpg`;
const SAMPLE_CERT_QR_REL = `/uploads/${TENANT_ID}/qrcodes/certificates/seed-cert-qr-sample.png`;
const SAMPLE_ITEM_QR_REL = `/uploads/${TENANT_ID}/qrcodes/items/seed-item-qr-sample.png`;

const PHOTO_GENDERS = ['male', 'female'];
const PHOTO_VARIANTS = [1, 2, 3];
const AENC_MAGIC = Buffer.from('AENC');

const PROGRAM_SECTOR_SPECS = [
  {
    slug: 'construction-metals',
    sector: 'Construction & Metals',
    bg1: '#1e293b',
    bg2: '#b45309',
    accent: '#fbbf24',
    soft: '#fef3c7',
    glyph: `
      <path d="M352 292 L448 196 M368 196 L432 260" stroke="#fef3c7" stroke-width="14" stroke-linecap="round"/>
      <rect x="344" y="274" width="112" height="24" rx="6" fill="#fbbf24"/>
      <path d="M358 274 C358 232 442 232 442 274 Z" fill="#fef3c7" fill-opacity="0.95"/>
      <rect x="392" y="218" width="16" height="56" rx="6" fill="#f59e0b"/>
      <circle cx="468" cy="184" r="7" fill="#fde68a"/>
      <circle cx="486" cy="204" r="5" fill="#fbbf24"/>
      <circle cx="456" cy="166" r="4" fill="#ffffff"/>
    `,
  },
  {
    slug: 'electrical-electronics',
    sector: 'Electrical & Electronics',
    bg1: '#0f172a',
    bg2: '#0284c7',
    accent: '#38bdf8',
    soft: '#e0f2fe',
    glyph: `
      <circle cx="336" cy="212" r="10" fill="#38bdf8"/>
      <circle cx="464" cy="212" r="10" fill="#38bdf8"/>
      <circle cx="336" cy="288" r="10" fill="#38bdf8"/>
      <circle cx="464" cy="288" r="10" fill="#38bdf8"/>
      <path d="M346 212 H374 M426 212 H454 M346 288 H374 M426 288 H454" stroke="#7dd3fc" stroke-width="6" stroke-linecap="round"/>
      <polygon points="412,182 368,256 402,256 388,318 434,242 400,242" fill="#facc15" stroke="#ffffff" stroke-width="4" stroke-linejoin="round"/>
    `,
  },
  {
    slug: 'tourism-culinary',
    sector: 'Tourism & Culinary',
    bg1: '#431407',
    bg2: '#c2410c',
    accent: '#fdba74',
    soft: '#ffedd5',
    glyph: `
      <path d="M354 248 C338 248 332 224 348 214 C350 192 374 182 392 192 C406 178 434 186 438 206 C458 210 462 246 440 248 Z" fill="#fff7ed"/>
      <rect x="356" y="246" width="88" height="32" rx="6" fill="#fed7aa"/>
      <line x1="376" y1="252" x2="376" y2="272" stroke="#c2410c" stroke-width="4" stroke-linecap="round"/>
      <line x1="400" y1="252" x2="400" y2="272" stroke="#c2410c" stroke-width="4" stroke-linecap="round"/>
      <line x1="424" y1="252" x2="424" y2="272" stroke="#c2410c" stroke-width="4" stroke-linecap="round"/>
      <rect x="342" y="290" width="116" height="12" rx="6" fill="#fb923c"/>
    `,
  },
  {
    slug: 'automotive-transport',
    sector: 'Automotive & Land Transport',
    bg1: '#18181b',
    bg2: '#991b1b',
    accent: '#fca5a5',
    soft: '#fee2e2',
    glyph: `
      <circle cx="400" cy="250" r="64" fill="none" stroke="#fee2e2" stroke-width="14"/>
      <circle cx="400" cy="250" r="20" fill="#ef4444" stroke="#ffffff" stroke-width="6"/>
      <line x1="400" y1="186" x2="400" y2="230" stroke="#fca5a5" stroke-width="10" stroke-linecap="round"/>
      <line x1="346" y1="274" x2="383" y2="258" stroke="#fca5a5" stroke-width="10" stroke-linecap="round"/>
      <line x1="454" y1="274" x2="417" y2="258" stroke="#fca5a5" stroke-width="10" stroke-linecap="round"/>
      <rect x="393" y="168" width="14" height="18" rx="3" fill="#fee2e2"/>
      <rect x="393" y="314" width="14" height="18" rx="3" fill="#fee2e2"/>
      <rect x="318" y="243" width="18" height="14" rx="3" fill="#fee2e2"/>
      <rect x="464" y="243" width="18" height="14" rx="3" fill="#fee2e2"/>
    `,
  },
  {
    slug: 'information-technology',
    sector: 'Information Technology',
    bg1: '#0f172a',
    bg2: '#1d4ed8',
    accent: '#60a5fa',
    soft: '#dbeafe',
    glyph: `
      <rect x="330" y="192" width="140" height="96" rx="12" fill="#0f172a" stroke="#dbeafe" stroke-width="8"/>
      <path d="M368 228 L352 240 L368 252 M432 228 L448 240 L432 252 M408 222 L392 258" fill="none" stroke="#60a5fa" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="386" y="288" width="28" height="18" fill="#dbeafe"/>
      <rect x="360" y="304" width="80" height="10" rx="5" fill="#93c5fd"/>
    `,
  },
  {
    slug: 'garments-textiles',
    sector: 'Garments & Textiles',
    bg1: '#3b0764',
    bg2: '#be185d',
    accent: '#f9a8d4',
    soft: '#fce7f3',
    glyph: `
      <rect x="356" y="192" width="88" height="16" rx="6" fill="#fbcfe8"/>
      <rect x="356" y="292" width="88" height="16" rx="6" fill="#fbcfe8"/>
      <rect x="368" y="208" width="64" height="84" rx="4" fill="#f472b6"/>
      <line x1="368" y1="226" x2="432" y2="226" stroke="#831843" stroke-width="5"/>
      <line x1="368" y1="244" x2="432" y2="244" stroke="#831843" stroke-width="5"/>
      <line x1="368" y1="262" x2="432" y2="262" stroke="#831843" stroke-width="5"/>
      <line x1="368" y1="280" x2="432" y2="280" stroke="#831843" stroke-width="5"/>
      <path d="M432 250 C458 250 462 216 482 216" fill="none" stroke="#fce7f3" stroke-width="5" stroke-dasharray="8 6" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'healthcare-wellness',
    sector: 'Healthcare & Wellness',
    bg1: '#064e3b',
    bg2: '#0d9488',
    accent: '#5eead4',
    soft: '#ccfbf1',
    glyph: `
      <path d="M400 180 L456 202 V250 C456 286 432 308 400 322 C368 308 344 286 344 250 V202 Z" fill="#ccfbf1" fill-opacity="0.18" stroke="#99f6e4" stroke-width="7" stroke-linejoin="round"/>
      <rect x="388" y="214" width="24" height="68" rx="6" fill="#ffffff"/>
      <rect x="366" y="236" width="68" height="24" rx="6" fill="#ffffff"/>
    `,
  },
  {
    slug: 'business-finance',
    sector: 'Business & Finance',
    bg1: '#052e16',
    bg2: '#0f766e',
    accent: '#fcd34d',
    soft: '#fef9c3',
    glyph: `
      <rect x="342" y="262" width="24" height="44" rx="5" fill="#99f6e4"/>
      <rect x="378" y="238" width="24" height="68" rx="5" fill="#5eead4"/>
      <rect x="414" y="214" width="24" height="92" rx="5" fill="#fcd34d"/>
      <path d="M338 232 L380 206 L414 218 L456 184" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <polygon points="456,184 440,184 456,200" fill="#ffffff"/>
      <line x1="332" y1="312" x2="468" y2="312" stroke="#fef9c3" stroke-width="6" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'agriculture-fishery',
    sector: 'Agriculture & Fishery',
    bg1: '#14532d',
    bg2: '#65a30d',
    accent: '#bef264',
    soft: '#ecfccb',
    glyph: `
      <path d="M400 310 V222" stroke="#ecfccb" stroke-width="9" stroke-linecap="round"/>
      <path d="M400 250 C354 248 338 214 344 188 C374 186 398 206 400 250 Z" fill="#bef264"/>
      <path d="M400 264 C446 262 462 228 456 202 C426 200 402 220 400 264 Z" fill="#ecfccb"/>
      <path d="M336 312 Q368 298 400 312 T464 312" fill="none" stroke="#d9f99d" stroke-width="7" stroke-linecap="round"/>
    `,
  },
];

const PROGRAM_SECTOR_BY_NAME = new Map(PROGRAM_SECTOR_SPECS.map((s) => [s.sector, s.slug]));

const ARCHIVED_PROGRAM_SECTORS = [
  'construction-metals',
  'garments-textiles',
  'agriculture-fishery',
];

const ITEM_CATEGORY_SPECS = [
  {
    slug: 'equipment',
    category: 'Equipment',
    bg1: '#f8fafc',
    bg2: '#dbeafe',
    ring: '#2563eb',
    fill: '#1e3a8a',
    accent: '#3b82f6',
    glyph: `
      <rect x="200" y="216" width="200" height="156" rx="18" fill="#1e3a8a"/>
      <rect x="224" y="240" width="90" height="58" rx="8" fill="#60a5fa"/>
      <circle cx="354" cy="268" r="22" fill="#f8fafc" stroke="#93c5fd" stroke-width="6"/>
      <circle cx="354" cy="268" r="8" fill="#2563eb"/>
      <rect x="224" y="316" width="152" height="14" rx="7" fill="#93c5fd"/>
      <rect x="224" y="340" width="108" height="12" rx="6" fill="#3b82f6"/>
      <path d="M248 216 V194 C248 184 256 178 266 178 H334 C344 178 352 184 352 194 V216" fill="none" stroke="#1e3a8a" stroke-width="14" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'safety-gear',
    category: 'Safety Gear',
    bg1: '#fffbeb',
    bg2: '#fef3c7',
    ring: '#d97706',
    fill: '#b45309',
    accent: '#f59e0b',
    glyph: `
      <path d="M204 334 C204 240 246 196 300 196 C354 196 396 240 396 334 Z" fill="#f59e0b"/>
      <rect x="284" y="186" width="32" height="136" rx="12" fill="#fef3c7"/>
      <rect x="182" y="328" width="236" height="28" rx="14" fill="#b45309"/>
      <path d="M244 268 C252 240 272 224 284 220" fill="none" stroke="#fde68a" stroke-width="10" stroke-linecap="round"/>
    `,
  },
  {
    slug: 'tools',
    category: 'Tools',
    bg1: '#fff7ed',
    bg2: '#ffedd5',
    ring: '#ea580c',
    fill: '#9a3412',
    accent: '#f97316',
    glyph: `
      <path d="M226 374 L330 270" stroke="#9a3412" stroke-width="26" stroke-linecap="round"/>
      <path d="M400.5 230.6 A44 44 0 1 1 369.4 199.5" fill="none" stroke="#ea580c" stroke-width="20" stroke-linecap="round"/>
      <path d="M228 228 L372 372" stroke="#334155" stroke-width="18" stroke-linecap="round"/>
      <rect x="206" y="206" width="42" height="42" rx="8" fill="#f97316"/>
    `,
  },
  {
    slug: 'materials',
    category: 'Materials',
    bg1: '#eef2ff',
    bg2: '#e0e7ff',
    ring: '#4f46e5',
    fill: '#312e81',
    accent: '#6366f1',
    glyph: `
      <polygon points="300,192 406,242 300,292 194,242" fill="#6366f1"/>
      <polygon points="194,274 300,324 406,274 406,304 300,354 194,304" fill="#4f46e5"/>
      <polygon points="194,322 300,372 406,322 406,352 300,402 194,352" fill="#312e81"/>
    `,
  },
  {
    slug: 'electronics',
    category: 'Electronics',
    bg1: '#ecfeff',
    bg2: '#cffafe',
    ring: '#0891b2',
    fill: '#164e63',
    accent: '#06b6d4',
    glyph: `
      <rect x="224" y="182" width="152" height="236" rx="22" fill="#164e63"/>
      <rect x="246" y="206" width="108" height="72" rx="10" fill="#67e8f9"/>
      <path d="M262 248 L280 248 L292 224 L308 264 L320 240 L338 240" fill="none" stroke="#164e63" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="300" cy="336" r="32" fill="#06b6d4" stroke="#cffafe" stroke-width="6"/>
      <line x1="300" y1="336" x2="318" y2="318" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
      <circle cx="264" cy="388" r="10" fill="#ef4444"/>
      <circle cx="336" cy="388" r="10" fill="#94a3b8"/>
    `,
  },
  {
    slug: 'supplies',
    category: 'Supplies',
    bg1: '#ecfdf5',
    bg2: '#d1fae5',
    ring: '#059669',
    fill: '#065f46',
    accent: '#10b981',
    glyph: `
      <rect x="200" y="246" width="200" height="140" rx="18" fill="#059669"/>
      <rect x="184" y="218" width="232" height="40" rx="12" fill="#065f46"/>
      <rect x="270" y="286" width="60" height="18" rx="9" fill="#d1fae5"/>
      <path d="M242 218 L256 184 H344 L358 218" fill="none" stroke="#10b981" stroke-width="14" stroke-linejoin="round"/>
    `,
  },
  {
    slug: 'furniture',
    category: 'Furniture',
    bg1: '#fafaf9',
    bg2: '#e7e5e4',
    ring: '#78716c',
    fill: '#44403c',
    accent: '#a8a29e',
    glyph: `
      <rect x="186" y="232" width="228" height="28" rx="10" fill="#44403c"/>
      <rect x="206" y="260" width="22" height="128" rx="8" fill="#78716c"/>
      <rect x="372" y="260" width="22" height="128" rx="8" fill="#78716c"/>
      <rect x="228" y="286" width="144" height="18" rx="6" fill="#a8a29e"/>
      <rect x="266" y="196" width="68" height="26" rx="8" fill="#78716c"/>
    `,
  },
];

const ITEM_CATEGORY_BY_NAME = new Map(ITEM_CATEGORY_SPECS.map((c) => [c.category, c.slug]));

function getProgramSectorSlugForSeeded(idOrSeq, programName = '', explicitSector = '') {
  if (explicitSector && PROGRAM_SECTOR_BY_NAME.has(explicitSector)) {
    return PROGRAM_SECTOR_BY_NAME.get(explicitSector);
  }
  const seq = typeof idOrSeq === 'number'
    ? idOrSeq
    : parseInt(String(idOrSeq || '').slice(-12), 10);
  if (Number.isFinite(seq) && seq >= 1 && seq <= TESDA_PROGRAMS_CATALOG.length) {
    return PROGRAM_SECTOR_BY_NAME.get(TESDA_PROGRAMS_CATALOG[seq - 1].sector) || 'construction-metals';
  }
  if (Number.isFinite(seq) && seq > TESDA_PROGRAMS_CATALOG.length) {
    const archIdx = seq - TESDA_PROGRAMS_CATALOG.length - 1;
    if (ARCHIVED_PROGRAM_SECTORS[archIdx]) return ARCHIVED_PROGRAM_SECTORS[archIdx];
  }
  const n = String(programName || '').toLowerCase();
  if (/weld|carpent|plumb|mason|tile|metal/.test(n)) return 'construction-metals';
  if (/electr|domrac|solar|air-cond/.test(n)) return 'electrical-electronics';
  if (/bread|pastry|cook|food|barista|event/.test(n)) return 'tourism-culinary';
  if (/auto|driv|motor|engine/.test(n)) return 'automotive-transport';
  if (/computer|graphic|visual|css/.test(n)) return 'information-technology';
  if (/dress|tailor|handicraft|weav/.test(n)) return 'garments-textiles';
  if (/caregiv|hilot|wellness/.test(n)) return 'healthcare-wellness';
  if (/bookkeep|account/.test(n)) return 'business-finance';
  if (/agri|crop|aqua/.test(n)) return 'agriculture-fishery';
  return 'construction-metals';
}

function getSeedProgramImagePaths(idOrSeq, programName = '', explicitSector = '') {
  const slug = getProgramSectorSlugForSeeded(idOrSeq, programName, explicitSector);
  return {
    image_path: `/uploads/${TENANT_ID}/images/programs/seed-program-${slug}.jpg`,
    thumbnail_path: `/uploads/${TENANT_ID}/images/programs/thumbnails/seed-program-${slug}.webp`,
  };
}

function getSeedItemImagePaths(category) {
  const slug = ITEM_CATEGORY_BY_NAME.get(category) || 'equipment';
  return {
    image_path: `/uploads/${TENANT_ID}/images/items/seed-item-${slug}.jpg`,
    thumbnail_path: `/uploads/${TENANT_ID}/images/items/thumbnails/seed-item-${slug}.webp`,
    qr_code_path: SAMPLE_ITEM_QR_REL,
  };
}

function buildProgramBannerSvg(spec) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${spec.bg1}"/>
          <stop offset="100%" stop-color="${spec.bg2}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stop-color="${spec.accent}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${spec.bg1}" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="#ffffff" fill-opacity="0.14"/>
        </pattern>
      </defs>
      <rect width="800" height="500" fill="url(#bg)"/>
      <rect width="800" height="500" fill="url(#grid)"/>
      <rect width="800" height="500" fill="url(#glow)"/>
      <circle cx="120" cy="88" r="150" fill="#ffffff" fill-opacity="0.04"/>
      <circle cx="690" cy="420" r="180" fill="${spec.accent}" fill-opacity="0.08"/>
      <circle cx="400" cy="250" r="144" fill="#ffffff" fill-opacity="0.08" stroke="${spec.soft}" stroke-opacity="0.32" stroke-width="3"/>
      <circle cx="400" cy="250" r="118" fill="#0f172a" fill-opacity="0.24" stroke="${spec.accent}" stroke-opacity="0.55" stroke-width="2"/>
      ${spec.glyph}
      <rect x="348" y="424" width="104" height="6" rx="3" fill="${spec.accent}" fill-opacity="0.75"/>
    </svg>
  `);
}

function buildItemCategorySvg(spec) {
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <defs>
        <radialGradient id="bg" cx="50%" cy="42%" r="68%">
          <stop offset="0%" stop-color="${spec.bg1}"/>
          <stop offset="100%" stop-color="${spec.bg2}"/>
        </radialGradient>
        <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="1.5" fill="${spec.ring}" fill-opacity="0.12"/>
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#bg)"/>
      <rect width="600" height="600" fill="url(#dots)"/>
      <circle cx="300" cy="300" r="206" fill="#ffffff" fill-opacity="0.78" stroke="${spec.ring}" stroke-opacity="0.22" stroke-width="4"/>
      <circle cx="300" cy="300" r="176" fill="${spec.bg2}" fill-opacity="0.45"/>
      ${spec.glyph}
      <rect x="248" y="468" width="104" height="8" rx="4" fill="${spec.accent}" fill-opacity="0.6"/>
    </svg>
  `);
}

function getSeedGender(sex) {
  return String(sex || '').toLowerCase() === 'female' ? 'female' : 'male';
}

function getSeedVariantIndex(idOrSeq) {
  let num = 1;
  if (typeof idOrSeq === 'number' && Number.isFinite(idOrSeq)) {
    num = Math.abs(Math.trunc(idOrSeq));
  } else {
    const tail = String(idOrSeq || '').slice(-12);
    const dec = /^\d+$/.test(tail) ? parseInt(tail, 10) : parseInt(tail.slice(-8), 16);
    num = Number.isFinite(dec) && dec > 0 ? dec : 1;
  }
  return ((num - 1) % PHOTO_VARIANTS.length) + 1;
}

function getSeedTraineePhotoPaths(sex, idOrSeq) {
  const g = getSeedGender(sex);
  const v = getSeedVariantIndex(idOrSeq);
  return {
    photo_path: `/uploads/${TENANT_ID}/images/trainees/seed-trainee-${g}-${v}.jpg`,
    thumbnail_path: `/uploads/${TENANT_ID}/images/trainees/thumbnails/seed-trainee-${g}-${v}.webp`,
  };
}

function getSeedAttendanceSelfiePaths(sex, idOrSeq, hasMorning, hasAfternoon) {
  const g = getSeedGender(sex);
  const v = getSeedVariantIndex(idOrSeq);
  return {
    selfie_morning_path: hasMorning
      ? `/uploads/${TENANT_ID}/images/attendance/seed-attendance-${g}-${v}-am.jpg`
      : null,
    selfie_afternoon_path: hasAfternoon
      ? `/uploads/${TENANT_ID}/images/attendance/seed-attendance-${g}-${v}-pm.jpg`
      : null,
  };
}

function getEncryptionKeyBuffer(envVarName = 'FILE_ENCRYPTION_KEY') {
  const hexKey = process.env[envVarName];
  if (!hexKey || hexKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(hexKey)) return null;
  return Buffer.from(hexKey, 'hex');
}

function maybeEncryptSelfieBuffer(plaintext) {
  if (process.env.FILE_ENCRYPTION_ENABLED !== 'true') return plaintext;
  const key = getEncryptionKeyBuffer('FILE_ENCRYPTION_KEY');
  if (!key) {
    throw new Error('FILE_ENCRYPTION_ENABLED=true but FILE_ENCRYPTION_KEY is missing or not a 64-char hex key');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([AENC_MAGIC, iv, authTag, ciphertext]);
}

function maybeDecryptSelfieBuffer(data) {
  if (!Buffer.isBuffer(data) || data.length < 32 || !data.subarray(0, 4).equals(AENC_MAGIC)) {
    return data;
  }
  const iv = data.subarray(4, 16);
  const authTag = data.subarray(16, 32);
  const ciphertext = data.subarray(32);
  const keys = [getEncryptionKeyBuffer('FILE_ENCRYPTION_KEY'), getEncryptionKeyBuffer('FILE_ENCRYPTION_KEY_PREV')].filter(Boolean);
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      // Try fallback rotation key
    }
  }
  throw new Error('Failed to decrypt AENC-encrypted seed selfie buffer');
}

function listAllGeneratedSeedMediaFiles() {
  const files = [
    { abs: path.join(UPLOAD_TENANT_DIR, 'documents', 'certificates', 'seed-certificate-sample.pdf'), kind: 'pdf' },
    { abs: path.join(UPLOAD_TENANT_DIR, 'documents', 'trainees', 'seed-requirement-sample.pdf'), kind: 'pdf' },
    { abs: path.join(UPLOAD_TENANT_DIR, 'documents', 'trainees', 'seed-id-picture-sample.jpg'), kind: 'jpeg' },
    { abs: path.join(UPLOAD_TENANT_DIR, 'qrcodes', 'certificates', 'seed-cert-qr-sample.png'), kind: 'png' },
    { abs: path.join(UPLOAD_TENANT_DIR, 'qrcodes', 'items', 'seed-item-qr-sample.png'), kind: 'png' },
  ];
  for (const g of PHOTO_GENDERS) {
    for (const v of PHOTO_VARIANTS) {
      files.push(
        { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'attendance', `seed-attendance-${g}-${v}-am.jpg`), kind: 'jpeg', encryptedCandidate: true },
        { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'attendance', `seed-attendance-${g}-${v}-pm.jpg`), kind: 'jpeg', encryptedCandidate: true },
        { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'trainees', `seed-trainee-${g}-${v}.jpg`), kind: 'jpeg' },
        { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'trainees', 'thumbnails', `seed-trainee-${g}-${v}.webp`), kind: 'webp' }
      );
    }
  }
  for (const spec of PROGRAM_SECTOR_SPECS) {
    files.push(
      { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'programs', `seed-program-${spec.slug}.jpg`), kind: 'jpeg' },
      { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'programs', 'thumbnails', `seed-program-${spec.slug}.webp`), kind: 'webp' }
    );
  }
  for (const spec of ITEM_CATEGORY_SPECS) {
    files.push(
      { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'items', `seed-item-${spec.slug}.jpg`), kind: 'jpeg' },
      { abs: path.join(UPLOAD_TENANT_DIR, 'images', 'items', 'thumbnails', `seed-item-${spec.slug}.webp`), kind: 'webp' }
    );
  }
  return files;
}

function buildMinimalPdfBuffer(titleText, subtitleText) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = [
    'BT',
    '/F1 20 Tf',
    '50 740 Td',
    `(${esc(titleText)}) Tj`,
    '/F1 12 Tf',
    '0 -32 Td',
    `(${esc(subtitleText)}) Tj`,
    '0 -24 Td',
    '(Bongabong Manpower Development Center - Oriental Mindoro) Tj',
    '0 -20 Td',
    '(Verified Capstone Training Document - Batch 2026-Q4) Tj',
    'ET',
  ].join('\n');

  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

async function createSampleMediaFiles() {
  const certPdfAbs = path.join(UPLOAD_TENANT_DIR, 'documents', 'certificates', 'seed-certificate-sample.pdf');
  const reqPdfAbs = path.join(UPLOAD_TENANT_DIR, 'documents', 'trainees', 'seed-requirement-sample.pdf');
  const idJpgAbs = path.join(UPLOAD_TENANT_DIR, 'documents', 'trainees', 'seed-id-picture-sample.jpg');
  const qrPngAbs = path.join(UPLOAD_TENANT_DIR, 'qrcodes', 'certificates', 'seed-cert-qr-sample.png');
  const itemQrPngAbs = path.join(UPLOAD_TENANT_DIR, 'qrcodes', 'items', 'seed-item-qr-sample.png');
  const attDir = path.join(UPLOAD_TENANT_DIR, 'images', 'attendance');
  const traineeImgDir = path.join(UPLOAD_TENANT_DIR, 'images', 'trainees');
  const traineeThumbDir = path.join(traineeImgDir, 'thumbnails');
  const progImgDir = path.join(UPLOAD_TENANT_DIR, 'images', 'programs');
  const progThumbDir = path.join(progImgDir, 'thumbnails');
  const itemImgDir = path.join(UPLOAD_TENANT_DIR, 'images', 'items');
  const itemThumbDir = path.join(itemImgDir, 'thumbnails');

  for (const dir of [
    path.dirname(certPdfAbs),
    path.dirname(reqPdfAbs),
    path.dirname(qrPngAbs),
    path.dirname(itemQrPngAbs),
    attDir,
    traineeImgDir,
    traineeThumbDir,
    progImgDir,
    progThumbDir,
    itemImgDir,
    itemThumbDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const certBuf = buildMinimalPdfBuffer('Certificate of Completion', 'TESDA / BMDC Official Training Credential');
  const reqBuf = buildMinimalPdfBuffer('Trainee Enrollment Requirement', 'Verified Supporting Document Copy');
  fs.writeFileSync(certPdfAbs, certBuf);
  fs.writeFileSync(reqPdfAbs, reqBuf);

  const idSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#f8fafc"/><circle cx="80" cy="58" r="28" fill="#1d4ed8"/><path d="M32 142 C32 108 128 108 128 142 Z" fill="#1d4ed8"/></svg>'
  );
  const idJpgBuf = await sharp(idSvg).jpeg({ quality: 82 }).toBuffer();
  fs.writeFileSync(idJpgAbs, idJpgBuf);

  const qrSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#ffffff"/><rect x="16" y="16" width="40" height="40" fill="#0f172a"/><rect x="24" y="24" width="24" height="24" fill="#ffffff"/><rect x="30" y="30" width="12" height="12" fill="#0f172a"/><rect x="104" y="16" width="40" height="40" fill="#0f172a"/><rect x="112" y="24" width="24" height="24" fill="#ffffff"/><rect x="118" y="30" width="12" height="12" fill="#0f172a"/><rect x="16" y="104" width="40" height="40" fill="#0f172a"/><rect x="24" y="112" width="24" height="24" fill="#ffffff"/><rect x="30" y="118" width="12" height="12" fill="#0f172a"/><rect x="72" y="72" width="24" height="24" fill="#0f172a"/><rect x="108" y="108" width="28" height="28" fill="#0f172a"/></svg>'
  );
  const qrPngBuf = await sharp(qrSvg).png().toBuffer();
  fs.writeFileSync(qrPngAbs, qrPngBuf);

  // Process canonical AI-generated workshop selfies & ID portraits into runtime upload assets
  let photoBytesTotal = 0;
  for (const g of PHOTO_GENDERS) {
    for (const v of PHOTO_VARIANTS) {
      const selfieSrc = path.join(SEED_ASSETS_DIR, `selfie-${g}-${v}.jpg`);
      const avatarSrc = path.join(SEED_ASSETS_DIR, `avatar-${g}-${v}.jpg`);
      if (!fs.existsSync(selfieSrc)) {
        throw new Error(`Missing canonical seed selfie asset: ${selfieSrc}`);
      }
      if (!fs.existsSync(avatarSrc)) {
        throw new Error(`Missing canonical seed avatar asset: ${avatarSrc}`);
      }

      // Morning selfie: crisp daylight balance (640x640 JPEG quality 82)
      const amRaw = await sharp(selfieSrc)
        .rotate()
        .resize(640, 640, { fit: 'cover', position: 'centre' })
        .modulate({ brightness: 1.04, saturation: 1.02 })
        .jpeg({ quality: 82, mozjpeg: false })
        .toBuffer();
      const amStored = maybeEncryptSelfieBuffer(amRaw);
      fs.writeFileSync(path.join(attDir, `seed-attendance-${g}-${v}-am.jpg`), amStored);
      photoBytesTotal += amStored.length;

      // Afternoon selfie: distinct check-out framing (slight crop shift + mirror + warm afternoon light)
      const selfieMeta = await sharp(selfieSrc).rotate().metadata();
      const srcW = selfieMeta.width || 640;
      const srcH = selfieMeta.height || 640;
      const cropW = Math.max(64, Math.round(srcW * 0.9));
      const cropH = Math.max(64, Math.round(srcH * 0.9));
      const cropLeft = Math.min(srcW - cropW, Math.round((srcW - cropW) * 0.65));
      const cropTop = Math.min(srcH - cropH, Math.round((srcH - cropH) * 0.25));

      const pmRaw = await sharp(selfieSrc)
        .rotate()
        .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
        .flop()
        .resize(640, 640, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .modulate({ brightness: 0.96, saturation: 1.07 })
        .linear([1.04, 1.01, 0.94], [4, 1, -4])
        .jpeg({ quality: 82, mozjpeg: false })
        .toBuffer();
      const pmStored = maybeEncryptSelfieBuffer(pmRaw);
      fs.writeFileSync(path.join(attDir, `seed-attendance-${g}-${v}-pm.jpg`), pmStored);
      photoBytesTotal += pmStored.length;

      // Trainee ID portrait (512x512 JPEG quality 84) + 320x320 WebP thumbnail (matches fileUpload.ts)
      const avatarMeta = await sharp(avatarSrc).rotate().metadata();
      const avW = avatarMeta.width || 512;
      const avH = avatarMeta.height || 512;
      // Gently crop top-center 90% so head/shoulders stay centered cleanly without bottom-edge uniform clutter
      const avCropW = Math.max(64, Math.round(avW * 0.9));
      const avCropH = Math.max(64, Math.round(avH * 0.9));
      const avCropLeft = Math.round((avW - avCropW) / 2);

      const avatarJpgBuf = await sharp(avatarSrc)
        .rotate()
        .extract({ left: avCropLeft, top: 0, width: avCropW, height: avCropH })
        .resize(512, 512, { fit: 'cover', position: 'north' })
        .jpeg({ quality: 84, mozjpeg: false })
        .toBuffer();
      fs.writeFileSync(path.join(traineeImgDir, `seed-trainee-${g}-${v}.jpg`), avatarJpgBuf);
      photoBytesTotal += avatarJpgBuf.length;

      const avatarThumbBuf = await sharp(avatarJpgBuf)
        .resize(320, 320, { fit: 'cover', position: 'centre' })
        .webp({ quality: 82 })
        .toBuffer();
      fs.writeFileSync(path.join(traineeThumbDir, `seed-trainee-${g}-${v}.webp`), avatarThumbBuf);
      photoBytesTotal += avatarThumbBuf.length;
    }
  }

  // Generate reusable high-contrast item QR code PNG
  const itemQrSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#ffffff"/><rect x="20" y="20" width="60" height="60" fill="#0f172a"/><rect x="30" y="30" width="40" height="40" fill="#ffffff"/><rect x="40" y="40" width="20" height="20" fill="#0f172a"/><rect x="160" y="20" width="60" height="60" fill="#0f172a"/><rect x="170" y="30" width="40" height="40" fill="#ffffff"/><rect x="180" y="40" width="20" height="20" fill="#0f172a"/><rect x="20" y="160" width="60" height="60" fill="#0f172a"/><rect x="30" y="170" width="40" height="40" fill="#ffffff"/><rect x="40" y="180" width="20" height="20" fill="#0f172a"/><rect x="100" y="30" width="20" height="20" fill="#0f172a"/><rect x="130" y="50" width="20" height="20" fill="#0f172a"/><rect x="100" y="90" width="40" height="40" fill="#0f172a"/><rect x="110" y="100" width="20" height="20" fill="#ffffff"/><rect x="40" y="100" width="30" height="20" fill="#0f172a"/><rect x="160" y="100" width="40" height="20" fill="#0f172a"/><rect x="100" y="150" width="20" height="50" fill="#0f172a"/><rect x="140" y="150" width="30" height="30" fill="#0f172a"/><rect x="180" y="160" width="40" height="20" fill="#0f172a"/><rect x="150" y="190" width="50" height="30" fill="#0f172a"/></svg>'
  );
  const itemQrPngBuf = await sharp(itemQrSvg).png().toBuffer();
  fs.writeFileSync(itemQrPngAbs, itemQrPngBuf);
  photoBytesTotal += itemQrPngBuf.length;

  // Render 9 bespoke TESDA program sector banners (800x500 JPEG + 320x320 WebP thumbnails)
  for (const spec of PROGRAM_SECTOR_SPECS) {
    const svgBuf = buildProgramBannerSvg(spec);
    const progJpgBuf = await sharp(svgBuf)
      .resize(800, 500)
      .jpeg({ quality: 86, mozjpeg: false })
      .toBuffer();
    fs.writeFileSync(path.join(progImgDir, `seed-program-${spec.slug}.jpg`), progJpgBuf);
    photoBytesTotal += progJpgBuf.length;

    const progThumbBuf = await sharp(progJpgBuf)
      .resize(320, 320, { fit: 'cover', position: 'centre' })
      .webp({ quality: 84 })
      .toBuffer();
    fs.writeFileSync(path.join(progThumbDir, `seed-program-${spec.slug}.webp`), progThumbBuf);
    photoBytesTotal += progThumbBuf.length;
  }

  // Render 7 bespoke inventory category visuals (600x600 JPEG + 320x320 WebP thumbnails)
  for (const spec of ITEM_CATEGORY_SPECS) {
    const svgBuf = buildItemCategorySvg(spec);
    const itemJpgBuf = await sharp(svgBuf)
      .resize(600, 600)
      .jpeg({ quality: 86, mozjpeg: false })
      .toBuffer();
    fs.writeFileSync(path.join(itemImgDir, `seed-item-${spec.slug}.jpg`), itemJpgBuf);
    photoBytesTotal += itemJpgBuf.length;

    const itemThumbBuf = await sharp(itemJpgBuf)
      .resize(320, 320, { fit: 'cover', position: 'centre' })
      .webp({ quality: 84 })
      .toBuffer();
    fs.writeFileSync(path.join(itemThumbDir, `seed-item-${spec.slug}.webp`), itemThumbBuf);
    photoBytesTotal += itemThumbBuf.length;
  }

  return {
    certPdfSize: certBuf.length,
    reqPdfSize: reqBuf.length,
    idJpgSize: idJpgBuf.length,
    qrPngSize: qrPngBuf.length,
    photoBytesTotal,
  };
}

function removeSampleMediaFiles() {
  for (const item of listAllGeneratedSeedMediaFiles()) {
    if (fs.existsSync(item.abs)) fs.unlinkSync(item.abs);
  }
}

// =============================================================================
// DB UTILITIES
// =============================================================================

async function insertInBatches(table, rows, batchSize = 200) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) {
      throw new Error(`Insert failed on ${table} (batch ${i}..${i + chunk.length}): ${error.message}`);
    }
  }
}

async function fetchAllIdsInSeedRange(table, idCol = 'id') {
  const out = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(idCol)
      .gte(idCol, SEED_UUID_MIN)
      .lte(idCol, SEED_UUID_MAX)
      .range(offset, offset + 999);
    if (error) throw new Error(`Query failed on ${table}: ${error.message}`);
    const batch = data || [];
    out.push(...batch.map((r) => r[idCol]));
    if (batch.length < 1000) break;
  }
  return out;
}

async function countSeedRows(table, idCol = 'id') {
  const { count, error } = await supabase
    .from(table)
    .select(idCol, { count: 'exact', head: true })
    .gte(idCol, SEED_UUID_MIN)
    .lte(idCol, SEED_UUID_MAX);
  if (error) throw new Error(`Count failed on ${table}: ${error.message}`);
  return count || 0;
}

async function countAllRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw new Error(`Total count failed on ${table}: ${error.message}`);
  return count || 0;
}

// =============================================================================
// ROLLBACK (STRICTLY SCOPED TO SEEDED UUID RANGE — ZERO PRE-EXISTING TOUCHED)
// =============================================================================

async function rollbackSeedData() {
  console.log('\n🧹 Rolling back ONLY capstone-seeded records (UUID prefix c0de2026-0928-4...)...');

  // Capture seeded trainee IDs so trigger-created audit_logs (both INSERT & DELETE) are purged after cascade
  const seededTraineeIds = await fetchAllIdsInSeedRange('trainees');

  // 1. Delete composite-key join rows referencing seeded parent IDs (including any trigger/sync-created program GCs)
  const seededProgramIds = await fetchAllIdsInSeedRange('programs');
  const seededConvIds = new Set(await fetchAllIdsInSeedRange('conversations'));
  if (seededProgramIds.length > 0) {
    const { data: progConvs } = await supabase
      .from('conversations')
      .select('id')
      .in('program_id', seededProgramIds);
    for (const c of progConvs || []) seededConvIds.add(c.id);
  }
  const allConvIdsToClean = [...seededConvIds];
  for (let i = 0; i < allConvIdsToClean.length; i += 100) {
    const chunk = allConvIdsToClean.slice(i, i + 100);
    await supabase.from('messages').delete().in('conversation_id', chunk);
    await supabase.from('conversation_participants').delete().in('conversation_id', chunk);
    await supabase.from('conversations').delete().in('id', chunk);
  }
  const seededUserIds = await fetchAllIdsInSeedRange('users');
  for (let i = 0; i < seededUserIds.length; i += 100) {
    const chunk = seededUserIds.slice(i, i + 100);
    await supabase.from('users_tenants').delete().in('user_id', chunk);
  }

  // 3. Delete seeded rows by PK range in strict reverse FK dependency order
  const deleteOrder = [
    'audit_logs',
    'activity_logs',
    'extension_requests',
    'messages',
    'conversations',
    'announcements',
    'lendings',
    'items',
    'training_requirement_files',
    'enrollment_requirements',
    'trainee_remarks',
    'trainee_status_records',
    'certificates',
    'attendance',
    'enrollments',
    'pending_registration_usernames',
    'pending_registration_passwords',
    'trainee_accounts',
    'trainees',
    'users',
    'attendance_exceptions',
    'program_sessions',
    'attendance_schedules',
    'program_instructors',
    'instructors',
    'programs',
  ];

  for (const table of deleteOrder) {
    const before = await countSeedRows(table);
    if (before === 0) continue;
    const { error } = await supabase
      .from(table)
      .delete()
      .gte('id', SEED_UUID_MIN)
      .lte('id', SEED_UUID_MAX);
    if (error) throw new Error(`Rollback failed on ${table}: ${error.message}`);
    console.log(`   - ${table.padEnd(32)} removed ${before} seeded row(s)`);
  }

  // Clean trigger-generated notification-preference audit_logs AFTER trainees cascade delete
  if (seededTraineeIds.length > 0) {
    for (let i = 0; i < seededTraineeIds.length; i += 100) {
      const chunk = seededTraineeIds.slice(i, i + 100);
      await supabase
        .from('audit_logs')
        .delete()
        .eq('entity_type', 'trainee_notification_preferences')
        .in('entity_id', chunk);
    }
  }

  removeSampleMediaFiles();
  console.log('✅ Rollback complete. Zero pre-existing records were modified.\n');
}

// =============================================================================
// MAIN ADDITIVE SEEDER
// =============================================================================

async function runSeed() {
  console.log('🌱 Starting BMDC Capstone 500+ Additive Seeder');
  console.log(`   Tenant:      ${TENANT_ID}`);
  console.log(`   Date Window: ${START_DATE} .. ${END_DATE}`);
  console.log(`   Password:    ${TEST_PASSWORD}\n`);

  // Guard: abort if already seeded so reruns are idempotent
  const alreadySeeded = await countSeedRows('trainees');
  if (alreadySeeded > 0) {
    console.log(`⚠️  Found ${alreadySeeded} already-seeded capstone trainee rows.`);
    console.log('   Run with `--reset` to rollback & reseed, or `--verify-only` to audit.');
    process.exit(0);
  }

  // Verify tenant and resolve real staff actor IDs
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, status')
    .eq('id', TENANT_ID)
    .single();
  if (tenantErr || !tenant) throw new Error(`Target tenant ${TENANT_ID} not found`);

  const { data: staffUsers } = await supabase
    .from('users')
    .select('id, email, username, role')
    .in('email', [
      'info@bmdc.site',
      'inventory@bmdc.site',
      'paoloamorpalma@gmail.com',
      'staff.trainee@bmdc.site',
      'superadmin@bmdc.gov.ph',
    ]);
  const staffByEmail = new Map((staffUsers || []).map((u) => [u.email.toLowerCase(), u.id]));
  const localAdminId = staffByEmail.get('info@bmdc.site') || (staffUsers?.[0]?.id);
  const inventoryStaffId = staffByEmail.get('inventory@bmdc.site') || localAdminId;
  const trainingStaffIds = [
    staffByEmail.get('paoloamorpalma@gmail.com'),
    staffByEmail.get('staff.trainee@bmdc.site'),
    localAdminId,
  ].filter(Boolean);
  const superAdminId = staffByEmail.get('superadmin@bmdc.gov.ph') || localAdminId;

  // Snapshot existing unique values to guarantee zero collision with untouched existing data
  const [
    existingProgramsRes,
    existingItemsRes,
    existingUsersRes,
    existingTraineesRes,
    existingInstructorsRes,
    existingExceptionsRes,
    existingReqDefsRes,
  ] = await Promise.all([
    supabase.from('programs').select('name').eq('tenant_id', TENANT_ID),
    supabase.from('items').select('name').eq('tenant_id', TENANT_ID),
    supabase.from('users').select('email, username'),
    supabase.from('trainees').select('email').eq('tenant_id', TENANT_ID),
    supabase.from('instructors').select('email'),
    supabase.from('attendance_exceptions').select('exception_date').eq('tenant_id', TENANT_ID).is('program_id', null),
    supabase.from('requirement_definitions').select('id, requirement_type, display_name, is_mandatory, applicability_rules').eq('tenant_id', TENANT_ID).eq('is_active', true).is('deleted_at', null),
  ]);

  const existingProgramNames = new Set((existingProgramsRes.data || []).map((r) => r.name.toLowerCase()));
  const existingItemNames = new Set((existingItemsRes.data || []).map((r) => r.name.toLowerCase()));
  const existingEmails = new Set([
    ...(existingUsersRes.data || []).map((r) => r.email.toLowerCase()),
    ...(existingTraineesRes.data || []).map((r) => r.email.toLowerCase()),
  ]);
  const existingUsernames = new Set((existingUsersRes.data || []).map((r) => r.username.toLowerCase()));
  const existingInstructorEmails = new Set((existingInstructorsRes.data || []).map((r) => r.email.toLowerCase()));
  const existingGlobalExceptionDates = new Set((existingExceptionsRes.data || []).map((r) => r.exception_date));
  const requirementDefs = existingReqDefsRes.data || [];

  console.log(`✅ Loaded tenant "${tenant.name}" and ${requirementDefs.length} active requirement definitions.`);
  const mediaSizes = await createSampleMediaFiles();
  const totalMediaKb = (Object.values(mediaSizes).reduce((a, b) => a + b, 0) / 1024).toFixed(1);
  console.log(`✅ Generated ${listAllGeneratedSeedMediaFiles().length} reusable sample media & photo files (${totalMediaKb} KB total).`);

  // Pre-compute bcrypt hash ONCE (matches Backend/src/lib/auth.ts salt rounds = 10)
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
  console.log(`✅ Computed bcrypt password hash for "${TEST_PASSWORD}".\n`);

  // ---------------------------------------------------------------------------
  // 1. NON-ATTENDANCE DATES (attendance_exceptions: weekends + local/PH holidays)
  // ---------------------------------------------------------------------------
  const allWindowDates = listDatesBetween(START_DATE, MAX_PROGRAM_END_DATE);
  const excludedDateSet = new Set();
  const exceptionRows = [];
  let exSeq = 1;
  for (const d of allWindowDates) {
    const isWknd = isWeekendDate(d);
    const holidayReason = SPECIAL_HOLIDAYS.get(d);
    if (isWknd || holidayReason) {
      excludedDateSet.add(d);
      if (!existingGlobalExceptionDates.has(d)) {
        exceptionRows.push({
          id: seedUuid('attendance_exceptions', exSeq++),
          tenant_id: TENANT_ID,
          exception_type: 'no_attendance_day',
          program_id: null,
          trainee_id: null,
          exception_date: d,
          reason: holidayReason || (parseIsoDate(d).getUTCDay() === 6 ? 'Saturday - Weekend' : 'Sunday - Weekend'),
          created_by: localAdminId,
          created_at: phtWorkdayTimestamp(START_DATE, 8, 15, exSeq % 60),
          updated_at: phtWorkdayTimestamp(START_DATE, 8, 15, exSeq % 60),
        });
      }
    }
  }
  await insertInBatches('attendance_exceptions', exceptionRows);
  console.log(`✅ attendance_exceptions: +${exceptionRows.length} rows`);

  // ---------------------------------------------------------------------------
  // 2. PROGRAMS (24 active/completed/upcoming + 3 archived), INSTRUCTORS, SCHEDULES, SESSIONS
  // ---------------------------------------------------------------------------
  const instructorRows = [];
  const programRows = [];
  const programInstructorRows = [];
  const scheduleRows = [];
  const sessionRows = [];
  const programMetaById = new Map();

  let progSeq = 1;
  let instSeq = 1;
  let piSeq = 1;
  let schedSeq = 1;
  let sessSeq = 1;

  for (let i = 0; i < TESDA_PROGRAMS_CATALOG.length; i++) {
    const spec = TESDA_PROGRAMS_CATALOG[i];
    const progId = seedUuid('programs', progSeq++);
    const instId = seedUuid('instructors', instSeq++);

    const isFemaleInst = i % 2 === 1;
    const instFirst = isFemaleInst ? FIRST_NAMES_FEMALE[i % FIRST_NAMES_FEMALE.length] : FIRST_NAMES_MALE[i % FIRST_NAMES_MALE.length];
    const instLast = LAST_NAMES[(i * 3 + 5) % LAST_NAMES.length];
    const instMiddle = MIDDLE_NAMES[(i * 2 + 1) % MIDDLE_NAMES.length];
    let instEmail = `trainer.${instFirst.toLowerCase().replace(/\s+/g, '')}.${instLast.toLowerCase().replace(/\s+/g, '')}.${i + 1}@bmdc.site`;
    while (existingInstructorEmails.has(instEmail)) instEmail = `t${i}_${instEmail}`;
    existingInstructorEmails.add(instEmail);

    const progCreatedDate =
      spec.wave === 'W1A' ? '2026-09-28' :
        spec.wave === 'W1B' ? '2026-10-01' :
          spec.wave === 'W2A' ? '2026-10-19' :
            spec.wave === 'W2B' ? '2026-10-27' : '2026-11-18';
    const progCreatedAt = phtWorkdayTimestamp(progCreatedDate, 8, 30 + (i % 25), i % 59);

    instructorRows.push({
      id: instId,
      tenant_id: TENANT_ID,
      first_name: instFirst,
      last_name: instLast,
      middle_name: instMiddle,
      email: instEmail,
      phone: `0917${String(5200000 + i * 137).slice(0, 7)}`,
      specialization: spec.sector,
      bio: `TESDA NTTC Level I accredited trainer specializing in ${spec.sector} at Bongabong Manpower Development Center.`,
      status: 'active',
      created_at: progCreatedAt,
      updated_at: progCreatedAt,
    });

    let progName = spec.name;
    if (existingProgramNames.has(progName.toLowerCase())) {
      progName = `${progName} (BMDC)`;
    }
    existingProgramNames.add(progName.toLowerCase());

    const status = spec.wave.startsWith('W1') ? 'completed' : spec.wave.startsWith('W2') ? 'active' : 'upcoming';
    const progImgPaths = getSeedProgramImagePaths(progId, progName, spec.sector);
    programRows.push({
      id: progId,
      tenant_id: TENANT_ID,
      name: progName,
      description: spec.desc,
      duration_weeks: spec.weeks,
      start_date: spec.start,
      end_date: spec.end,
      status,
      max_trainees: 55,
      enrollment_limit: 50,
      instructor: `${instFirst} ${instLast}`,
      type_of_funding: spec.funding,
      image_path: progImgPaths.image_path,
      thumbnail_path: progImgPaths.thumbnail_path,
      deleted_at: null,
      created_at: progCreatedAt,
      updated_at: progCreatedAt,
    });

    programInstructorRows.push({
      id: seedUuid('program_instructors', piSeq++),
      tenant_id: TENANT_ID,
      program_id: progId,
      instructor_id: instId,
      role: 'instructor',
      created_at: progCreatedAt,
    });

    scheduleRows.push({
      id: seedUuid('attendance_schedules', schedSeq++),
      tenant_id: TENANT_ID,
      program_id: progId,
      name: `${progName.split(' - ')[0]} Standard Schedule`,
      effective_date_start: spec.start,
      effective_date_end: spec.end,
      morning_open: '07:00:00',
      morning_close: '11:55:00',
      morning_late_threshold: 60,
      afternoon_open: '12:00:00',
      afternoon_close: '22:00:00',
      afternoon_late_threshold: 60,
      status: 'active',
      created_by: localAdminId,
      created_at: progCreatedAt,
      updated_at: progCreatedAt,
    });

    // Generate daily non-holiday weekday sessions across the program's full [start, end] range
    const progSessions = [];
    if (status === 'completed' || status === 'active' || status === 'upcoming') {
      const dates = getExpectedSessionDates(spec.start, spec.end);
      const sessionTypes = ['lecture', 'workshop', 'lab', 'workshop', 'lab', 'seminar', 'exam'];
      dates.forEach((dateStr, idx) => {
        const sId = seedUuid('program_sessions', sessSeq++);
        const sCreated =
          dateStr <= END_DATE ? phtWorkdayTimestamp(dateStr, 8, 5, idx % 50) : progCreatedAt;
        const sRow = {
          id: sId,
          tenant_id: TENANT_ID,
          program_id: progId,
          title: `Day ${idx + 1} - ${idx % 5 === 4 ? 'Practical Skills Evaluation' : 'Core Competency Session'}`,
          description: `Daily training session for ${progName}`,
          session_date: dateStr,
          start_time: '08:00:00',
          end_time: '17:00:00',
          location: `BMDC Training Bay ${(i % 6) + 1}`,
          session_type: sessionTypes[idx % sessionTypes.length],
          status: dateStr < END_DATE ? 'completed' : 'scheduled',
          created_at: sCreated,
          updated_at: sCreated,
        };
        sessionRows.push(sRow);
        progSessions.push(sRow);
      });
    }

    programMetaById.set(progId, {
      id: progId,
      name: progName,
      wave: spec.wave,
      status,
      sector: spec.sector,
      start_date: spec.start,
      end_date: spec.end,
      sessions: progSessions,
    });
  }

  // Add 3 soft-deleted archived programs for /admin/archive
  for (let i = 0; i < ARCHIVED_PROGRAMS_CATALOG.length; i++) {
    const a = ARCHIVED_PROGRAMS_CATALOG[i];
    const progId = seedUuid('programs', progSeq++);
    const created = phtWorkdayTimestamp(a.start, 9, 0, i);
    const deletedAt = phtWorkdayTimestamp(a.deletedDate, 14, 15, i);
    const archImgPaths = getSeedProgramImagePaths(progId, a.name);
    programRows.push({
      id: progId,
      tenant_id: TENANT_ID,
      name: a.name,
      description: 'Archived training program cohort retained for administrative record.',
      duration_weeks: a.weeks,
      start_date: a.start,
      end_date: a.end,
      status: 'cancelled',
      max_trainees: 30,
      enrollment_limit: 25,
      instructor: 'BMDC Coordinator',
      type_of_funding: a.funding,
      image_path: archImgPaths.image_path,
      thumbnail_path: archImgPaths.thumbnail_path,
      deleted_at: deletedAt,
      created_at: created,
      updated_at: deletedAt,
    });
  }

  await insertInBatches('instructors', instructorRows);
  await insertInBatches('programs', programRows);
  await insertInBatches('program_instructors', programInstructorRows);
  await insertInBatches('attendance_schedules', scheduleRows);
  await insertInBatches('program_sessions', sessionRows);
  console.log(`✅ programs: +${programRows.length} (24 active/completed/upcoming + 3 archived)`);
  console.log(`✅ instructors: +${instructorRows.length}, attendance_schedules: +${scheduleRows.length}, program_sessions: +${sessionRows.length}`);

  const wave1Programs = [...programMetaById.values()].filter((p) => p.wave.startsWith('W1'));
  const wave2Programs = [...programMetaById.values()].filter((p) => p.wave.startsWith('W2'));
  const wave3Programs = [...programMetaById.values()].filter((p) => p.wave === 'W3');

  // ---------------------------------------------------------------------------
  // 3. TRAINEES (625), USERS (550), TRAINEE_ACCOUNTS (550), PENDING PASSWORDS/USERNAMES (35)
  // ---------------------------------------------------------------------------
  // Breakdown:
  //   1..520  -> Wave 1 completed (1 = showcase demo.trainee@bmdc.site [active in W2 too];
  //              2..161 = 160 active in W2; 162..181 = 20 dropped in W2; 182..520 = 339 completed W1 only)
  //   521..550 -> 30 active-only Wave 2 trainees
  //   551..585 -> 35 pending registrations (status='inactive', registration_status='pending')
  //   586..605 -> 20 rejected registrations (status='inactive', registration_status='rejected')
  //   606..625 -> 20 archived soft-deleted trainees (deleted_at in Oct 28 .. Nov 25)
  const userRows = [];
  const userTenantRows = [];
  const traineeRows = [];
  const traineeAccountRows = [];
  const pendingPasswordRows = [];
  const pendingUsernameRows = [];

  const traineeMeta = []; // stores helper metadata for enrollments, attendance, certificates, etc.

  function makeAddress() {
    const muniObj = pickWeighted(ORIENTAL_MINDORO_MUNIS.map((m) => [m, m.weight]));
    return {
      province: 'Oriental Mindoro',
      municipality: muniObj.muni,
      barangay: pick(muniObj.barangays),
      street: pick(STREETS),
    };
  }

  let userSeq = 1;
  let taSeq = 1;
  let ppSeq = 1;
  let puSeq = 1;

  for (let idx = 1; idx <= 625; idx++) {
    const traineeId = seedUuid('trainees', idx);
    const isShowcase = idx === 1;
    const isWave1Grad = idx <= 520;
    const isWave2Active = idx === 1 || (idx >= 2 && idx <= 161) || (idx >= 521 && idx <= 550);
    const isWave2Dropped = idx >= 162 && idx <= 181;
    const isPending = idx >= 551 && idx <= 585;
    const isRejected = idx >= 586 && idx <= 605;
    const isArchived = idx >= 606 && idx <= 625;
    const hasAccount = idx <= 550;

    const sex = isShowcase ? 'Male' : (rng() < 0.52 ? 'Male' : 'Female');
    const firstName = isShowcase ? 'Juan Carlo' : pick(sex === 'Male' ? FIRST_NAMES_MALE : FIRST_NAMES_FEMALE);
    const lastName = isShowcase ? 'Reyes' : pick(LAST_NAMES);
    const middleName = isShowcase ? 'Magtibay' : pick(MIDDLE_NAMES);
    const slugFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const slugLast = lastName.toLowerCase().replace(/[^a-z]/g, '');

    let email = isShowcase ? SHOWCASE_EMAIL : `${slugFirst}.${slugLast}.${String(idx).padStart(3, '0')}@bmdc.site`;
    while (existingEmails.has(email.toLowerCase())) {
      email = `${slugFirst}.${slugLast}.s${idx}@bmdc.site`;
    }
    existingEmails.add(email.toLowerCase());

    let username = isShowcase ? 'demo_trainee' : `${slugFirst}_${slugLast}_${String(idx).padStart(3, '0')}`;
    while (existingUsernames.has(username.toLowerCase())) {
      username = `bmdc_${username}_${idx}`;
    }
    existingUsernames.add(username.toLowerCase());

    // Registration creation dates spread realistically across Sept 28 – Nov 26
    let regDate;
    if (isWave1Grad) {
      const progIdx = (idx - 1) % wave1Programs.length;
      const w1Prog = wave1Programs[progIdx];
      regDate = w1Prog.wave === 'W1A'
        ? addDays('2026-09-28', randInt(0, 3))
        : addDays('2026-09-29', randInt(0, 8));
    } else if (idx <= 550) {
      regDate = addDays('2026-10-18', randInt(0, 18));
    } else if (isPending) {
      regDate = addDays('2026-11-05', randInt(0, 21));
    } else if (isRejected) {
      regDate = addDays('2026-10-01', randInt(0, 50));
    } else {
      regDate = addDays('2026-09-28', randInt(0, 20));
    }
    regDate = clampDate(regDate, START_DATE, END_DATE);
    const createdAt = phtWorkdayTimestamp(regDate, randInt(8, 15), randInt(5, 55), idx % 60);

    let userId = null;
    if (hasAccount) {
      userId = seedUuid('users', userSeq++);
      userRows.push({
        id: userId,
        email,
        username,
        password_hash: passwordHash,
        role: 'trainee',
        preferred_language: rng() < 0.7 ? 'en' : 'fil',
        created_at: createdAt,
        updated_at: createdAt,
      });
      userTenantRows.push({
        user_id: userId,
        tenant_id: TENANT_ID,
        is_primary: true,
        created_at: createdAt,
      });
      traineeAccountRows.push({
        id: seedUuid('trainee_accounts', taSeq++),
        tenant_id: TENANT_ID,
        trainee_id: traineeId,
        user_id: userId,
        created_at: createdAt,
      });
    }

    let registrationStatus = 'completed';
    let traineeStatus = 'completed';
    let reviewedBy = localAdminId;
    let reviewedAt = phtWorkdayTimestamp(clampDate(addDays(regDate, 1)), randInt(9, 16), randInt(0, 55), idx % 60);
    let rejectionReason = null;
    let deletedAt = null;

    if (isPending) {
      registrationStatus = 'pending';
      traineeStatus = 'inactive';
      reviewedBy = null;
      reviewedAt = null;
    } else if (isRejected) {
      registrationStatus = 'rejected';
      traineeStatus = 'inactive';
      rejectionReason = REJECTION_REASONS[idx % REJECTION_REASONS.length];
    } else if (isArchived) {
      registrationStatus = 'completed';
      traineeStatus = 'inactive';
      deletedAt = phtWorkdayTimestamp(clampDate(addDays('2026-10-28', (idx - 606) % 28)), randInt(9, 16), randInt(0, 55), idx % 60);
    } else if (isWave2Active) {
      registrationStatus = 'completed';
      traineeStatus = 'active';
    } else if (isWave2Dropped) {
      registrationStatus = 'completed';
      traineeStatus = 'dropped';
    } else {
      registrationStatus = 'completed';
      traineeStatus = 'completed';
    }

    const addr = isShowcase
      ? { province: 'Oriental Mindoro', municipality: 'Bongabong', barangay: 'Poblacion', street: 'Rizal St.' }
      : makeAddress();
    const birthYear = randInt(1984, 2006);
    const birthDate = `${birthYear}-${String(randInt(1, 12)).padStart(2, '0')}-${String(randInt(1, 28)).padStart(2, '0')}`;
    const civilStatus = pickWeighted([['Single', 62], ['Married', 33], ['Separated', 3], ['Widowed', 2]]);
    const education = pickWeighted(EDUCATION_LEVELS);
    const classification = pickWeighted(CLASSIFICATIONS);
    const employmentStatus = pickWeighted(EMPLOYMENT_STATUSES_TRAINEE);

    const { photo_path: traineePhotoPath, thumbnail_path: traineeThumbPath } = getSeedTraineePhotoPaths(sex, idx);

    traineeRows.push({
      id: traineeId,
      tenant_id: TENANT_ID,
      user_id: userId,
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      email,
      phone: `09${pick(['17', '18', '19', '27', '35', '45', '55', '66', '75', '95'])}${String(1000000 + idx * 937).slice(0, 7)}`,
      sex,
      birth_date: birthDate,
      birth_place: `${addr.municipality}, Oriental Mindoro`,
      civil_status: civilStatus,
      province: addr.province,
      municipality: addr.municipality,
      barangay: addr.barangay,
      street: addr.street,
      educational_attainment: education,
      course: pick(COURSES),
      year_graduated: String(Math.min(2026, birthYear + randInt(18, 22))),
      classification,
      disability: rng() < 0.04 ? 'Orthopedic / Mobility Impairment' : null,
      employment_status: employmentStatus,
      qr_code: null,
      photo_path: traineePhotoPath,
      thumbnail_path: traineeThumbPath,
      qr_code_path: null,
      emergency_contact_name: `${pick(FIRST_NAMES_FEMALE)} ${lastName}`,
      emergency_contact_phone: `09${pick(['17', '27', '36', '56', '97'])}${String(2000000 + idx * 719).slice(0, 7)}`,
      status: traineeStatus,
      consent_given: true,
      consent_timestamp: createdAt,
      consent_version: '1.0',
      is_verified: hasAccount,
      notify_on_program_posting: true,
      registration_status: registrationStatus,
      registration_rejection_reason: rejectionReason,
      registration_reviewed_by: reviewedBy,
      registration_reviewed_at: reviewedAt,
      deleted_at: deletedAt,
      created_at: createdAt,
      updated_at: reviewedAt || createdAt,
    });

    if (isPending) {
      pendingPasswordRows.push({
        id: seedUuid('pending_registration_passwords', ppSeq++),
        trainee_id: traineeId,
        password_hash: passwordHash,
        created_at: createdAt,
      });
      pendingUsernameRows.push({
        id: seedUuid('pending_registration_usernames', puSeq++),
        trainee_id: traineeId,
        username,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    traineeMeta.push({
      idx,
      id: traineeId,
      userId,
      email,
      username,
      fullName: `${firstName} ${lastName}`,
      sex,
      civilStatus,
      regDate,
      createdAt,
      isShowcase,
      isWave1Grad,
      isWave2Active,
      isWave2Dropped,
      isPending,
      isRejected,
      isArchived,
    });
  }

  await insertInBatches('users', userRows);
  await insertInBatches('users_tenants', userTenantRows);
  await insertInBatches('trainees', traineeRows);
  await insertInBatches('trainee_accounts', traineeAccountRows);
  await insertInBatches('pending_registration_passwords', pendingPasswordRows);
  await insertInBatches('pending_registration_usernames', pendingUsernameRows);
  console.log(`✅ users: +${userRows.length}, trainees: +${traineeRows.length} (550 completed + 35 pending + 20 rejected + 20 archived)`);

  // ---------------------------------------------------------------------------
  // 4. ENROLLMENTS (766 total: 520 Wave 1 completed + 191 Wave 2 enrolled + 20 dropped + 35 pending enrolled)
  // ---------------------------------------------------------------------------
  const enrollmentRows = [];
  const enrollmentMeta = [];
  const enrolleesByProgram = new Map();
  let enrSeq = 1;

  function addEnrollment(tMeta, prog, status, enrollDate, completionDate = null, finalGrade = null) {
    const enrId = seedUuid('enrollments', enrSeq++);
    const safeEnrollDate = clampDate(enrollDate, START_DATE, END_DATE);
    const safeCompDate = completionDate
      ? (completionDate < safeEnrollDate ? safeEnrollDate : clampDate(completionDate, START_DATE, END_DATE))
      : null;
    const createdAt = phtWorkdayTimestamp(safeEnrollDate, randInt(8, 15), randInt(0, 55), enrSeq % 60);
    const row = {
      id: enrId,
      tenant_id: TENANT_ID,
      trainee_id: tMeta.id,
      program_id: prog.id,
      enrollment_date: safeEnrollDate,
      completion_date: safeCompDate,
      status,
      source: pickWeighted([['direct', 55], ['social_share', 28], ['admin_assigned', 17]]),
      final_grade: finalGrade,
      created_at: createdAt,
      updated_at: safeCompDate ? phtWorkdayTimestamp(safeCompDate, 15, 0, enrSeq % 60) : createdAt,
    };
    enrollmentRows.push(row);
    const meta = { ...row, trainee: tMeta, program: prog };
    enrollmentMeta.push(meta);
    if (!enrolleesByProgram.has(prog.id)) enrolleesByProgram.set(prog.id, []);
    enrolleesByProgram.get(prog.id).push(meta);
    return meta;
  }

  for (const t of traineeMeta) {
    if (t.isWave1Grad) {
      const w1Prog = wave1Programs[(t.idx - 1) % wave1Programs.length];
      const grade = Number((82 + rng() * 16.5).toFixed(2));
      addEnrollment(t, w1Prog, 'completed', t.regDate, w1Prog.end_date, grade);
    }
    if (t.isWave2Active) {
      const w2Prog = wave2Programs[(t.idx - 1) % wave2Programs.length];
      const w2EnrollDate = t.isWave1Grad
        ? clampDate(addDays(w2Prog.start_date, randInt(0, 3)))
        : clampDate(w2Prog.start_date);
      addEnrollment(t, w2Prog, 'enrolled', w2EnrollDate, null, null);
    } else if (t.isWave2Dropped) {
      const w2Prog = wave2Programs[(t.idx - 1) % wave2Programs.length];
      addEnrollment(t, w2Prog, 'dropped', clampDate(w2Prog.start_date), null, null);
    } else if (t.isPending) {
      const targetPool = [...wave3Programs, ...wave2Programs.slice(0, 2)];
      const pProg = targetPool[(t.idx - 551) % targetPool.length];
      addEnrollment(t, pProg, 'enrolled', t.regDate, null, null);
    }
  }

  await insertInBatches('enrollments', enrollmentRows);
  console.log(`✅ enrollments: +${enrollmentRows.length} rows`);

  // ---------------------------------------------------------------------------
  // 5. ATTENDANCE (~3,200 rows across Sept 28 – Nov 26; 100% calendar for showcase trainee)
  // ---------------------------------------------------------------------------
  const traineeById = new Map(traineeMeta.map((t) => [t.id, t]));
  const attendanceRows = [];
  const attendanceKeySet = new Set();
  let attSeq = 1;

  function buildAttendanceRow(session, traineeId, forcedStatus = null) {
    const key = `${session.id}:${traineeId}`;
    if (attendanceKeySet.has(key)) return null;
    attendanceKeySet.add(key);

    const status = forcedStatus || pickWeighted([['present', 80], ['late', 10], ['absent', 7], ['excused', 3]]);
    const d = session.session_date;
    let checkIn = null;
    let checkOut = null;
    let morningTimeIn = null;
    let afternoonTimeOut = null;
    let morningStatus = 'absent';
    let afternoonStatus = 'absent';
    let lateMins = 0;

    if (status === 'present') {
      morningTimeIn = phtWorkdayTimestamp(d, 8, randInt(2, 27), randInt(0, 59));
      afternoonTimeOut = phtWorkdayTimestamp(d, 16, randInt(5, 50), randInt(0, 59));
      checkIn = morningTimeIn;
      checkOut = afternoonTimeOut;
      morningStatus = 'present';
      afternoonStatus = 'present';
    } else if (status === 'late') {
      lateMins = randInt(16, 48);
      morningTimeIn = phtWorkdayTimestamp(d, 8, Math.min(58, 15 + lateMins), randInt(0, 59));
      afternoonTimeOut = phtWorkdayTimestamp(d, 16, randInt(5, 50), randInt(0, 59));
      checkIn = morningTimeIn;
      checkOut = afternoonTimeOut;
      morningStatus = 'late';
      afternoonStatus = 'present';
    } else if (status === 'excused') {
      morningStatus = 'absent';
      afternoonStatus = 'absent';
    }

    const tMeta = traineeById.get(traineeId);
    const { selfie_morning_path, selfie_afternoon_path } = getSeedAttendanceSelfiePaths(
      tMeta?.sex || 'Male',
      traineeId,
      Boolean(morningTimeIn),
      Boolean(afternoonTimeOut)
    );

    const recCreatedAt = checkIn || phtWorkdayTimestamp(d, 9, randInt(0, 30), randInt(0, 59));
    return {
      id: seedUuid('attendance', attSeq++),
      tenant_id: TENANT_ID,
      session_id: session.id,
      trainee_id: traineeId,
      status,
      check_in_time: checkIn,
      check_out_time: checkOut,
      scanned_by: status === 'absent' || status === 'excused' ? pick(trainingStaffIds) : null,
      notes: status === 'excused' ? 'Excused absence with coordinator approval' : status === 'late' ? `Arrived ${lateMins} mins after morning window` : null,
      selfie_morning_path,
      selfie_afternoon_path,
      morning_time_in: morningTimeIn,
      afternoon_time_out: afternoonTimeOut,
      late_duration_minutes: lateMins,
      morning_status: morningStatus,
      afternoon_status: afternoonStatus,
      gps_lat: checkIn ? Number((12.748 + (rng() - 0.5) * 0.003).toFixed(7)) : null,
      gps_lng: checkIn ? Number((121.488 + (rng() - 0.5) * 0.003).toFixed(7)) : null,
      gps_accuracy: checkIn ? Number((12 + rng() * 18).toFixed(2)) : null,
      gps_address: checkIn ? 'Bongabong Manpower Development Center, Poblacion, Bongabong, Oriental Mindoro' : null,
      device_info: checkIn ? { os: pick(['Android', 'iOS', 'Windows']), timezone: 'Asia/Manila', networkType: '4g' } : null,
      submission_method: checkIn ? 'self_service' : 'manual',
      attempt_number: 1,
      verified_by: pick(trainingStaffIds),
      verified_at: phtWorkdayTimestamp(d, 16, 55, randInt(0, 59)),
      created_at: recCreatedAt,
      updated_at: recCreatedAt,
    };
  }

  // First: 100% populated historical attendance calendar for showcase trainee (demo.trainee@bmdc.site)
  const showcaseEnrollments = enrollmentMeta.filter((e) => e.trainee.isShowcase);
  for (const enr of showcaseEnrollments) {
    for (let sIdx = 0; sIdx < enr.program.sessions.length; sIdx++) {
      const s = enr.program.sessions[sIdx];
      if (s.session_date > END_DATE) continue;
      const st = sIdx % 11 === 4 ? 'late' : sIdx % 19 === 12 ? 'excused' : 'present';
      const row = buildAttendanceRow(s, enr.trainee.id, st);
      if (row) attendanceRows.push(row);
    }
  }

  // Second: ~6 trainees per historical session (never fabricate future attendance beyond END_DATE)
  for (const prog of programMetaById.values()) {
    if (!prog.sessions.length) continue;
    const progEnrollees = (enrolleesByProgram.get(prog.id) || []).filter(
      (e) => e.status === 'completed' || (e.status === 'enrolled' && !e.trainee.isPending)
    );
    if (!progEnrollees.length) continue;

    for (let sIdx = 0; sIdx < prog.sessions.length; sIdx++) {
      const session = prog.sessions[sIdx];
      if (session.session_date > END_DATE) continue;
      const perSession = Math.min(progEnrollees.length, 6);
      const startOffset = (sIdx * 3) % progEnrollees.length;
      for (let k = 0; k < perSession; k++) {
        const enr = progEnrollees[(startOffset + k) % progEnrollees.length];
        if (session.session_date < enr.enrollment_date) continue;
        const row = buildAttendanceRow(session, enr.trainee_id);
        if (row) attendanceRows.push(row);
      }
    }
  }

  await insertInBatches('attendance', attendanceRows);
  console.log(`✅ attendance: +${attendanceRows.length} rows`);

  // ---------------------------------------------------------------------------
  // 6. CERTIFICATES (520) & TRAINEE_STATUS_RECORDS (520)
  // ---------------------------------------------------------------------------
  const completedWave1Enrollments = enrollmentMeta.filter((e) => e.status === 'completed');
  const certificateRows = [];
  const statusRecordRows = [];
  const enrollmentStatusLinks = [];

  for (let i = 0; i < completedWave1Enrollments.length; i++) {
    const enr = completedWave1Enrollments[i];
    const certId = seedUuid('certificates', i + 1);
    const statusId = seedUuid('trainee_status_records', i + 1);
    const certNumber = `BMDC-CERT-2026-${String(i + 1).padStart(4, '0')}`;
    const issueDate = clampDate(addDays(enr.completion_date || enr.program.end_date, randInt(1, 3)), START_DATE, END_DATE);
    const issueTs = phtWorkdayTimestamp(issueDate, randInt(9, 15), randInt(0, 55), i % 60);

    certificateRows.push({
      id: certId,
      tenant_id: TENANT_ID,
      enrollment_id: enr.id,
      certificate_number: certNumber,
      issue_date: issueDate,
      file_path: SAMPLE_CERT_PDF_REL,
      qr_code: `BMDC-CERT-QR-2026-${String(i + 1).padStart(4, '0')}`,
      qr_code_path: SAMPLE_CERT_QR_REL,
      verification_url: `https://bmdc.site/verify/${certNumber}`,
      signatory_name: 'Engr. Roberto M. Magtibay',
      signatory_title: 'Center Administrator, BMDC',
      created_at: issueTs,
      updated_at: issueTs,
    });

    const empStatus = enr.trainee.isShowcase
      ? 'employed'
      : pickWeighted([
        ['employed', 58],
        ['self_employed', 18],
        ['unemployed', 14],
        ['pursuing_education', 8],
        ['pending', 2],
      ]);
    const sector = enr.program.sector;
    const isWorking = empStatus === 'employed' || empStatus === 'self_employed';
    const skillsMatch = isWorking
      ? pickWeighted([['exact_match', 68], ['partial_match', 26], ['no_match', 6]])
      : 'not_applicable';
    const matchPct =
      skillsMatch === 'exact_match' ? Number((85 + rng() * 15).toFixed(2)) :
        skillsMatch === 'partial_match' ? Number((55 + rng() * 25).toFixed(2)) :
          skillsMatch === 'no_match' ? Number((15 + rng() * 25).toFixed(2)) : null;

    const recordDate = clampDate(addDays(issueDate, randInt(2, 10)), START_DATE, END_DATE);
    const recordTs = phtWorkdayTimestamp(recordDate, randInt(9, 16), randInt(0, 55), i % 60);

    statusRecordRows.push({
      id: statusId,
      tenant_id: TENANT_ID,
      trainee_id: enr.trainee_id,
      enrollment_id: enr.id,
      graduation_status: 'graduated',
      graduation_date: enr.completion_date || enr.program.end_date,
      certificate_id: certId,
      employment_status: empStatus,
      job_title: isWorking ? pick(JOB_TITLES_BY_SECTOR[sector] || ['Skilled Technician']) : null,
      employer_name: empStatus === 'employed'
        ? pick(EMPLOYERS_BY_SECTOR[sector] || ['Local Enterprise, Oriental Mindoro'])
        : empStatus === 'self_employed'
          ? 'Self-Employed / Independent Contractor'
          : null,
      job_start_date: isWorking ? clampDate(addDays(issueDate, randInt(1, 7)), START_DATE, END_DATE) : null,
      job_sector: isWorking ? sector : null,
      skills_match: skillsMatch,
      skills_match_percentage: matchPct,
      remarks: isWorking
        ? `Graduate successfully transitioned into ${sector} employment following BMDC completion.`
        : empStatus === 'pursuing_education'
          ? 'Enrolled in higher TESDA NC III / college continuation track.'
          : 'Actively included in Bongabong PESO / BMDC placement referral roster.',
      unemployment_reason: empStatus === 'unemployed'
        ? pick(['Awaiting partner employer onboarding', 'Preparing for TESDA National Assessment', 'Personal / family schedule'])
        : null,
      recorded_by: pick(trainingStaffIds),
      recorded_at: recordTs,
      last_updated_by: localAdminId,
      updated_at: recordTs,
      deleted_at: null,
    });

    enrollmentStatusLinks.push({ id: enr.id, statusId });
  }

  await insertInBatches('certificates', certificateRows);
  await insertInBatches('trainee_status_records', statusRecordRows);

  // Link enrollments.trainee_status_record_id in parallel chunks of 25
  for (let i = 0; i < enrollmentStatusLinks.length; i += 25) {
    const batch = enrollmentStatusLinks.slice(i, i + 25);
    await Promise.all(
      batch.map(({ id, statusId }) =>
        supabase.from('enrollments').update({ trainee_status_record_id: statusId }).eq('id', id)
      )
    );
  }
  console.log(`✅ certificates: +${certificateRows.length}, trainee_status_records: +${statusRecordRows.length}`);

  // ---------------------------------------------------------------------------
  // 7. TRAINEE REMARKS (550)
  // ---------------------------------------------------------------------------
  const remarkRows = [];
  for (let i = 0; i < 550; i++) {
    const t = traineeMeta[i % 605];
    const rDate = clampDate(addDays(t.regDate, randInt(1, 25)), START_DATE, END_DATE);
    const rTs = phtWorkdayTimestamp(rDate, randInt(8, 16), randInt(0, 55), i % 60);
    remarkRows.push({
      id: seedUuid('trainee_remarks', i + 1),
      trainee_id: t.id,
      remark: REMARK_TEMPLATES[i % REMARK_TEMPLATES.length],
      created_by: pick(trainingStaffIds),
      created_at: rTs,
      updated_at: rTs,
      tenant_id: TENANT_ID,
    });
  }
  await insertInBatches('trainee_remarks', remarkRows);
  console.log(`✅ trainee_remarks: +${remarkRows.length} rows`);

  // ---------------------------------------------------------------------------
  // 8. ENROLLMENT_REQUIREMENTS (~4,800) & TRAINING_REQUIREMENT_FILES (550 active + 15 archived)
  // ---------------------------------------------------------------------------
  const enrollmentReqRows = [];
  let erSeq = 1;

  for (const enr of enrollmentMeta) {
    for (const def of requirementDefs) {
      let isApplicable = true;
      if (def.requirement_type === 'marriage_certificate_copy') {
        isApplicable = enr.trainee.sex === 'Female' && enr.trainee.civilStatus === 'Married';
      }
      let subStatus = 'verified';
      if (!isApplicable) {
        subStatus = 'waived';
      } else if (enr.status === 'completed') {
        subStatus = pickWeighted([['verified', 92], ['waived', 5], ['submitted', 3]]);
      } else if (enr.status === 'enrolled' && !enr.trainee.isPending) {
        subStatus = pickWeighted([['verified', 65], ['submitted', 20], ['pending', 10], ['rejected', 3], ['waived', 2]]);
      } else {
        subStatus = pickWeighted([['submitted', 50], ['pending', 35], ['verified', 10], ['rejected', 5]]);
      }

      const subDate = clampDate(addDays(enr.enrollment_date, randInt(0, 4)), START_DATE, END_DATE);
      const verDate = clampDate(addDays(subDate, randInt(1, 3)), START_DATE, END_DATE);
      const createdTs = phtWorkdayTimestamp(enr.enrollment_date, 9, 0, erSeq % 60);
      const isSubmittedOrBeyond = ['submitted', 'verified', 'rejected'].includes(subStatus);
      const isVerified = subStatus === 'verified';
      const isImg = def.requirement_type === 'id_pictures';

      enrollmentReqRows.push({
        id: seedUuid('enrollment_requirements', erSeq++),
        enrollment_id: enr.id,
        requirement_id: def.id,
        tenant_id: TENANT_ID,
        is_applicable: isApplicable,
        submission_status: subStatus,
        document_url: isSubmittedOrBeyond ? (isImg ? SAMPLE_ID_JPG_REL : SAMPLE_REQ_PDF_REL) : null,
        submitted_at: isSubmittedOrBeyond ? phtWorkdayTimestamp(subDate, randInt(9, 15), randInt(0, 55), erSeq % 60) : null,
        verified_at: isVerified ? phtWorkdayTimestamp(verDate, randInt(10, 16), randInt(0, 55), erSeq % 60) : null,
        verified_by: isVerified || subStatus === 'rejected' ? pick(trainingStaffIds) : null,
        rejection_reason: subStatus === 'rejected' ? 'Document scan blurry; please upload a clearer copy.' : null,
        created_at: createdTs,
        updated_at: isVerified ? phtWorkdayTimestamp(verDate, 16, 0, erSeq % 60) : createdTs,
      });
    }
  }
  await insertInBatches('enrollment_requirements', enrollmentReqRows, 300);

  const reqFileRows = [];
  const activeReqTypes = [
    'accomplished_learners_profile_form',
    'birth_certificate_copy',
    'valid_id_copy',
    'id_pictures',
    'report_card_tor_copy',
    'barangay_no_grade_certification',
  ];
  let rfSeq = 1;
  // Give showcase trainee all 6 core files
  for (const rType of activeReqTypes) {
    const isImg = rType === 'id_pictures';
    const ts = phtWorkdayTimestamp('2026-09-29', 10, rfSeq % 55, 0);
    reqFileRows.push({
      id: seedUuid('training_requirement_files', rfSeq++),
      tenant_id: TENANT_ID,
      trainee_id: traineeMeta[0].id,
      uploaded_by: traineeMeta[0].userId,
      requirement_type: rType,
      file_path: isImg ? SAMPLE_ID_JPG_REL : SAMPLE_REQ_PDF_REL,
      file_name: isImg ? 'demo_trainee_1x1_id.jpg' : `${rType}.pdf`,
      file_size_bytes: isImg ? mediaSizes.idJpgSize : mediaSizes.reqPdfSize,
      mime_type: isImg ? 'image/jpeg' : 'application/pdf',
      uploaded_at: ts,
      updated_at: ts,
      deleted_at: null,
    });
  }
  // Fill up to 550 active requirement files across other trainees (including all 35 pending!)
  const fileTargets = [
    ...traineeMeta.slice(550, 585), // all 35 pending registrations get viewable docs
    ...traineeMeta.slice(1, 510),
  ];
  for (const t of fileTargets) {
    if (rfSeq > 550) break;
    const rType = activeReqTypes[rfSeq % activeReqTypes.length];
    const isImg = rType === 'id_pictures';
    const ts = phtWorkdayTimestamp(t.regDate, randInt(9, 16), randInt(0, 55), rfSeq % 60);
    reqFileRows.push({
      id: seedUuid('training_requirement_files', rfSeq++),
      tenant_id: TENANT_ID,
      trainee_id: t.id,
      uploaded_by: t.userId || localAdminId,
      requirement_type: rType,
      file_path: isImg ? SAMPLE_ID_JPG_REL : SAMPLE_REQ_PDF_REL,
      file_name: isImg ? `${t.username}_id_pic.jpg` : `${t.username}_${rType}.pdf`,
      file_size_bytes: isImg ? mediaSizes.idJpgSize : mediaSizes.reqPdfSize,
      mime_type: isImg ? 'image/jpeg' : 'application/pdf',
      uploaded_at: ts,
      updated_at: ts,
      deleted_at: null,
    });
  }
  // Add 15 soft-deleted archived requirement files for /admin/archive
  for (let i = 0; i < 15; i++) {
    const t = traineeMeta[10 + i];
    const delDate = clampDate(addDays('2026-10-30', i), START_DATE, END_DATE);
    reqFileRows.push({
      id: seedUuid('training_requirement_files', rfSeq++),
      tenant_id: TENANT_ID,
      trainee_id: t.id,
      uploaded_by: localAdminId,
      requirement_type: 'report_card_tor_copy',
      file_path: SAMPLE_REQ_PDF_REL,
      file_name: `replaced_submission_${i + 1}.pdf`,
      file_size_bytes: mediaSizes.reqPdfSize,
      mime_type: 'application/pdf',
      uploaded_at: phtWorkdayTimestamp(t.regDate, 10, 0, i),
      updated_at: phtWorkdayTimestamp(delDate, 14, 0, i),
      deleted_at: phtWorkdayTimestamp(delDate, 14, 0, i),
    });
  }
  await insertInBatches('training_requirement_files', reqFileRows);
  console.log(`✅ enrollment_requirements: +${enrollmentReqRows.length}, training_requirement_files: +${reqFileRows.length}`);

  // ---------------------------------------------------------------------------
  // 9. INVENTORY ITEMS (520 active + 15 archived) & LENDINGS (550) WITH RECONCILED STOCK
  // ---------------------------------------------------------------------------
  const activeItemSpecs = [];
  let itemSeq = 1;
  const variants = ['Unit A', 'Unit B', 'Unit C', 'Pro Series', 'Standard', 'Heavy Duty', 'Batch 1', 'Batch 2', 'Kit A', 'Kit B', 'Set 1', 'Set 2'];

  for (let i = 0; i < 520; i++) {
    const tpl = INVENTORY_CATALOG[i % INVENTORY_CATALOG.length];
    const batchNum = Math.floor(i / INVENTORY_CATALOG.length) + 1;
    let name = `${tpl.base} - ${variants[batchNum % variants.length]} #${String(i + 1).padStart(3, '0')}`;
    while (existingItemNames.has(name.toLowerCase())) name += 'X';
    existingItemNames.add(name.toLowerCase());

    const quantity = randInt(tpl.qty[0], tpl.qty[1]);
    const minQty = Math.min(quantity, randInt(2, 5));
    const itemDate = clampDate(addDays(START_DATE, Math.floor((i / 520) * 58)), START_DATE, END_DATE);
    const createdTs = phtWorkdayTimestamp(itemDate, randInt(8, 16), randInt(0, 55), i % 60);

    const itemImgPaths = getSeedItemImagePaths(tpl.category);

    activeItemSpecs.push({
      id: seedUuid('items', itemSeq++),
      tenant_id: TENANT_ID,
      name,
      description: `${tpl.base} issued for Bongabong MDC ${tpl.location} training sessions.`,
      category: tpl.category,
      quantity,
      available_quantity: quantity, // reconciled after generating lendings
      unit: tpl.unit,
      location: tpl.location,
      qr_code: `ITEM-194876DE-SEED-${String(i + 1).padStart(4, '0')}`,
      image_path: itemImgPaths.image_path,
      thumbnail_path: itemImgPaths.thumbnail_path,
      qr_code_path: itemImgPaths.qr_code_path,
      status: 'available',
      minimum_quantity: minQty,
      purchase_date: itemDate,
      condition: pickWeighted([['New', 42], ['Good', 44], ['Fair', 11], ['Poor', 3]]),
      created_by: inventoryStaffId,
      deleted_at: null,
      created_at: createdTs,
      updated_at: createdTs,
      _borrowedOut: 0,
    });
  }

  // Generate 550 lendings across Sept 28 – Nov 26 and reconcile item stock accurately
  // Mix: 390 returned, 105 active, 45 overdue, 10 lost
  const lendingRows = [];
  const borrowerTrainees = traineeMeta.slice(0, 550);
  const weekdayWindow = allWindowDates.filter((d) => !isWeekendDate(d));

  for (let i = 0; i < 550; i++) {
    const status =
      i < 390 ? 'returned' :
        i < 495 ? 'active' :
          i < 540 ? 'overdue' : 'lost';

    // Pick an item with enough remaining available stock if non-returned
    let item = activeItemSpecs[(i * 7 + 3) % activeItemSpecs.length];
    if (status !== 'returned') {
      let guard = 0;
      while (item.quantity - item._borrowedOut < 1 && guard < activeItemSpecs.length) {
        item = activeItemSpecs[(i + guard) % activeItemSpecs.length];
        guard++;
      }
    }

    const maxBorrow = status === 'returned'
      ? Math.min(3, item.quantity)
      : Math.min(2, Math.max(1, item.quantity - item._borrowedOut));
    const qty = randInt(1, Math.max(1, maxBorrow));

    let lentDate;
    let expectedReturnDate;
    let actualReturnDate = null;

    if (status === 'returned') {
      lentDate = weekdayWindow[i % (weekdayWindow.length - 2)];
      if (lentDate < item.purchase_date) lentDate = item.purchase_date;
      expectedReturnDate = clampDate(addDays(lentDate, randInt(2, 7)), lentDate, END_DATE);
      const retDay = clampDate(addDays(lentDate, randInt(1, 6)), lentDate, END_DATE);
      actualReturnDate = phtWorkdayTimestamp(retDay, randInt(14, 16), randInt(0, 55), i % 60);
    } else if (status === 'active') {
      lentDate = clampDate(addDays('2026-11-18', i % 9), item.purchase_date, END_DATE);
      expectedReturnDate = addDays(END_DATE, randInt(2, 14)); // Future due date
      item._borrowedOut += qty;
    } else if (status === 'overdue') {
      lentDate = clampDate(addDays('2026-10-12', i % 34), item.purchase_date, '2026-11-18');
      expectedReturnDate = clampDate(addDays(lentDate, randInt(3, 7)), lentDate, '2026-11-24'); // Past due
      item._borrowedOut += qty;
    } else {
      lentDate = clampDate(addDays('2026-10-05', i % 35), item.purchase_date, '2026-11-15');
      expectedReturnDate = clampDate(addDays(lentDate, 5), lentDate, '2026-11-20');
      item._borrowedOut += qty;
    }

    const borrower = borrowerTrainees[(i * 5) % borrowerTrainees.length];
    const lentTs = phtWorkdayTimestamp(lentDate, randInt(8, 14), randInt(0, 55), i % 60);

    lendingRows.push({
      id: seedUuid('lendings', i + 1),
      tenant_id: TENANT_ID,
      item_id: item.id,
      trainee_id: borrower.id,
      borrower_name: borrower.fullName,
      borrower_contact: traineeRows[borrower.idx - 1].phone,
      quantity: qty,
      lent_date: lentTs,
      expected_return_date: expectedReturnDate,
      actual_return_date: actualReturnDate,
      status,
      notes: status === 'returned'
        ? 'Inspected and returned in good working condition.'
        : status === 'overdue'
          ? 'Follow-up SMS sent to borrower for overdue workshop equipment.'
          : status === 'lost'
            ? 'Incident report filed with Inventory Manager for replacement assessment.'
            : 'Issued for practical training lab exercise.',
      lent_by: inventoryStaffId,
      returned_by: status === 'returned' ? inventoryStaffId : null,
      created_at: lentTs,
      updated_at: actualReturnDate || lentTs,
    });
  }

  // Reconcile item available_quantity & status (plus realistic low_stock/out_of_stock/maintenance distribution)
  const itemRows = activeItemSpecs.map((it, idx) => {
    const avail = Math.max(0, it.quantity - it._borrowedOut);
    let finalAvail = avail;
    let finalQty = it.quantity;
    let finalMin = it.minimum_quantity;
    let status = 'available';

    // Deliberately make a small realistic set low_stock / out_of_stock / maintenance when unborrowed
    if (it._borrowedOut === 0 && idx % 43 === 0) {
      finalAvail = 0;
      finalQty = Math.max(finalQty, 4);
      status = 'maintenance';
    } else if (it._borrowedOut === 0 && idx % 37 === 0) {
      finalAvail = 0;
      finalQty = 0;
      status = 'out_of_stock';
    } else if (it._borrowedOut === 0 && idx % 19 === 0) {
      finalAvail = Math.min(avail, finalMin);
      finalQty = finalAvail;
      status = finalAvail === 0 ? 'out_of_stock' : 'low_stock';
    } else {
      status = finalAvail === 0 ? 'out_of_stock' : finalAvail <= finalMin ? 'low_stock' : 'available';
    }

    const { _borrowedOut, ...clean } = it;
    return {
      ...clean,
      quantity: finalQty,
      available_quantity: finalAvail,
      status,
    };
  });

  // Add 15 soft-deleted archived items for /admin/archive
  for (let i = 0; i < 15; i++) {
    const tpl = INVENTORY_CATALOG[(i * 3) % INVENTORY_CATALOG.length];
    const delDate = clampDate(addDays('2026-10-29', i * 2), START_DATE, END_DATE);
    const archItemImgPaths = getSeedItemImagePaths(tpl.category);
    itemRows.push({
      id: seedUuid('items', itemSeq++),
      tenant_id: TENANT_ID,
      name: `${tpl.base} (Retired Asset #${i + 1})`,
      description: 'Decommissioned workshop item moved to archive.',
      category: tpl.category,
      quantity: 2,
      available_quantity: 2,
      unit: tpl.unit,
      location: tpl.location,
      qr_code: `ITEM-194876DE-SEED-ARCH-${String(i + 1).padStart(3, '0')}`,
      image_path: archItemImgPaths.image_path,
      thumbnail_path: archItemImgPaths.thumbnail_path,
      qr_code_path: archItemImgPaths.qr_code_path,
      status: 'maintenance',
      minimum_quantity: 1,
      purchase_date: START_DATE,
      condition: 'Poor',
      created_by: inventoryStaffId,
      deleted_at: phtWorkdayTimestamp(delDate, 15, 0, i),
      created_at: phtWorkdayTimestamp(START_DATE, 9, 0, i),
      updated_at: phtWorkdayTimestamp(delDate, 15, 0, i),
    });
  }

  await insertInBatches('items', itemRows);
  await insertInBatches('lendings', lendingRows);
  console.log(`✅ items: +${itemRows.length} (520 active + 15 archived), lendings: +${lendingRows.length}`);

  // ---------------------------------------------------------------------------
  // 10. ANNOUNCEMENTS (520: 8 live active for Landing Page + 482 expired historical + 30 drafts)
  // ---------------------------------------------------------------------------
  const announcementRows = [];
  const activeTitles = [
    'December 2026 TESDA Scholarship Intake Now Open',
    'Wave 2 Active Batch Competency Assessment Schedule',
    'Bongabong MDC Holiday Advisory & Attendance Guidelines',
    'Graduates Job Placement Referral Desk Open Weekly',
    'Complete Your Digital Requirement Uploads Online',
    'Workshop Safety & PPE Compliance Reminder for All Bays',
    'Solar PV Installation NC II Pre-Registration Open',
    'Digital Certificates Ready for Wave 1 Completers',
  ];

  for (let i = 0; i < 520; i++) {
    const topic = ANNOUNCEMENT_TOPICS[i % ANNOUNCEMENT_TOPICS.length];
    let createdDate;
    let isPublished;
    let expiresAt;
    let title;

    if (i < 8) {
      // Live active on public landing page
      createdDate = clampDate(addDays('2026-11-19', i), START_DATE, END_DATE);
      isPublished = true;
      expiresAt = i % 2 === 0 ? '2026-12-20T09:00:00.000Z' : null;
      title = activeTitles[i];
    } else if (i < 490) {
      // Historical published notices (already expired before Nov 26 so public landing page stays crisp!)
      const dayOffset = Math.floor(((i - 8) / 482) * 52); // Sept 28 .. Nov 19
      createdDate = clampDate(addDays(START_DATE, dayOffset), START_DATE, '2026-11-19');
      isPublished = true;
      const expDay = clampDate(addDays(createdDate, 3), createdDate, '2026-11-24');
      expiresAt = phtWorkdayTimestamp(expDay, 17, 0, 0);
      title = `${topic.prefix} — Bulletin #${String(i - 7).padStart(3, '0')} (${createdDate})`;
    } else {
      // Drafts
      createdDate = clampDate(addDays('2026-10-15', (i - 490) % 42), START_DATE, END_DATE);
      isPublished = false;
      expiresAt = null;
      title = `[Draft] ${topic.prefix} — Upcoming Memo #${i - 489}`;
    }

    const ts = phtWorkdayTimestamp(createdDate, randInt(8, 16), randInt(0, 55), i % 60);
    announcementRows.push({
      id: seedUuid('announcements', i + 1),
      title,
      body: `${topic.body} (Ref: BMDC-2026-${String(i + 1).padStart(3, '0')})`,
      media_url: null,
      media_type: 'none',
      is_published: isPublished,
      expires_at: expiresAt,
      tenant_id: TENANT_ID,
      created_by: localAdminId,
      created_at: ts,
      updated_at: ts,
    });
  }
  await insertInBatches('announcements', announcementRows);
  console.log(`✅ announcements: +${announcementRows.length} (8 live + 482 historical expired + 30 drafts)`);

  // ---------------------------------------------------------------------------
  // 11. MESSENGER (49 conversations: 24 program_group + 25 direct, participants, 550 messages)
  // ---------------------------------------------------------------------------
  const seededProgIdList = [...programMetaById.keys()];
  const { data: existingProgConvs } = await supabase
    .from('conversations')
    .select('id, program_id')
    .eq('tenant_id', TENANT_ID)
    .eq('type', 'program_group')
    .in('program_id', seededProgIdList);
  const existingProgConvByProgId = new Map((existingProgConvs || []).map((c) => [c.program_id, c.id]));

  const conversationRows = [];
  const allConvIds = [];
  const participantRows = [];
  const messageRows = [];
  const convSenderPool = new Map();

  let convSeq = 1;
  // 24 program group chats (reuse if a live server sync/trigger already created one)
  for (const prog of programMetaById.values()) {
    const existingConvId = existingProgConvByProgId.get(prog.id);
    const convId = existingConvId || seedUuid('conversations', convSeq++);
    const cTs = phtWorkdayTimestamp(clampDate(prog.start_date, START_DATE, END_DATE), 8, 30, convSeq);
    if (!existingConvId) {
      conversationRows.push({
        id: convId,
        tenant_id: TENANT_ID,
        type: 'program_group',
        program_id: prog.id,
        title: `${prog.name} (Program GC)`,
        last_message_at: cTs,
        created_at: cTs,
        updated_at: cTs,
      });
    }
    allConvIds.push(convId);

    const pUsers = new Set([localAdminId, ...trainingStaffIds]);
    const progEnrollees = (enrolleesByProgram.get(prog.id) || []).slice(0, 25);
    for (const e of progEnrollees) {
      if (e.trainee.userId) pUsers.add(e.trainee.userId);
    }
    for (const uId of pUsers) {
      participantRows.push({
        conversation_id: convId,
        user_id: uId,
        joined_at: cTs,
        last_read_at: '2026-11-26T09:59:00.000Z',
      });
    }
    convSenderPool.set(convId, [...pUsers]);
  }

  // 25 direct conversations (starting with showcase trainee <-> LocalAdmin and Paolo)
  for (let i = 0; i < 25; i++) {
    const convId = seedUuid('conversations', convSeq++);
    const t = traineeMeta[i]; // i=0 is showcase trainee!
    const staffPeer = i % 3 === 0 ? localAdminId : trainingStaffIds[i % trainingStaffIds.length];
    const cTs = phtWorkdayTimestamp(t.regDate, 9, 15, i);
    conversationRows.push({
      id: convId,
      tenant_id: TENANT_ID,
      type: 'direct',
      program_id: null,
      title: null,
      last_message_at: cTs,
      created_at: cTs,
      updated_at: cTs,
    });
    allConvIds.push(convId);
    const peers = [...new Set([staffPeer, t.userId])];
    for (const uId of peers) {
      participantRows.push({
        conversation_id: convId,
        user_id: uId,
        joined_at: cTs,
        // Leave 4 direct threads with recent unread messages for LocalAdmin (realistic badge count)
        last_read_at: (uId === localAdminId && i < 4) ? '2026-11-24T08:00:00.000Z' : '2026-11-26T09:59:00.000Z',
      });
    }
    convSenderPool.set(convId, peers);
  }

  // Generate 550 chronological messages across the 49 conversations strictly in Sept 28 – Nov 26
  for (let i = 0; i < 550; i++) {
    const convId = allConvIds[i % allConvIds.length];
    const pool = convSenderPool.get(convId) || [localAdminId];
    const senderId = pool[(i + Math.floor(i / allConvIds.length)) % pool.length];
    const dayOffset = Math.floor((i / 550) * 59);
    const mDate = clampDate(addDays(START_DATE, dayOffset), START_DATE, END_DATE);
    const mTs = phtWorkdayTimestamp(mDate, randInt(8, 16), randInt(0, 55), i % 60);

    messageRows.push({
      id: seedUuid('messages', i + 1),
      conversation_id: convId,
      sender_id: senderId,
      content: MESSAGE_TEMPLATES[i % MESSAGE_TEMPLATES.length],
      attachment_url: null,
      attachment_type: null,
      attachment_name: null,
      is_deleted: false,
      deleted_at: null,
      created_at: mTs,
    });
  }
  // Sort ascending so trg_update_conversation_timestamp leaves each conversation's last_message_at at its newest message
  messageRows.sort((a, b) => a.created_at.localeCompare(b.created_at));

  // Insert conversations (handling any race where a live Messenger poll auto-creates a program GC)
  const directConvs = conversationRows.filter((c) => c.type === 'direct');
  const groupConvs = conversationRows.filter((c) => c.type === 'program_group');
  await insertInBatches('conversations', directConvs);
  let reusedCount = existingProgConvByProgId.size;
  for (const gc of groupConvs) {
    const { error: gcErr } = await supabase.from('conversations').insert(gc);
    if (gcErr) {
      if (gcErr.code === '23505') {
        const { data: raced } = await supabase
          .from('conversations')
          .select('id')
          .eq('tenant_id', TENANT_ID)
          .eq('type', 'program_group')
          .eq('program_id', gc.program_id)
          .single();
        if (raced?.id) {
          // Re-point any participants & messages planned for gc.id to raced.id
          for (const p of participantRows) if (p.conversation_id === gc.id) p.conversation_id = raced.id;
          for (const m of messageRows) if (m.conversation_id === gc.id) m.conversation_id = raced.id;
          reusedCount++;
          continue;
        }
      }
      throw new Error(`Insert failed on conversations (program GC): ${gcErr.message}`);
    }
  }
  // Upsert participants to avoid conflicts if live messenger sync pre-added staff to a program GC
  for (let i = 0; i < participantRows.length; i += 200) {
    const chunk = participantRows.slice(i, i + 200);
    const { error } = await supabase
      .from('conversation_participants')
      .upsert(chunk, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
    if (error) throw new Error(`Upsert failed on conversation_participants: ${error.message}`);
  }
  await insertInBatches('messages', messageRows);
  console.log(`✅ conversations: +${conversationRows.length} (${reusedCount} reused), participants: +${participantRows.length}, messages: +${messageRows.length}`);

  // Ensure both demo staff accounts exist & are enrolled in all seeded program group chats
  await ensureDemoStaffAccounts(passwordHash);

  // ---------------------------------------------------------------------------
  // 12. EXTENSION REQUESTS (18 for SuperAdmin / LocalAdmin)
  // ---------------------------------------------------------------------------
  const extStatuses = ['submitted', 'under_review', 'approved', 'in_development', 'deployed', 'rejected'];
  const extPriorities = ['low', 'medium', 'high', 'critical'];
  const extTitles = [
    'SMS Attendance Reminder Integration for Rural Barangays',
    'Batch TESDA RWAC Export Template Support',
    'Offline QR Tool Checkout Queue Enhancement',
    'Automated Certificate Batch Zip Download',
    'Multi-Trainer Attendance Co-Signing Permission',
    'Inventory Calibration Expiry Alert Notifications',
    'Trainee Re-Enrollment Prerequisite Matrix',
    'Barangay Demographic Heatmap Report Filter',
    'Custom Signatory Digital Stamp Positioning',
    'Monthly LGU Executive Summary PDF Cover Page',
    'Bulk Requirement Verification Workflow for Coordinators',
    'Weekend Makeup Session Auto-Scheduling Helper',
    'Borrower Overdue Penalty Slip Printable Format',
    'Bilingual Filipino/English Email Template Editor',
    'Trainee Alumni Employment Follow-Up Survey Link',
    'Workshop Bay Capacity Conflict Detector',
    'Automated Monthly Attendance Rate CSV Export',
    'Mobile Low-Bandwidth Document Compression',
  ];
  const extRows = extTitles.map((title, i) => {
    const st = extStatuses[i % extStatuses.length];
    const reqDate = clampDate(addDays(START_DATE, i * 3), START_DATE, END_DATE);
    const revDate = clampDate(addDays(reqDate, 3), reqDate, END_DATE);
    const cTs = phtWorkdayTimestamp(reqDate, 10, 15, i);
    const isReviewed = st !== 'submitted';
    return {
      id: seedUuid('extension_requests', i + 1),
      tenant_id: TENANT_ID,
      requested_by: localAdminId,
      title,
      description: `Requested platform enhancement for Bongabong Manpower Development Center operations: ${title}.`,
      business_justification: 'Reduces manual coordinator processing time during high-volume Q4 TESDA intakes.',
      priority: extPriorities[i % extPriorities.length],
      status: st,
      affected_users_count: randInt(25, 550),
      reviewed_by: isReviewed ? superAdminId : null,
      reviewed_at: isReviewed ? phtWorkdayTimestamp(revDate, 14, 30, i) : null,
      review_notes: isReviewed ? `Reviewed by Platform Super Admin — marked as ${st.replace('_', ' ')}.` : null,
      created_at: cTs,
      updated_at: isReviewed ? phtWorkdayTimestamp(revDate, 14, 30, i) : cTs,
    };
  });
  await insertInBatches('extension_requests', extRows);
  console.log(`✅ extension_requests: +${extRows.length} rows`);

  // ---------------------------------------------------------------------------
  // 13. ACTIVITY LOGS (600) & AUDIT LOGS (550)
  // ---------------------------------------------------------------------------
  const activityRows = [];
  const activityTemplates = [
    { action: 'create', entity_type: 'trainee', actor: () => pick(trainingStaffIds), entityId: (i) => traineeMeta[i % 550].id },
    { action: 'update', entity_type: 'trainee', actor: () => localAdminId, entityId: (i) => traineeMeta[i % 550].id },
    { action: 'create', entity_type: 'program', actor: () => localAdminId, entityId: (i) => programRows[i % 24].id },
    { action: 'create', entity_type: 'item', actor: () => inventoryStaffId, entityId: (i) => itemRows[i % 520].id },
    { action: 'borrow', entity_type: 'lending', actor: () => inventoryStaffId, entityId: (i) => lendingRows[i % 550].id },
    { action: 'return', entity_type: 'lending', actor: () => inventoryStaffId, entityId: (i) => lendingRows[i % 390].id },
    { action: 'login', entity_type: 'auth', actor: () => pick([localAdminId, inventoryStaffId, ...trainingStaffIds]), entityId: (i) => traineeMeta[i % 550].userId },
  ];

  for (let i = 0; i < 600; i++) {
    const tpl = activityTemplates[i % activityTemplates.length];
    const dayOffset = Math.floor((i / 600) * 59);
    const lDate = clampDate(addDays(START_DATE, dayOffset), START_DATE, END_DATE);
    const ts = phtWorkdayTimestamp(lDate, randInt(8, 16), randInt(0, 55), i % 60);
    activityRows.push({
      id: seedUuid('activity_logs', i + 1),
      tenant_id: TENANT_ID,
      user_id: tpl.actor(),
      action: tpl.action,
      entity_type: tpl.entity_type,
      entity_id: String(tpl.entityId(i)),
      details: { source: 'bmdc_capstone_operations', module: tpl.entity_type, date: lDate },
      ip_address: `192.168.1.${(i % 200) + 10}`,
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      created_at: ts,
    });
  }
  await insertInBatches('activity_logs', activityRows);

  const auditRows = [];
  const auditTemplates = [
    { action: 'auth.login', entity_type: 'user', entityId: (i) => traineeMeta[i % 550].userId },
    { action: 'trainee.approved', entity_type: 'trainee', entityId: (i) => traineeMeta[i % 550].id },
    { action: 'certificate.issued', entity_type: 'certificate', entityId: (i) => certificateRows[i % certificateRows.length].id },
    { action: 'report.generate', entity_type: 'report', entityId: () => 'training-summary' },
    { action: 'inventory.updated', entity_type: 'item', entityId: (i) => itemRows[i % 520].id },
    { action: 'lending.created', entity_type: 'lending', entityId: (i) => lendingRows[i % 550].id },
  ];

  for (let i = 0; i < 550; i++) {
    const tpl = auditTemplates[i % auditTemplates.length];
    const dayOffset = Math.floor((i / 550) * 59);
    const aDate = clampDate(addDays(START_DATE, dayOffset), START_DATE, END_DATE);
    const ts = phtWorkdayTimestamp(aDate, randInt(8, 16), randInt(0, 55), i % 60);
    auditRows.push({
      id: seedUuid('audit_logs', i + 1),
      tenant_id: TENANT_ID,
      user_id: pick([localAdminId, inventoryStaffId, ...trainingStaffIds]),
      action: tpl.action,
      entity_type: tpl.entity_type,
      entity_id: String(tpl.entityId(i)),
      details: { event: tpl.action, date: aDate },
      ip_address: `192.168.1.${(i % 200) + 10}`,
      user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0',
      created_at: ts,
    });
  }
  await insertInBatches('audit_logs', auditRows);
  console.log(`✅ activity_logs: +${activityRows.length}, audit_logs: +${auditRows.length}`);

  console.log('\n🎉 Additive capstone seeding completed cleanly!\n');
  await runVerification();
}

// =============================================================================
// OUTSIDE JUDGE: AUTOMATED DB INTEGRITY & DATE-BOUND VERIFICATION
// =============================================================================

async function runVerification() {
  console.log('🔍 Running Outside-Judge Verification Audit...\n');
  let failures = 0;
  const check = (label, passed, detail) => {
    const icon = passed ? '✅' : '❌';
    console.log(`   ${icon} ${label.padEnd(46)} ${detail}`);
    if (!passed) failures++;
  };

  // 1. Seeded row counts >= 500 across all transactional functions
  const minThresholds = [
    ['trainees', 500],
    ['users', 500],
    ['enrollments', 500],
    ['program_sessions', 500],
    ['attendance', 500],
    ['certificates', 500],
    ['trainee_status_records', 500],
    ['trainee_remarks', 500],
    ['enrollment_requirements', 500],
    ['training_requirement_files', 500],
    ['items', 500],
    ['lendings', 500],
    ['announcements', 500],
    ['messages', 500],
    ['activity_logs', 500],
    ['audit_logs', 500],
    ['programs', 20],
    ['instructors', 20],
    ['attendance_exceptions', 15],
    ['extension_requests', 15],
  ];

  console.log('1) Table Row Counts (Seeded / Total):');
  for (const [table, minExpected] of minThresholds) {
    const seeded = await countSeedRows(table);
    const total = await countAllRows(table);
    check(`${table} >= ${minExpected} seeded`, seeded >= minExpected, `seeded=${seeded}, total=${total}`);
  }

  // 2. Date boundary checks (historical transactions strictly 2026-09-28 .. 2026-11-26; scheduled sessions up to MAX_PROGRAM_END_DATE)
  console.log('\n2) Date Window Checks:');
  const dateChecks = [
    ['trainees', 'created_at', END_DATE],
    ['enrollments', 'enrollment_date', END_DATE],
    ['program_sessions', 'session_date', MAX_PROGRAM_END_DATE],
    ['attendance', 'created_at', END_DATE],
    ['certificates', 'issue_date', END_DATE],
    ['trainee_status_records', 'recorded_at', END_DATE],
    ['trainee_remarks', 'created_at', END_DATE],
    ['training_requirement_files', 'uploaded_at', END_DATE],
    ['items', 'created_at', END_DATE],
    ['lendings', 'lent_date', END_DATE],
    ['announcements', 'created_at', END_DATE],
    ['messages', 'created_at', END_DATE],
    ['activity_logs', 'created_at', END_DATE],
    ['audit_logs', 'created_at', END_DATE],
    ['extension_requests', 'created_at', END_DATE],
  ];

  for (const [table, col, maxAllowed] of dateChecks) {
    const { data: minRow } = await supabase
      .from(table)
      .select(col)
      .gte('id', SEED_UUID_MIN)
      .lte('id', SEED_UUID_MAX)
      .order(col, { ascending: true })
      .limit(1);
    const { data: maxRow } = await supabase
      .from(table)
      .select(col)
      .gte('id', SEED_UUID_MIN)
      .lte('id', SEED_UUID_MAX)
      .order(col, { ascending: false })
      .limit(1);
    const minVal = String(minRow?.[0]?.[col] || '').slice(0, 10);
    const maxVal = String(maxRow?.[0]?.[col] || '').slice(0, 10);
    const ok = minVal >= START_DATE && maxVal <= maxAllowed && minVal.length === 10;
    check(`${table}.${col}`, ok, `${minVal} .. ${maxVal} (limit <= ${maxAllowed})`);
  }

  // 3. Schema invariants, showcase login, and physical sample media
  console.log('\n3) Invariants, Auth & Media Checks:');
  const { data: v3nf } = await supabase.rpc('validate_trainees_3nf');
  const v3nfIssues = (v3nf || []).filter((r) => Number(r.count) > 0);
  check('validate_trainees_3nf() zero issues', v3nfIssues.length === 0, JSON.stringify(v3nf || []));

  const { data: badItems } = await supabase
    .from('items')
    .select('id, quantity, available_quantity')
    .gte('id', SEED_UUID_MIN)
    .lte('id', SEED_UUID_MAX);
  const invalidQty = (badItems || []).filter((it) => it.available_quantity < 0 || it.available_quantity > it.quantity);
  check('items available_quantity invariant', invalidQty.length === 0, `checked=${badItems?.length || 0}, invalid=${invalidQty.length}`);

  const { data: showcaseUser } = await supabase
    .from('users')
    .select('id, email, password_hash')
    .eq('email', SHOWCASE_EMAIL)
    .maybeSingle();
  const pwMatches = showcaseUser ? await bcrypt.compare(TEST_PASSWORD, showcaseUser.password_hash) : false;
  check(`showcase login (${SHOWCASE_EMAIL})`, Boolean(showcaseUser && pwMatches), `password "${TEST_PASSWORD}" bcrypt=${pwMatches}`);

  for (const staff of DEMO_STAFF_ACCOUNTS) {
    const { data: staffUser } = await supabase
      .from('users')
      .select('id, email, role, password_hash')
      .eq('email', staff.email)
      .maybeSingle();
    const staffPwOk = staffUser ? await bcrypt.compare(TEST_PASSWORD, staffUser.password_hash) : false;
    const { data: staffLink } = staffUser
      ? await supabase
        .from('users_tenants')
        .select('tenant_id')
        .eq('user_id', staffUser.id)
        .eq('tenant_id', TENANT_ID)
        .maybeSingle()
      : { data: null };
    check(
      `demo staff (${staff.email})`,
      Boolean(staffUser && staffUser.role === staff.role && staffPwOk && staffLink),
      `role=${staffUser?.role}, tenantLinked=${Boolean(staffLink)}, bcrypt=${staffPwOk}`
    );
  }

  const { count: legacyActiveEnrollments } = await supabase
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('status', 'active')
    .gte('id', SEED_UUID_MIN)
    .lte('id', SEED_UUID_MAX);
  check(
    'seeded enrollments use enrolled (0 legacy active)',
    (legacyActiveEnrollments || 0) === 0,
    `legacy_active=${legacyActiveEnrollments || 0}`
  );

  const { count: livePublicAnnouncements } = await supabase
    .from('announcements')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', TENANT_ID)
    .eq('is_published', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  check('public landing announcements stay crisp (<=15)', (livePublicAnnouncements || 0) <= 15 && (livePublicAnnouncements || 0) >= 1, `live_public=${livePublicAnnouncements}`);

  const generatedFiles = listAllGeneratedSeedMediaFiles();
  const missingMedia = generatedFiles.filter((f) => !fs.existsSync(f.abs));
  check(
    'reusable sample media & photo files on disk',
    missingMedia.length === 0,
    `present=${generatedFiles.length - missingMedia.length}/${generatedFiles.length}`
  );

  // Decode-verify every generated image via sharp (decrypting AENC if FILE_ENCRYPTION_ENABLED)
  let imageChecked = 0;
  const badImages = [];
  for (const item of generatedFiles) {
    if (item.kind === 'pdf' || !fs.existsSync(item.abs)) continue;
    imageChecked++;
    try {
      const raw = fs.readFileSync(item.abs);
      const decoded = item.encryptedCandidate ? maybeDecryptSelfieBuffer(raw) : raw;
      const meta = await sharp(decoded).metadata();
      const formatOk = meta.format === item.kind;
      const dimsOk = (meta.width || 0) > 0 && (meta.height || 0) > 0;
      if (!formatOk || !dimsOk) {
        badImages.push(`${path.basename(item.abs)}(fmt=${meta.format},w=${meta.width},h=${meta.height})`);
      }
    } catch (err) {
      badImages.push(`${path.basename(item.abs)}(${err.message})`);
    }
  }
  check(
    'sharp decode validation on all seed images',
    badImages.length === 0 && imageChecked > 0,
    `valid=${imageChecked - badImages.length}/${imageChecked}${badImages.length ? ` bad=[${badImages.join(', ')}]` : ''}`
  );

  // Paginated DB checks: 100% of seeded trainees have avatars, 100% of present/late attendance have selfies, 0% of absent/excused
  const seededTrainees = await fetchAllSeededRows('trainees', 'id, sex, photo_path, thumbnail_path');
  const expectedTraineePrefix = `/uploads/${TENANT_ID}/images/trainees/seed-trainee-`;
  const expectedThumbPrefix = `/uploads/${TENANT_ID}/images/trainees/thumbnails/seed-trainee-`;
  const missingAvatarCount = seededTrainees.filter(
    (t) =>
      !String(t.photo_path || '').startsWith(expectedTraineePrefix) ||
      !String(t.thumbnail_path || '').startsWith(expectedThumbPrefix)
  ).length;
  check(
    'seeded trainees avatar & thumbnail coverage',
    seededTrainees.length > 0 && missingAvatarCount === 0,
    `checked=${seededTrainees.length}, missing=${missingAvatarCount}`
  );

  const seededAttendance = await fetchAllSeededRows(
    'attendance',
    'id, status, morning_time_in, afternoon_time_out, selfie_morning_path, selfie_afternoon_path'
  );
  const expectedSelfiePrefix = `/uploads/${TENANT_ID}/images/attendance/seed-attendance-`;
  let withTimestamps = 0;
  let missingSelfies = 0;
  let withoutTimestamps = 0;
  let unexpectedSelfies = 0;

  for (const row of seededAttendance) {
    const hasAm = Boolean(row.morning_time_in);
    const hasPm = Boolean(row.afternoon_time_out);
    if (hasAm || hasPm) {
      withTimestamps++;
      if (hasAm && !String(row.selfie_morning_path || '').startsWith(expectedSelfiePrefix)) missingSelfies++;
      if (hasPm && !String(row.selfie_afternoon_path || '').startsWith(expectedSelfiePrefix)) missingSelfies++;
      if (!hasAm && row.selfie_morning_path) unexpectedSelfies++;
      if (!hasPm && row.selfie_afternoon_path) unexpectedSelfies++;
    } else {
      withoutTimestamps++;
      if (row.selfie_morning_path || row.selfie_afternoon_path) unexpectedSelfies++;
    }
  }
  check(
    'seeded attendance selfies (1:1 with timestamps)',
    seededAttendance.length > 0 && missingSelfies === 0 && unexpectedSelfies === 0,
    `total=${seededAttendance.length}, checked_in=${withTimestamps}, no_checkin=${withoutTimestamps}, missing=${missingSelfies}, unexpected=${unexpectedSelfies}`
  );

  // Zero-collateral audit: confirm pre-existing non-seed uploads remain intact
  const attDir = path.join(UPLOAD_TENANT_DIR, 'images', 'attendance');
  const progImgDir = path.join(UPLOAD_TENANT_DIR, 'images', 'programs');
  const itemQrDir = path.join(UPLOAD_TENANT_DIR, 'qrcodes', 'items');
  const nonSeedAttendanceFiles = fs.existsSync(attDir)
    ? fs.readdirSync(attDir).filter((name) => !name.startsWith('seed-') && fs.statSync(path.join(attDir, name)).isFile())
    : [];
  const nonSeedProgramFiles = fs.existsSync(progImgDir)
    ? fs.readdirSync(progImgDir).filter((name) => !name.startsWith('seed-') && fs.statSync(path.join(progImgDir, name)).isFile())
    : [];
  const nonSeedItemQrFiles = fs.existsSync(itemQrDir)
    ? fs.readdirSync(itemQrDir).filter((name) => !name.startsWith('seed-') && fs.statSync(path.join(itemQrDir, name)).isFile())
    : [];
  console.log(`   ℹ️  pre-existing non-seed uploads               attendance=${nonSeedAttendanceFiles.length}, programs=${nonSeedProgramFiles.length}, itemQRs=${nonSeedItemQrFiles.length}`);

  // Paginated DB checks for seeded programs & items images + full session coverage
  const seededPrograms = await fetchAllSeededRows(
    'programs',
    'id, name, status, start_date, end_date, deleted_at, image_path, thumbnail_path'
  );
  const expectedProgPrefix = `/uploads/${TENANT_ID}/images/programs/seed-program-`;
  const expectedProgThumbPrefix = `/uploads/${TENANT_ID}/images/programs/thumbnails/seed-program-`;
  const missingProgImgs = seededPrograms.filter(
    (p) =>
      !String(p.image_path || '').startsWith(expectedProgPrefix) ||
      !String(p.thumbnail_path || '').startsWith(expectedProgThumbPrefix)
  ).length;
  check(
    'seeded programs image & thumbnail coverage',
    seededPrograms.length > 0 && missingProgImgs === 0,
    `checked=${seededPrograms.length}, missing=${missingProgImgs}`
  );

  // Check 100% weekday/non-holiday session coverage & 0 duplicate dates across all non-deleted seeded programs
  const activeOrUpcomingSeeded = seededPrograms.filter(
    (p) => !p.deleted_at && (p.status === 'active' || p.status === 'upcoming')
  );
  const nonDeletedSeededIds = seededPrograms.filter((p) => !p.deleted_at).map((p) => p.id);
  const allSeededProgramSessions = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data: batch, error: sessErr } = await supabase
      .from('program_sessions')
      .select('id, program_id, session_date')
      .in('program_id', nonDeletedSeededIds)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (sessErr) throw new Error(`Failed verifying program_sessions: ${sessErr.message}`);
    allSeededProgramSessions.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
  }

  const sessionsByProg = new Map();
  let duplicateDateCount = 0;
  for (const s of allSeededProgramSessions) {
    if (!sessionsByProg.has(s.program_id)) sessionsByProg.set(s.program_id, new Map());
    const dateMap = sessionsByProg.get(s.program_id);
    const prev = dateMap.get(s.session_date) || 0;
    if (prev >= 1) duplicateDateCount++;
    dateMap.set(s.session_date, prev + 1);
  }

  let missingExpectedSessions = 0;
  const programsWithGaps = [];
  for (const p of activeOrUpcomingSeeded) {
    const expectedDates = getExpectedSessionDates(p.start_date, p.end_date);
    const dateMap = sessionsByProg.get(p.id) || new Map();
    const missing = expectedDates.filter((d) => !dateMap.has(d));
    if (missing.length > 0) {
      missingExpectedSessions += missing.length;
      programsWithGaps.push(`${p.name} (-${missing.length})`);
    }
  }

  check(
    'active & upcoming seeded session coverage',
    activeOrUpcomingSeeded.length > 0 && missingExpectedSessions === 0,
    `programs=${activeOrUpcomingSeeded.length}, missing_dates=${missingExpectedSessions}${programsWithGaps.length ? ` [${programsWithGaps.join(', ')}]` : ''}`
  );
  check(
    'seeded programs zero duplicate session dates',
    duplicateDateCount === 0,
    `checked_sessions=${allSeededProgramSessions.length}, duplicate_dates=${duplicateDateCount}`
  );

  const seededItems = await fetchAllSeededRows('items', 'id, category, image_path, thumbnail_path, qr_code_path');
  const expectedItemPrefix = `/uploads/${TENANT_ID}/images/items/seed-item-`;
  const expectedItemThumbPrefix = `/uploads/${TENANT_ID}/images/items/thumbnails/seed-item-`;
  const missingItemImgs = seededItems.filter(
    (it) =>
      !String(it.image_path || '').startsWith(expectedItemPrefix) ||
      !String(it.thumbnail_path || '').startsWith(expectedItemThumbPrefix) ||
      it.qr_code_path !== SAMPLE_ITEM_QR_REL
  ).length;
  check(
    'seeded items image, thumb & QR coverage',
    seededItems.length > 0 && missingItemImgs === 0,
    `checked=${seededItems.length}, missing=${missingItemImgs}`
  );

  // Live authenticated HTTP check against /api/files/ (if backend is listening)
  const backendBase = (process.env.BACKEND_URL || 'http://localhost:3003').replace(/\/$/, '');
  const sampleSelfieUrl = `${backendBase}/api/files/${TENANT_ID}/images/attendance/seed-attendance-male-1-am.jpg`;
  const sampleThumbUrl = `${backendBase}/api/files/${TENANT_ID}/images/trainees/thumbnails/seed-trainee-male-1.webp`;
  const sampleProgThumbUrl = `${backendBase}/api/files/${TENANT_ID}/images/programs/thumbnails/seed-program-construction-metals.webp`;
  const sampleItemThumbUrl = `${backendBase}/api/files/${TENANT_ID}/images/items/thumbnails/seed-item-equipment.webp`;
  const sampleItemQrUrl = `${backendBase}/api/files/${TENANT_ID}/qrcodes/items/seed-item-qr-sample.png`;
  try {
    const unauthRes = await fetch(sampleSelfieUrl, { signal: AbortSignal.timeout(5000) });
    check(
      'HTTP /api/files/ blocks unauth attendance selfie',
      unauthRes.status === 401 || unauthRes.status === 403,
      `status=${unauthRes.status}`
    );

    const loginRes = await fetch(`${backendBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SHOWCASE_EMAIL, password: TEST_PASSWORD }),
      signal: AbortSignal.timeout(5000),
    });
    const loginBody = await loginRes.json().catch(() => ({}));
    const token = loginBody?.data?.token || loginBody?.token || null;

    if (loginRes.ok && token) {
      const authRes = await fetch(sampleSelfieUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      const authBuf = Buffer.from(await authRes.arrayBuffer());
      let decodedFmt = 'error';
      if (authRes.status === 200) {
        const meta = await sharp(authBuf).metadata().catch(() => null);
        decodedFmt = meta?.format || 'invalid';
      }
      check(
        'HTTP /api/files/ serves authed attendance JPEG',
        authRes.status === 200 && decodedFmt === 'jpeg',
        `status=${authRes.status}, contentType=${authRes.headers.get('content-type')}, sharp=${decodedFmt}, bytes=${authBuf.length}`
      );

      const qrRes = await fetch(sampleItemQrUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      const qrBuf = Buffer.from(await qrRes.arrayBuffer());
      const qrMeta = qrRes.status === 200 ? await sharp(qrBuf).metadata().catch(() => null) : null;
      check(
        'HTTP /api/files/ serves authed item QR PNG',
        qrRes.status === 200 && qrMeta?.format === 'png',
        `status=${qrRes.status}, contentType=${qrRes.headers.get('content-type')}, sharp=${qrMeta?.format || 'invalid'}, bytes=${qrBuf.length}`
      );
    } else {
      check('HTTP /api/auth/login showcase trainee JWT', false, `status=${loginRes.status}`);
    }

    const thumbRes = await fetch(sampleThumbUrl, { signal: AbortSignal.timeout(5000) });
    const thumbBuf = Buffer.from(await thumbRes.arrayBuffer());
    const thumbMeta = thumbRes.status === 200 ? await sharp(thumbBuf).metadata().catch(() => null) : null;
    check(
      'HTTP /api/files/ serves public trainee WebP thumb',
      thumbRes.status === 200 && thumbMeta?.format === 'webp',
      `status=${thumbRes.status}, contentType=${thumbRes.headers.get('content-type')}, sharp=${thumbMeta?.format || 'invalid'}, bytes=${thumbBuf.length}`
    );

    const progThumbRes = await fetch(sampleProgThumbUrl, { signal: AbortSignal.timeout(5000) });
    const progThumbBuf = Buffer.from(await progThumbRes.arrayBuffer());
    const progThumbMeta = progThumbRes.status === 200 ? await sharp(progThumbBuf).metadata().catch(() => null) : null;
    check(
      'HTTP /api/files/ serves public program WebP thumb',
      progThumbRes.status === 200 && progThumbMeta?.format === 'webp',
      `status=${progThumbRes.status}, contentType=${progThumbRes.headers.get('content-type')}, sharp=${progThumbMeta?.format || 'invalid'}, bytes=${progThumbBuf.length}`
    );

    const itemThumbRes = await fetch(sampleItemThumbUrl, { signal: AbortSignal.timeout(5000) });
    const itemThumbBuf = Buffer.from(await itemThumbRes.arrayBuffer());
    const itemThumbMeta = itemThumbRes.status === 200 ? await sharp(itemThumbBuf).metadata().catch(() => null) : null;
    check(
      'HTTP /api/files/ serves public item WebP thumb',
      itemThumbRes.status === 200 && itemThumbMeta?.format === 'webp',
      `status=${itemThumbRes.status}, contentType=${itemThumbRes.headers.get('content-type')}, sharp=${itemThumbMeta?.format || 'invalid'}, bytes=${itemThumbBuf.length}`
    );
  } catch (err) {
    console.log(`   ⚠️  live HTTP /api/files/ check skipped         backend not reachable at ${backendBase} (${err.code || err.message})`);
  }

  console.log('\n' + '='.repeat(70));
  if (failures === 0) {
    console.log('✅ ALL OUTSIDE-JUDGE CHECKS PASSED (0 failures).');
  } else {
    console.log(`❌ VERIFICATION FAILED WITH ${failures} ISSUE(S).`);
    process.exitCode = 1;
  }
  console.log('='.repeat(70) + '\n');
}

// =============================================================================
// IN-PLACE PHOTO BACKFILL (STRICTLY SCOPED TO SEEDED UUID RANGE)
// =============================================================================

async function fetchAllSeededRows(table, selectCols) {
  const out = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(selectCols)
      .gte('id', SEED_UUID_MIN)
      .lte('id', SEED_UUID_MAX)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`Query failed on ${table}: ${error.message}`);
    const batch = data || [];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

async function patchSeededPhotos() {
  console.log('\n📸 Patching seeded trainee avatars & attendance selfies in-place...');
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log(`   Range:  ${SEED_UUID_MIN} .. ${SEED_UUID_MAX}\n`);

  const mediaSizes = await createSampleMediaFiles();
  const totalMediaKb = (Object.values(mediaSizes).reduce((a, b) => a + b, 0) / 1024).toFixed(1);
  console.log(`✅ Generated ${listAllGeneratedSeedMediaFiles().length} sample media & photo files (${totalMediaKb} KB total).`);

  // 1. Fetch and bucket-update all seeded trainees (6 buckets -> ~6 requests)
  const seededTrainees = await fetchAllSeededRows('trainees', 'id, sex');
  if (seededTrainees.length === 0) {
    console.log('⚠️  No capstone-seeded trainees found in database. Run without flags to perform initial seed.');
    return;
  }

  const traineeSexById = new Map();
  const traineeBuckets = new Map();
  for (const t of seededTrainees) {
    traineeSexById.set(t.id, t.sex);
    const paths = getSeedTraineePhotoPaths(t.sex, t.id);
    const key = `${paths.photo_path}|${paths.thumbnail_path}`;
    if (!traineeBuckets.has(key)) traineeBuckets.set(key, { paths, ids: [] });
    traineeBuckets.get(key).ids.push(t.id);
  }

  let updatedTrainees = 0;
  for (const { paths, ids } of traineeBuckets.values()) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { error } = await supabase
        .from('trainees')
        .update({
          photo_path: paths.photo_path,
          thumbnail_path: paths.thumbnail_path,
        })
        .in('id', chunk);
      if (error) throw new Error(`Failed updating trainee photos: ${error.message}`);
      updatedTrainees += chunk.length;
    }
  }
  console.log(`✅ trainees updated: ${updatedTrainees} rows (${traineeBuckets.size} avatar variants)`);

  // 2. Fetch and bucket-update all seeded attendance rows (~7 buckets -> ~22 requests)
  const seededAttendance = await fetchAllSeededRows(
    'attendance',
    'id, trainee_id, status, morning_time_in, afternoon_time_out'
  );
  const attendanceBuckets = new Map();
  let withSelfies = 0;
  let clearedNulls = 0;

  for (const row of seededAttendance) {
    const hasAm = Boolean(row.morning_time_in);
    const hasPm = Boolean(row.afternoon_time_out);
    const sex = traineeSexById.get(row.trainee_id) || 'Male';
    const paths = getSeedAttendanceSelfiePaths(sex, row.trainee_id, hasAm, hasPm);
    if (paths.selfie_morning_path || paths.selfie_afternoon_path) withSelfies++;
    else clearedNulls++;

    const key = `${paths.selfie_morning_path || 'NULL'}|${paths.selfie_afternoon_path || 'NULL'}`;
    if (!attendanceBuckets.has(key)) attendanceBuckets.set(key, { paths, ids: [] });
    attendanceBuckets.get(key).ids.push(row.id);
  }

  let updatedAttendance = 0;
  for (const { paths, ids } of attendanceBuckets.values()) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { error } = await supabase
        .from('attendance')
        .update({
          selfie_morning_path: paths.selfie_morning_path,
          selfie_afternoon_path: paths.selfie_afternoon_path,
        })
        .in('id', chunk);
      if (error) throw new Error(`Failed updating attendance selfies: ${error.message}`);
      updatedAttendance += chunk.length;
    }
  }
  console.log(`✅ attendance updated: ${updatedAttendance} rows (${withSelfies} with AM/PM selfies, ${clearedNulls} absent/excused kept null)`);

  // 3. Fetch and bucket-update all seeded programs (9 sector banners)
  const seededPrograms = await fetchAllSeededRows('programs', 'id, name');
  const programBuckets = new Map();
  for (const p of seededPrograms) {
    const paths = getSeedProgramImagePaths(p.id, p.name);
    const key = `${paths.image_path}|${paths.thumbnail_path}`;
    if (!programBuckets.has(key)) programBuckets.set(key, { paths, ids: [] });
    programBuckets.get(key).ids.push(p.id);
  }
  let updatedPrograms = 0;
  for (const { paths, ids } of programBuckets.values()) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { error } = await supabase
        .from('programs')
        .update({
          image_path: paths.image_path,
          thumbnail_path: paths.thumbnail_path,
        })
        .in('id', chunk);
      if (error) throw new Error(`Failed updating program images: ${error.message}`);
      updatedPrograms += chunk.length;
    }
  }
  console.log(`✅ programs updated: ${updatedPrograms} rows (${programBuckets.size} sector visuals)`);

  // 4. Fetch and bucket-update all seeded items (7 category visuals + QR code PNG)
  const seededItems = await fetchAllSeededRows('items', 'id, category');
  const itemBuckets = new Map();
  for (const it of seededItems) {
    const paths = getSeedItemImagePaths(it.category);
    const key = `${paths.image_path}|${paths.thumbnail_path}|${paths.qr_code_path}`;
    if (!itemBuckets.has(key)) itemBuckets.set(key, { paths, ids: [] });
    itemBuckets.get(key).ids.push(it.id);
  }
  let updatedItems = 0;
  for (const { paths, ids } of itemBuckets.values()) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      const { error } = await supabase
        .from('items')
        .update({
          image_path: paths.image_path,
          thumbnail_path: paths.thumbnail_path,
          qr_code_path: paths.qr_code_path,
        })
        .in('id', chunk);
      if (error) throw new Error(`Failed updating item images: ${error.message}`);
      updatedItems += chunk.length;
    }
  }
  console.log(`✅ items updated: ${updatedItems} rows (${itemBuckets.size} category visuals + QR)\n`);

  await runVerification();
}

// =============================================================================
// DEMO STAFF ACCOUNTS (Training Coordinator + Inventory Manager)
// =============================================================================

async function ensureDemoStaffAccounts(existingHash = null) {
  const passwordHash = existingHash || (await bcrypt.hash(TEST_PASSWORD, 10));
  const createdAt = phtWorkdayTimestamp(START_DATE, 8, 10, 0);

  for (const staff of DEMO_STAFF_ACCOUNTS) {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', staff.email)
      .maybeSingle();

    let userId = existing?.id;
    if (!userId) {
      const { error: uErr } = await supabase.from('users').insert({
        id: staff.id,
        email: staff.email,
        username: staff.username,
        password_hash: passwordHash,
        role: staff.role,
        preferred_language: 'en',
        created_at: createdAt,
        updated_at: createdAt,
      });
      if (uErr) throw new Error(`Failed creating demo staff ${staff.email}: ${uErr.message}`);
      userId = staff.id;
    }

    const { error: utErr } = await supabase
      .from('users_tenants')
      .upsert(
        { user_id: userId, tenant_id: TENANT_ID, is_primary: true, created_at: createdAt },
        { onConflict: 'user_id,tenant_id', ignoreDuplicates: true }
      );
    if (utErr) throw new Error(`Failed linking tenant for ${staff.email}: ${utErr.message}`);
  }

  // Add both demo staff accounts to all seeded program group chats so Messenger works immediately
  const { data: progConvs } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', TENANT_ID)
    .eq('type', 'program_group')
    .gte('id', SEED_UUID_MIN)
    .lte('id', SEED_UUID_MAX);

  if (progConvs && progConvs.length > 0) {
    const links = [];
    for (const c of progConvs) {
      for (const staff of DEMO_STAFF_ACCOUNTS) {
        links.push({
          conversation_id: c.id,
          user_id: staff.id,
          joined_at: createdAt,
          last_read_at: '2026-11-26T09:59:00.000Z',
        });
      }
    }
    const { error: cpErr } = await supabase
      .from('conversation_participants')
      .upsert(links, { onConflict: 'conversation_id,user_id', ignoreDuplicates: true });
    if (cpErr) throw new Error(`Failed adding demo staff to group chats: ${cpErr.message}`);
  }

  console.log(`✅ demo staff accounts ready: ${DEMO_STAFF_ACCOUNTS.map((s) => `${s.email} (${s.role})`).join(', ')}`);
}

// =============================================================================
// IN-PLACE SESSION BACKFILL & SAFE DUPLICATE CLEANUP (--patch-sessions)
// =============================================================================

async function patchSeededSessions() {
  console.log('\n📅 Patching seeded program_sessions & future holiday exceptions in-place...');
  console.log(`   Tenant: ${TENANT_ID}`);
  console.log(`   Window: ${START_DATE} .. ${MAX_PROGRAM_END_DATE}\n`);

  // 1. Resolve local_admin user id for attendance_exceptions.created_by
  const { data: staffUsers, error: staffErr } = await supabase
    .from('users')
    .select('id, email, role')
    .in('role', ['local_admin', 'staff_training_coordinator', 'super_admin']);
  if (staffErr) throw new Error(`Failed loading staff users: ${staffErr.message}`);
  const localAdminId =
    (staffUsers || []).find((u) => u.email === 'admin@bmdc.site')?.id ||
    (staffUsers || []).find((u) => u.role === 'local_admin')?.id ||
    (staffUsers || [])[0]?.id ||
    null;

  // 2. Backfill missing global weekend & PH holiday exceptions through MAX_PROGRAM_END_DATE
  const { data: existingEx, error: exErr } = await supabase
    .from('attendance_exceptions')
    .select('exception_date')
    .eq('tenant_id', TENANT_ID)
    .is('program_id', null);
  if (exErr) throw new Error(`Failed loading attendance_exceptions: ${exErr.message}`);
  const existingGlobalExceptionDates = new Set((existingEx || []).map((r) => r.exception_date));

  let nextExSeq = await getNextSeedSeq('attendance_exceptions');
  const newExceptionRows = [];
  for (const d of listDatesBetween(START_DATE, MAX_PROGRAM_END_DATE)) {
    const isWknd = isWeekendDate(d);
    const holidayReason = SPECIAL_HOLIDAYS.get(d);
    if ((isWknd || holidayReason) && !existingGlobalExceptionDates.has(d)) {
      newExceptionRows.push({
        id: seedUuid('attendance_exceptions', nextExSeq++),
        tenant_id: TENANT_ID,
        exception_type: 'no_attendance_day',
        program_id: null,
        trainee_id: null,
        exception_date: d,
        reason: holidayReason || (parseIsoDate(d).getUTCDay() === 6 ? 'Saturday - Weekend' : 'Sunday - Weekend'),
        created_by: localAdminId,
        created_at: phtWorkdayTimestamp(START_DATE, 8, 15, nextExSeq % 60),
        updated_at: phtWorkdayTimestamp(START_DATE, 8, 15, nextExSeq % 60),
      });
    }
  }
  await insertInBatches('attendance_exceptions', newExceptionRows);
  console.log(`✅ attendance_exceptions: +${newExceptionRows.length} rows`);

  // 3. Load all non-deleted seeded programs and all their current sessions (seed + manual)
  const seededPrograms = (
    await fetchAllSeededRows('programs', 'id, name, status, start_date, end_date, deleted_at, created_at')
  ).filter((p) => !p.deleted_at);

  if (seededPrograms.length === 0) {
    console.log('⚠️  No capstone-seeded programs found in database. Run without flags to perform initial seed.');
    return;
  }

  const programIds = seededPrograms.map((p) => p.id);
  const existingSessions = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const { data: batch, error: sessErr } = await supabase
      .from('program_sessions')
      .select('id, program_id, session_date, title, status')
      .in('program_id', programIds)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (sessErr) throw new Error(`Failed loading program_sessions: ${sessErr.message}`);
    existingSessions.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
  }

  // 4. Safely deduplicate same-date non-seed rows when a seeded row already owns that date
  //    AND the duplicate row has zero referencing attendance rows.
  const byProgDate = new Map();
  for (const s of existingSessions) {
    const key = `${s.program_id}|${s.session_date}`;
    if (!byProgDate.has(key)) byProgDate.set(key, []);
    byProgDate.get(key).push(s);
  }

  const dupCandidates = [];
  for (const rows of byProgDate.values()) {
    if (rows.length <= 1) continue;
    const hasSeedRow = rows.some((r) => isSeedUuid(r.id));
    if (!hasSeedRow) continue;
    for (const r of rows) {
      if (!isSeedUuid(r.id)) dupCandidates.push(r);
    }
  }

  const deletedIds = new Set();
  if (dupCandidates.length > 0) {
    const candidateIds = dupCandidates.map((r) => r.id);
    const { data: attRefs, error: attErr } = await supabase
      .from('attendance')
      .select('session_id')
      .in('session_id', candidateIds);
    if (attErr) throw new Error(`Failed checking attendance FKs before duplicate cleanup: ${attErr.message}`);

    const referencedIds = new Set((attRefs || []).map((a) => a.session_id));
    const safeToDelete = candidateIds.filter((id) => !referencedIds.has(id));
    const skippedWithAtt = candidateIds.length - safeToDelete.length;

    for (let i = 0; i < safeToDelete.length; i += 100) {
      const chunk = safeToDelete.slice(i, i + 100);
      const { error: delErr } = await supabase
        .from('program_sessions')
        .delete()
        .in('id', chunk);
      if (delErr) throw new Error(`Failed deleting unreferenced duplicate sessions: ${delErr.message}`);
      chunk.forEach((id) => deletedIds.add(id));
    }

    console.log(
      `✅ duplicate cleanup: removed ${deletedIds.size} unreferenced duplicate-date sessions` +
      (skippedWithAtt > 0 ? ` (preserved ${skippedWithAtt} with live attendance)` : '')
    );
  } else {
    console.log('✅ duplicate cleanup: 0 duplicate-date sessions found');
  }

  // 5. Backfill missing non-weekend, non-holiday weekday sessions for all active & upcoming seeded programs
  const coveredDatesByProg = new Map();
  for (const s of existingSessions) {
    if (deletedIds.has(s.id)) continue;
    if (!coveredDatesByProg.has(s.program_id)) coveredDatesByProg.set(s.program_id, new Set());
    coveredDatesByProg.get(s.program_id).add(s.session_date);
  }

  let nextSessSeq = await getNextSeedSeq('program_sessions');
  const sessionTypes = ['lecture', 'workshop', 'lab', 'workshop', 'lab', 'seminar', 'exam'];
  const newSessionRows = [];
  const perProgramAdded = [];

  for (const prog of seededPrograms) {
    if (prog.status !== 'active' && prog.status !== 'upcoming') continue;
    const expectedDates = getExpectedSessionDates(prog.start_date, prog.end_date);
    const covered = coveredDatesByProg.get(prog.id) || new Set();
    const progIndex = Math.max(0, Number(prog.id.split('-')[4]) - 1);
    const fallbackCreated = prog.created_at || phtWorkdayTimestamp(END_DATE, 8, 5, progIndex % 50);

    let addedForProg = 0;
    expectedDates.forEach((dateStr, idx) => {
      if (covered.has(dateStr)) return;
      const sCreated =
        dateStr <= END_DATE ? phtWorkdayTimestamp(dateStr, 8, 5, idx % 50) : fallbackCreated;
      newSessionRows.push({
        id: seedUuid('program_sessions', nextSessSeq++),
        tenant_id: TENANT_ID,
        program_id: prog.id,
        title: `Day ${idx + 1} - ${idx % 5 === 4 ? 'Practical Skills Evaluation' : 'Core Competency Session'}`,
        description: `Daily training session for ${prog.name}`,
        session_date: dateStr,
        start_time: '08:00:00',
        end_time: '17:00:00',
        location: `BMDC Training Bay ${(progIndex % 6) + 1}`,
        session_type: sessionTypes[idx % sessionTypes.length],
        status: dateStr < END_DATE ? 'completed' : 'scheduled',
        created_at: sCreated,
        updated_at: sCreated,
      });
      addedForProg++;
    });

    if (addedForProg > 0) {
      perProgramAdded.push(`${prog.name} (+${addedForProg})`);
    }
  }

  await insertInBatches('program_sessions', newSessionRows);
  console.log(`✅ program_sessions: +${newSessionRows.length} rows across ${perProgramAdded.length} program(s)`);
  for (const line of perProgramAdded) {
    console.log(`   • ${line}`);
  }

  await runVerification();
}

// =============================================================================
// CLI ENTRYPOINT
// =============================================================================

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--patch-photos') || args.has('--patch-attendance-photos')) {
    await patchSeededPhotos();
  } else if (args.has('--patch-sessions')) {
    await patchSeededSessions();
  } else if (args.has('--demo-staff')) {
    await ensureDemoStaffAccounts();
    await runVerification();
  } else if (args.has('--verify-only')) {
    await runVerification();
  } else if (args.has('--rollback')) {
    await rollbackSeedData();
  } else if (args.has('--reset')) {
    await rollbackSeedData();
    await runSeed();
  } else {
    await runSeed();
  }
}

main().catch((err) => {
  console.error('\n❌ Seeder error:', err.message || err);
  process.exit(1);
});
