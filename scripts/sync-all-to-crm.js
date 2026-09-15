import fsp from 'node:fs/promises';
import path from 'node:path';

import { createBitrixAgent } from '../src/agents/bitrix-agent.js';
import { createHistoryAgent } from '../src/agents/history-agent.js';
import { config } from '../src/config.js';

const historyAgent = createHistoryAgent({ config });
const bitrixAgent = createBitrixAgent({ config });

async function syncAllToCrm() {
  console.log('=== CV Auto -> Bitrix24 CRM Bulk Sync ===');

  if (!bitrixAgent.isConfigured()) {
    console.error('Error: BITRIX24_WEBHOOK_URL is not set in .env.');
    process.exit(1);
  }

  const connection = await bitrixAgent.testConnection();
  if (!connection.ok) {
    console.error('Error connecting to Bitrix24 CRM:', connection.error);
    process.exit(1);
  }
  console.log(`Connected to Bitrix24 CRM as User: ${connection.user.NAME} ${connection.user.LAST_NAME} (ID: ${connection.user.ID})`);

  let directories = [];
  try {
    directories = (await fsp.readdir(config.batchesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    console.error('Could not read batches directory:', err.message);
    process.exit(1);
  }

  console.log(`Found ${directories.length} total batches in storage.`);

  let totalCandidates = 0;
  let syncedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const targetStageId = process.argv[2] || 'DT1156_44:NEW';
  console.log(`Target CRM Stage ID: ${targetStageId}`);

  for (let bIndex = 0; bIndex < directories.length; bIndex += 1) {
    const batchId = directories[bIndex];
    const resultsPath = path.join(config.batchesRoot, batchId, 'results.json');

    let snapshot;
    try {
      snapshot = JSON.parse(await fsp.readFile(resultsPath, 'utf8'));
    } catch {
      continue;
    }

    if (!snapshot || !Array.isArray(snapshot.rows)) continue;

    let snapshotModified = false;

    for (let rIndex = 0; rIndex < snapshot.rows.length; rIndex += 1) {
      const row = snapshot.rows[rIndex];
      if (!row || row.status !== 'ok') continue;

      totalCandidates += 1;

      if (row.crmSynced && row.crmId) {
        skippedCount += 1;
        continue;
      }

      // Resolve source file path
      const storedFiles = Array.isArray(row.storedFiles) && row.storedFiles.length ? row.storedFiles : [row.storedFile];
      let filePath = null;
      let fileName = row.sourceFile || storedFiles[0];

      for (const sf of storedFiles) {
        if (!sf) continue;
        const candidatePath = path.join(config.batchesRoot, batchId, 'originals', path.basename(sf));
        try {
          const stat = await fsp.stat(candidatePath);
          if (stat.isFile()) {
            filePath = candidatePath;
            break;
          }
        } catch {
          // Check next file
        }
      }

      console.log(`[${totalCandidates}] Syncing: ${row.name || 'Unknown'} (${row.appliedPost || row.designation || 'No Role'}) ...`);

      const pushResult = await bitrixAgent.pushCandidate(
        {
          ...row,
          batchId
        },
        {
          filePath,
          fileName,
          stageId: targetStageId
        }
      );

      if (pushResult.success) {
        row.crmSynced = true;
        row.crmId = pushResult.crmId;
        row.crmStageId = pushResult.stageId;
        snapshotModified = true;
        syncedCount += 1;
        console.log(`  └─ Success! Created Bitrix item ID #${pushResult.crmId} in Stage [${pushResult.stageId}]`);
      } else {
        failedCount += 1;
        console.error(`  └─ Failed: ${pushResult.error}`);
      }

      // Small delay between API calls to prevent rate limiting
      await new Promise((r) => setTimeout(r, 400));
    }

    if (snapshotModified) {
      try {
        await fsp.writeFile(resultsPath, JSON.stringify(snapshot, null, 2), 'utf8');
      } catch (writeErr) {
        console.error(`Could not update results snapshot for batch ${batchId}:`, writeErr.message);
      }
    }
  }

  console.log('\n=== Sync Completed ===');
  console.log(`Total Candidates Scanned: ${totalCandidates}`);
  console.log(`Newly Synced: ${syncedCount}`);
  console.log(`Already Synced (Skipped): ${skippedCount}`);
  console.log(`Failed: ${failedCount}`);
}

syncAllToCrm().catch((err) => {
  console.error('Fatal error during sync script:', err);
  process.exit(1);
});
