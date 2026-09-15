import dotenv from 'dotenv';
dotenv.config();

const webhookUrl = process.env.BITRIX24_WEBHOOK_URL || '';
if (!webhookUrl) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
  process.exit(1);
}

async function testBitrix() {
  console.log('Using configured BITRIX24_WEBHOOK_URL');

  // 1. Get CRM types (Smart Process Automations / SPAs)
  try {
    const res = await fetch(webhookUrl + 'crm.type.list');
    const data = await res.json();
    console.log('\n--- crm.type.list ---');
    if (data.result && data.result.types) {
      data.result.types.forEach(t => {
        console.log(`Type ID: ${t.id}, EntityTypeId: ${t.entityTypeId}, Title: ${t.title}`);
      });
    } else {
      console.log(JSON.stringify(data, null, 2));
    }

    // Find Applicant type or entityTypeId if available
    const types = data.result?.types || [];
    const applicantType = types.find(t => t.title.toLowerCase().includes('applicant') || t.title.toLowerCase().includes('hr') || t.title.toLowerCase().includes('recruitment')) || types[0];

    if (applicantType) {
      console.log(`\nChecking fields for EntityTypeId ${applicantType.entityTypeId} (${applicantType.title})...`);
      const fieldsRes = await fetch(webhookUrl + `crm.item.fields?entityTypeId=${applicantType.entityTypeId}`);
      const fieldsData = await fieldsRes.json();
      console.log('\n--- crm.item.fields ---');
      if (fieldsData.result && fieldsData.result.fields) {
        Object.entries(fieldsData.result.fields).forEach(([key, field]) => {
          console.log(`Field Key: ${key} | Title: ${field.title || field.upperName || key} | Type: ${field.type}`);
        });
      } else {
        console.log(JSON.stringify(fieldsData, null, 2));
      }
    }
  } catch (err) {
    console.error('Error querying Bitrix:', err);
  }
}

testBitrix();
