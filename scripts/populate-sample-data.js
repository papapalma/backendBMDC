#!/usr/bin/env node

/**
 * Script to populate the database with sample operational data
 * This creates programs, trainees, items, and lendings for testing the Reports page
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.log('❌ Missing required environment variables!');
  console.log('Make sure you have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Sample data templates
const SAMPLE_PROGRAMS = [
  {
    name: 'Computer Literacy Training',
    description: 'Basic computer skills and digital literacy program',
    status: 'active',
    max_trainees: 25,
    duration_weeks: 8,
    start_date: '2024-01-15',
    end_date: '2024-03-15',
    type_of_funding: 'Government'
  },
  {
    name: 'Automotive Repair and Maintenance',
    description: 'Hands-on automotive repair and maintenance training',
    status: 'active',
    max_trainees: 20,
    duration_weeks: 12,
    start_date: '2024-02-01',
    end_date: '2024-05-01',
    type_of_funding: 'Private'
  },
  {
    name: 'Cosmetology and Beauty Care',
    description: 'Professional cosmetology and beauty care training',
    status: 'active',
    max_trainees: 18,
    duration_weeks: 10,
    start_date: '2024-01-20',
    end_date: '2024-04-20',
    type_of_funding: 'Government'
  },
  {
    name: 'Culinary Arts',
    description: 'Professional cooking and food preparation training',
    status: 'completed',
    max_trainees: 15,
    duration_weeks: 6,
    start_date: '2023-10-01',
    end_date: '2023-12-15',
    type_of_funding: 'Government'
  },
  {
    name: 'Electronics Repair',
    description: 'Electronics troubleshooting and repair training',
    status: 'upcoming',
    max_trainees: 12,
    duration_weeks: 8,
    start_date: '2024-06-01',
    end_date: '2024-08-01',
    type_of_funding: 'Private'
  }
];

const SAMPLE_ITEMS = [
  { name: 'Desktop Computer', category: 'Electronics', quantity: 15, available_quantity: 12, status: 'available' },
  { name: 'Laptop Computer', category: 'Electronics', quantity: 8, available_quantity: 6, status: 'available' },
  { name: 'Projector', category: 'Electronics', quantity: 3, available_quantity: 2, status: 'available' },
  { name: 'Toolkit - Automotive', category: 'Tools', quantity: 20, available_quantity: 18, status: 'available' },
  { name: 'Multimeter', category: 'Electronics', quantity: 10, available_quantity: 8, status: 'available' },
  { name: 'Hair Dryer Professional', category: 'Equipment', quantity: 12, available_quantity: 10, status: 'available' },
  { name: 'Styling Tools Set', category: 'Equipment', quantity: 15, available_quantity: 12, status: 'available' },
  { name: 'Kitchen Knife Set', category: 'Tools', quantity: 8, available_quantity: 5, status: 'available' },
  { name: 'Cutting Board Set', category: 'Equipment', quantity: 20, available_quantity: 15, status: 'available' },
  { name: 'Soldering Iron', category: 'Tools', quantity: 6, available_quantity: 4, status: 'available' },
  { name: 'Cable Tester', category: 'Electronics', quantity: 5, available_quantity: 3, status: 'available' },
  { name: 'Furniture - Desk', category: 'Furniture', quantity: 25, available_quantity: 20, status: 'available' }
];

const SAMPLE_TRAINEE_NAMES = [
  'Juan Dela Cruz', 'Maria Santos', 'Jose Rizal', 'Ana Garcia', 'Pedro Martinez',
  'Carmen Rodriguez', 'Roberto Gonzalez', 'Elena Fernandez', 'Carlos Morales', 'Sofia Jimenez',
  'Miguel Torres', 'Isabella Ruiz', 'Francisco Ramos', 'Lucia Herrera', 'Antonio Vargas',
  'Valentina Castro', 'Diego Ortega', 'Camila Mendoza', 'Alejandro Silva', 'Natalia Rojas'
];

async function populateDatabase() {
  console.log('🌱 Starting to populate database with sample data...\n');

  try {
    // Get the first tenant (BMDC) to use for sample data
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id, name')
      .limit(1);

    if (tenantError || !tenants || tenants.length === 0) {
      console.log('❌ No tenants found. Please run tenant seeding first.');
      process.exit(1);
    }

    const tenantId = tenants[0].id;
    console.log(`✓ Using tenant: ${tenants[0].name} (${tenantId})\n`);

    // 1. Create Programs
    console.log('📚 Creating sample programs...');
    const createdPrograms = [];
    for (const program of SAMPLE_PROGRAMS) {
      const { data, error } = await supabase
        .from('programs')
        .insert({
          ...program,
          tenant_id: tenantId
        })
        .select()
        .single();

      if (error) {
        console.log(`  ⚠️  Failed to create program "${program.name}": ${error.message}`);
      } else {
        console.log(`  ✓ Created: ${program.name}`);
        createdPrograms.push(data);
      }
    }
    console.log(`✅ Created ${createdPrograms.length} programs\n`);

    // 2. Create Trainees
    console.log('👥 Creating sample trainees...');
    const createdTrainees = [];
    for (let i = 0; i < SAMPLE_TRAINEE_NAMES.length; i++) {
      const name = SAMPLE_TRAINEE_NAMES[i];
      const nameParts = name.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ');
      
      const { data, error } = await supabase
        .from('trainees')
        .insert({
          first_name: firstName,
          last_name: lastName,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(' ', '')}@example.com`,
          phone: `+639${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`,
          status: Math.random() > 0.3 ? 'active' : (Math.random() > 0.5 ? 'completed' : 'inactive'),
          tenant_id: tenantId
        })
        .select()
        .single();

      if (error) {
        console.log(`  ⚠️  Failed to create trainee "${name}": ${error.message}`);
      } else {
        console.log(`  ✓ Created: ${name}`);
        createdTrainees.push(data);
      }
    }
    console.log(`✅ Created ${createdTrainees.length} trainees\n`);

    // 3. Create Enrollments
    console.log('📝 Creating enrollments...');
    const createdEnrollments = [];
    for (const trainee of createdTrainees) {
      // Randomly enroll each trainee in 1-3 programs
      const numPrograms = Math.floor(Math.random() * 3) + 1;
      const availablePrograms = [...createdPrograms];
      
      for (let i = 0; i < Math.min(numPrograms, availablePrograms.length); i++) {
        const programIndex = Math.floor(Math.random() * availablePrograms.length);
        const program = availablePrograms.splice(programIndex, 1)[0];
        
        const enrollmentDate = new Date();
        enrollmentDate.setDate(enrollmentDate.getDate() - Math.floor(Math.random() * 60));
        
        const { data, error } = await supabase
          .from('enrollments')
          .insert({
            trainee_id: trainee.id,
            program_id: program.id,
            enrollment_date: enrollmentDate.toISOString().split('T')[0],
            status: Math.random() > 0.2 ? 'active' : 'completed',
            tenant_id: tenantId
          })
          .select()
          .single();

        if (!error) {
          createdEnrollments.push(data);
        }
      }
    }
    console.log(`✅ Created ${createdEnrollments.length} enrollments\n`);

    // 4. Create Items
    console.log('📦 Creating sample items...');
    const createdItems = [];
    for (const item of SAMPLE_ITEMS) {
      const { data, error } = await supabase
        .from('items')
        .insert({
          ...item,
          tenant_id: tenantId
        })
        .select()
        .single();

      if (error) {
        console.log(`  ⚠️  Failed to create item "${item.name}": ${error.message}`);
      } else {
        console.log(`  ✓ Created: ${item.name}`);
        createdItems.push(data);
      }
    }
    console.log(`✅ Created ${createdItems.length} items\n`);

    // 5. Create Lendings
    console.log('📋 Creating sample lendings...');
    const createdLendings = [];
    for (let i = 0; i < 20; i++) {
      const trainee = createdTrainees[Math.floor(Math.random() * createdTrainees.length)];
      const item = createdItems[Math.floor(Math.random() * createdItems.length)];
      
      const borrowDate = new Date();
      borrowDate.setDate(borrowDate.getDate() - Math.floor(Math.random() * 30));
      
      const expectedReturn = new Date(borrowDate);
      expectedReturn.setDate(expectedReturn.getDate() + 7 + Math.floor(Math.random() * 14));
      
      const isReturned = Math.random() > 0.3;
      const actualReturn = isReturned ? new Date(expectedReturn.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000) : null;
      
      const { data, error } = await supabase
        .from('lendings')
        .insert({
          trainee_id: trainee.id,
          item_id: item.id,
          quantity: 1,
          borrowed_date: borrowDate.toISOString().split('T')[0],
          expected_return_date: expectedReturn.toISOString().split('T')[0],
          actual_return_date: actualReturn ? actualReturn.toISOString().split('T')[0] : null,
          status: actualReturn ? 'returned' : (expectedReturn < new Date() ? 'overdue' : 'active'),
          tenant_id: tenantId
        })
        .select()
        .single();

      if (!error) {
        createdLendings.push(data);
      }
    }
    console.log(`✅ Created ${createdLendings.length} lendings\n`);

    // Summary
    console.log('📊 Population Summary:');
    console.log(`  ✅ Programs: ${createdPrograms.length}`);
    console.log(`  ✅ Trainees: ${createdTrainees.length}`);
    console.log(`  ✅ Enrollments: ${createdEnrollments.length}`);
    console.log(`  ✅ Items: ${createdItems.length}`);
    console.log(`  ✅ Lendings: ${createdLendings.length}\n`);

    console.log('🎉 Sample data population completed successfully!');
    console.log('   The Reports page should now show real data instead of "No data available".\n');

  } catch (error) {
    console.error('❌ Error during population:', error);
    process.exit(1);
  }
}

// Run the population
populateDatabase();