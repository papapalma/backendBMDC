#!/usr/bin/env node

/**
 * Sync trainee emails with linked trainee user accounts.
 *
 * What this script does:
 * 1) Normalizes trainee emails to lowercase.
 * 2) Ensures every trainee has a trainee_accounts link.
 * 3) Syncs linked users.email to trainees.email.
 * 4) Creates missing trainee users (with temp passwords) when no user exists.
 *
 * Usage:
 *   node scripts/sync-trainee-email-links.js
 *   node scripts/sync-trainee-email-links.js --dry-run
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');

const isDryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const randomChunk = () => Math.random().toString(36).slice(2, 7).toUpperCase();
const tempPassword = () => `BMDC-${randomChunk()}-${randomChunk()}`;

const sanitizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function maybeSingle(query) {
  const { data, error } = await query.maybeSingle();
  if (error && error.code !== 'PGRST116') {
    throw error;
  }
  return data || null;
}

async function generateUniqueUsername(firstName, lastName) {
  const baseRaw = `${sanitizeName(firstName)}${sanitizeName(lastName)}`;
  const base = baseRaw || 'trainee';

  for (let i = 0; i < 50; i++) {
    const candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await maybeSingle(
      supabase.from('users').select('id').eq('username', candidate)
    );

    if (!exists) {
      return candidate;
    }
  }

  return `${base}${Date.now().toString().slice(-6)}`;
}

async function getLinkByTraineeId(traineeId) {
  return maybeSingle(
    supabase
      .from('trainee_accounts')
      .select('id, trainee_id, user_id')
      .eq('trainee_id', traineeId)
  );
}

async function getLinkByUserId(userId) {
  return maybeSingle(
    supabase
      .from('trainee_accounts')
      .select('id, trainee_id, user_id')
      .eq('user_id', userId)
  );
}

async function updateTraineeEmail(traineeId, email) {
  if (isDryRun) return;

  const { error } = await supabase
    .from('trainees')
    .update({ email })
    .eq('id', traineeId);

  if (error) throw error;
}

async function updateUserEmail(userId, email) {
  if (isDryRun) return;

  const { error } = await supabase
    .from('users')
    .update({ email })
    .eq('id', userId);

  if (error) throw error;
}

async function createLink(traineeId, userId) {
  if (isDryRun) return;

  const { error } = await supabase
    .from('trainee_accounts')
    .insert({ trainee_id: traineeId, user_id: userId });

  if (error) throw error;
}

async function createTraineeUser(trainee, email) {
  const username = await generateUniqueUsername(trainee.first_name, trainee.last_name);
  const plainPassword = tempPassword();
  const password_hash = await hashPassword(plainPassword);

  if (isDryRun) {
    return {
      id: '(dry-run)',
      email,
      username,
      plainPassword,
    };
  }

  const { data, error } = await supabase
    .from('users')
    .insert({
      email,
      username,
      password_hash,
      role: 'trainee',
    })
    .select('id, email, username')
    .single();

  if (error) throw error;

  return {
    ...data,
    plainPassword,
  };
}

async function run() {
  console.log(`Starting trainee email/account sync ${isDryRun ? '(DRY RUN)' : ''}...`);

  const { data: trainees, error } = await supabase
    .from('trainees')
    .select('id, first_name, last_name, email')
    .order('created_at', { ascending: true });

  if (error) throw error;

  const summary = {
    total: trainees.length,
    traineeEmailsNormalized: 0,
    linksCreated: 0,
    userEmailsSynced: 0,
    usersCreated: 0,
    skippedNoEmail: 0,
    conflicts: 0,
    errors: 0,
  };

  const createdCredentials = [];
  const conflictRows = [];
  const errorRows = [];

  for (const trainee of trainees) {
    try {
      const traineeId = trainee.id;
      const normalizedEmail = normalizeEmail(trainee.email);

      if (!normalizedEmail) {
        summary.skippedNoEmail += 1;
        continue;
      }

      if (normalizedEmail !== trainee.email) {
        await updateTraineeEmail(traineeId, normalizedEmail);
        summary.traineeEmailsNormalized += 1;
      }

      let link = await getLinkByTraineeId(traineeId);

      if (!link) {
        const existingUser = await maybeSingle(
          supabase
            .from('users')
            .select('id, email, role')
            .eq('email', normalizedEmail)
        );

        if (existingUser) {
          if (existingUser.role !== 'trainee') {
            summary.conflicts += 1;
            conflictRows.push({
              traineeId,
              email: normalizedEmail,
              reason: `Email is already used by non-trainee role: ${existingUser.role}`,
            });
            continue;
          }

          const existingUserLink = await getLinkByUserId(existingUser.id);
          if (existingUserLink && existingUserLink.trainee_id !== traineeId) {
            summary.conflicts += 1;
            conflictRows.push({
              traineeId,
              email: normalizedEmail,
              reason: `User already linked to another trainee: ${existingUserLink.trainee_id}`,
            });
            continue;
          }

          await createLink(traineeId, existingUser.id);
          summary.linksCreated += 1;
          link = { user_id: existingUser.id };
        } else {
          const createdUser = await createTraineeUser(trainee, normalizedEmail);
          summary.usersCreated += 1;

          await createLink(traineeId, createdUser.id);
          summary.linksCreated += 1;
          link = { user_id: createdUser.id };

          createdCredentials.push({
            traineeId,
            email: normalizedEmail,
            username: createdUser.username,
            tempPassword: createdUser.plainPassword,
          });
        }
      }

      const linkedUser = await maybeSingle(
        supabase
          .from('users')
          .select('id, email, role')
          .eq('id', link.user_id)
      );

      if (!linkedUser) {
        summary.errors += 1;
        errorRows.push({
          traineeId,
          email: normalizedEmail,
          reason: `Linked user not found: ${link.user_id}`,
        });
        continue;
      }

      if (linkedUser.role !== 'trainee') {
        summary.conflicts += 1;
        conflictRows.push({
          traineeId,
          email: normalizedEmail,
          reason: `Linked user has non-trainee role: ${linkedUser.role}`,
        });
        continue;
      }

      const normalizedUserEmail = normalizeEmail(linkedUser.email);
      if (normalizedUserEmail !== normalizedEmail) {
        const conflictUser = await maybeSingle(
          supabase
            .from('users')
            .select('id')
            .eq('email', normalizedEmail)
            .neq('id', linkedUser.id)
        );

        if (conflictUser) {
          summary.conflicts += 1;
          conflictRows.push({
            traineeId,
            email: normalizedEmail,
            reason: 'Cannot sync user email because another user already has this email',
          });
          continue;
        }

        await updateUserEmail(linkedUser.id, normalizedEmail);
        summary.userEmailsSynced += 1;
      }
    } catch (e) {
      summary.errors += 1;
      errorRows.push({
        traineeId: trainee.id,
        email: trainee.email,
        reason: e?.message || String(e),
      });
    }
  }

  console.log('\nSync summary:');
  console.log(`- Total trainees scanned: ${summary.total}`);
  console.log(`- Trainee emails normalized: ${summary.traineeEmailsNormalized}`);
  console.log(`- Missing links created: ${summary.linksCreated}`);
  console.log(`- Linked user emails synced: ${summary.userEmailsSynced}`);
  console.log(`- New trainee users created: ${summary.usersCreated}`);
  console.log(`- Skipped (no email): ${summary.skippedNoEmail}`);
  console.log(`- Conflicts: ${summary.conflicts}`);
  console.log(`- Errors: ${summary.errors}`);

  if (createdCredentials.length > 0) {
    console.log('\nCreated trainee accounts (store these temporary passwords securely):');
    createdCredentials.forEach((row) => {
      console.log(`- trainee_id=${row.traineeId} email=${row.email} username=${row.username} temp_password=${row.tempPassword}`);
    });
  }

  if (conflictRows.length > 0) {
    console.log('\nConflicts that need manual review:');
    conflictRows.forEach((row) => {
      console.log(`- trainee_id=${row.traineeId} email=${row.email} reason=${row.reason}`);
    });
  }

  if (errorRows.length > 0) {
    console.log('\nErrors:');
    errorRows.forEach((row) => {
      console.log(`- trainee_id=${row.traineeId} email=${row.email} reason=${row.reason}`);
    });
  }

  console.log(`\nDone ${isDryRun ? '(dry run only, no data changed).' : '(changes applied).'}`);
}

run().catch((err) => {
  console.error('Sync failed:', err.message || err);
  process.exit(1);
});
