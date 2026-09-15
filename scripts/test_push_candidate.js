import dotenv from 'dotenv';
dotenv.config();

const webhookUrl = process.env.BITRIX24_WEBHOOK_URL || '';
if (!webhookUrl) {
  console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
  process.exit(1);
}

async function testPush() {
  const entityTypeId = 1156;
  const payload = {
    entityTypeId,
    fields: {
      title: 'TEST CANDIDATE - Real Estate Agent',
      ufCrm32_1760525662256: 'Test',
      ufCrm32_1760525666320: 'Candidate',
      ufCrm32_1760525672592: '+971500000000',
      ufCrm32_1760525678896: 'test.candidate@example.com',
      ufCrm32_1760525687473: 'Real Estate Agent',
      ufCrm32_1760525724346: '3 years',
      ufCrm32_1760525758: 'Nationality: UAE\nVisa Status: Employment\nNotice Period: Immediate'
    }
  };

  const res = await fetch(webhookUrl + 'crm.item.add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  console.log('Result:', JSON.stringify(data, null, 2));
}

testPush().catch(console.error);
