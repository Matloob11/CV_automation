import dotenv from 'dotenv';
dotenv.config();

const webhookUrl = process.env.BITRIX24_WEBHOOK_URL || '';
if (!webhookUrl) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
  process.exit(1);
}

async function testBatch() {
  const entityTypeId = 1156;
  const cmd = {};

  for (let i = 1; i <= 3; i++) {
    cmd[`test_${i}`] = `crm.item.add?` + new URLSearchParams({
      'fields[entityTypeId]': entityTypeId,
      'fields[title]': `BATCH TEST ${i}`,
      'fields[ufCrm32_1760525662256]': `Test${i}`,
      'fields[ufCrm32_1760525666320]': `Batch`
    }).toString();
  }

  const res = await fetch(webhookUrl + 'batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ halt: 0, cmd })
  });

  const data = await res.json();
  console.log('Batch Result:', JSON.stringify(data, null, 2));

  // Delete created test items
  if (data.result && data.result.result) {
    for (const [key, itemRes] of Object.entries(data.result.result)) {
      if (itemRes && itemRes.item && itemRes.item.id) {
        const delRes = await fetch(webhookUrl + 'crm.item.delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityTypeId, id: itemRes.item.id })
        });
        console.log(`Deleted test item ${itemRes.item.id}`);
      }
    }
  }
}

testBatch().catch(console.error);
