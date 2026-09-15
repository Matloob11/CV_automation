import dotenv from 'dotenv';
dotenv.config();

const webhookUrl = process.env.BITRIX24_WEBHOOK_URL || '';
if (!webhookUrl) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
  process.exit(1);
}

async function inspectAllFields() {
  const fieldsRes = await fetch(webhookUrl + `crm.item.fields?entityTypeId=1156`);
  const fieldsData = await fieldsRes.json();
  console.log('=== ALL FIELDS FOR APPLICANT (entityTypeId: 1156) ===');
  console.log(JSON.stringify(fieldsData.result.fields, null, 2));
}

inspectAllFields().catch(console.error);
