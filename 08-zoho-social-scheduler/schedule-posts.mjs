import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = process.cwd();
const PAYLOAD_FILE = path.join(ROOT, 'Social', 'pin-api-payloads-20260928-tables.json');
const SCHEDULED_FILE = path.join(ROOT, 'Social', 'pin-api-scheduled-20260928-tables.json');
const TRACKER_FILE = path.join(ROOT, 'Social', 'pinterest-pin-tracker-master.csv');
const TOKEN_PATH = process.env.ZOHO_MCP_TOKEN_FILE; // OAuth token file written by the MCP client
const MCP_URL = new URL(process.env.ZOHO_SOCIAL_MCP_URL);
const BRAND_ID = process.env.ZOHO_SOCIAL_BRAND_ID;
const PORTAL_ID = process.env.ZOHO_SOCIAL_PORTAL_ID;
if (!TOKEN_PATH || !process.env.ZOHO_SOCIAL_MCP_URL || !BRAND_ID || !PORTAL_ID) throw new Error('Set ZOHO_MCP_TOKEN_FILE, ZOHO_SOCIAL_MCP_URL, ZOHO_SOCIAL_BRAND_ID and ZOHO_SOCIAL_PORTAL_ID');

const payloads = JSON.parse(fs.readFileSync(PAYLOAD_FILE, 'utf8'));
const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

console.log(`Loaded ${payloads.length} table & desk pin payloads.`);

function schedulePost(p) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'ZohoSocial_createSocialSchedule',
        arguments: {
          headers: { brand_id: BRAND_ID, portal_id: PORTAL_ID },
          body: {
            post: {
              type: 1,
              schedule_time: p.epoch,
              messages: [
                {
                  channels: [
                    {
                      network: 'pinterest',
                      board_id: p.board_id,
                      brand_id: BRAND_ID
                    }
                  ],
                  has_media: 'image',
                  message: p.message + ' ' + p.link,
                  medias: [
                    {
                      file_path: p.img,
                      format: 'jpg',
                      name: path.basename(p.img.split('?')[0]),
                      size: 250000,
                      width: 1000,
                      height: 1500,
                      type: 'image'
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    });

    const req = https.request(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens.access_token}`,
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.result && !parsed.result.isError) {
            const inner = JSON.parse(parsed.result.content[0].text);
            const postId = inner.data?.[0]?.post_id;
            resolve({ success: true, postId });
          } else {
            resolve({ success: false, err: parsed });
          }
        } catch (e) {
          resolve({ success: false, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function run() {
  const scheduledRecords = [];
  console.log(`Starting scheduling of ${payloads.length} tables & desks pins into Zoho Social...`);

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    process.stdout.write(`[${i + 1}/${payloads.length}] Scheduling ${p.name} on ${p.board_name} (${p.time_str})... `);
    try {
      const res = await schedulePost(p);
      if (res.success) {
        console.log(`OK: post_id ${res.postId}`);
        scheduledRecords.push({
          post_id: res.postId,
          slug: p.slug,
          name: p.name,
          time_str: p.time_str,
          date: p.date,
          board_name: p.board_name,
          board_id: p.board_id,
          pin: path.basename(p.img.split('?')[0]),
          link: p.link,
          img: p.img,
          message: p.message
        });
      } else {
        console.log(`FAIL:`, JSON.stringify(res.err || res.raw));
      }
    } catch (e) {
      console.log(`ERR:`, e.message);
    }
    // 500ms pause between calls to respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nSuccessfully scheduled ${scheduledRecords.length}/${payloads.length} pins.`);

  // Save scheduled record
  fs.writeFileSync(
    SCHEDULED_FILE,
    JSON.stringify({
      scheduled_on: '2026-09-17',
      batch: 'homary-tables-desks-product-pins-20260928',
      note: '15 clean product-first hero pins for Homary tables & desks scheduled via Zoho Social direct API.',
      pins: scheduledRecords
    }, null, 2),
    'utf8'
  );
  console.log(`Saved scheduled record to ${SCHEDULED_FILE}`);

  // Append to master tracker
  if (scheduledRecords.length > 0) {
    // Convert MM/DD/YYYY to YYYY-MM-DD for ISO standard in tracker
    const newRows = scheduledRecords.map(r => {
      const parts = r.date.split('/');
      const isoDate = `${parts[2]}-${parts[0]}-${parts[1]}`;
      const pinTitle = `"${r.name.replace(/"/g, '""')}"`;
      const board = `"${r.board_name}"`;
      const pinFile = r.pin;
      const url = r.link;
      const postId = r.post_id || '';
      const status = 'scheduled';
      const notes = '"Homary tables & desks product-first hero pin via Zoho Social API"';
      return `${isoDate},${board},${pinTitle},${pinFile},${url},${postId},${status},${notes}`;
    });

    fs.appendFileSync(TRACKER_FILE, '\n' + newRows.join('\n') + '\n', 'utf8');
    console.log(`Appended ${newRows.length} rows to ${TRACKER_FILE}`);
  }

  // Also write bulk CSV files for the batch folder
  const BATCH_DIR = path.join(ROOT, 'Social', 'Zoho Batches', 'September 2026');
  if (!fs.existsSync(BATCH_DIR)) fs.mkdirSync(BATCH_DIR, { recursive: true });

  const byBoard = {};
  for (const r of scheduledRecords) {
    (byBoard[r.board_name] ||= []).push(r);
  }

  for (const [boardName, rows] of Object.entries(byBoard)) {
    const slugBoard = boardName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const csvPath = path.join(BATCH_DIR, `zoho-pinterest-${slugBoard}-20260928.csv`);
    const csvContent = [
      'Date,Time,Message,Link,Image URL',
      ...rows.map(r => {
        const [d, t] = r.time_str.split(' ');
        const msg = `"${r.message.replace(/"/g, '""')}"`;
        return `${d},${t},${msg},${r.link},${r.img}`;
      })
    ].join('\n');
    fs.writeFileSync(csvPath, csvContent, 'utf8');
    console.log(`Saved board CSV -> ${csvPath}`);
  }
}

run().catch(console.error);
