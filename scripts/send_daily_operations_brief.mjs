/** Fixed-recipient report sender. No caller-supplied recipients, CC, BCC or attachments. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const ROOT=path.resolve(import.meta.dirname,'..');
const [date,audience,...opts]=process.argv.slice(2);
if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!['owner','management'].includes(audience)||opts.some(o=>!['--validate-only','--high-priority','--corrected'].includes(o)))throw Error('Usage: send_daily_operations_brief.mjs YYYY-MM-DD owner|management [--validate-only] [--high-priority] [--corrected]');
const policy=JSON.parse(await fs.readFile(path.join(ROOT,'data/email_inbox/config/report-audiences.json'),'utf8'))[audience];
// Recipient ceilings are hardcoded as well as configured: owner material cannot be sent to management by changing a CLI argument.
const recipient=audience==='owner'?'jason@jeclogs.com':'management@jeclogs.com';
const expected=audience==='owner'?['jeclogisticssolutions@gmail.com','jason@jeclogs.com','management@jeclogs.com']:['management@jeclogs.com'];
if(policy.recipient!==recipient||JSON.stringify([...policy.accounts].sort())!==JSON.stringify([...expected].sort()))throw Error('Recipient/source policy mismatch');
const base=path.join(ROOT,'data/email_inbox',audience,date);const directory=await fs.realpath(base);
if(directory!==base)throw Error('Report directory must not be a symlink');
const htmlPath=path.join(base,'report.html');if(await fs.realpath(htmlPath)!==htmlPath)throw Error('Report must not be a symlink');
const status=JSON.parse(await fs.readFile(path.join(base,'status.json'),'utf8'));
if(status.audience!==audience||status.reportDate!==date||!Array.isArray(status.sources)||JSON.stringify(status.sources.map(s=>s.account).sort())!==JSON.stringify([...expected].sort()))throw Error('Report source manifest violates audience boundary');
const content=await fs.readFile(htmlPath,'utf8');if(!content.trim())throw Error('Empty report');
const subject=(opts.includes('--corrected')?'CORRECTED — ':'')+(opts.includes('--high-priority')?'HIGH PRIORITY — ':'')+`Daily Operations Brief — ${policy.label} — ${date}`;
if(opts.includes('--validate-only')){console.log(JSON.stringify({validated:true,audience,date,to:recipient,cc:[],bcc:[],subject,htmlPath}));process.exit(0);}
const corrected=opts.includes('--corrected');
const sentFile=path.join(base,corrected?'corrected-sent.json':'sent.json');try{await fs.access(sentFile);console.log(JSON.stringify({alreadySent:true,audience,date,corrected}));process.exit(0);}catch{}
const lock=path.join(base,corrected?'corrected-delivery.lock':'delivery.lock');let handle;try{handle=await fs.open(lock,'wx',0o600);}catch{throw Error('Delivery locked: inspect sent mail before retrying; possible prior unknown result');}
await handle.writeFile(JSON.stringify({audience,date,startedAt:new Date().toISOString(),recipient}));await handle.close();
try{
 // Scheduled Gmail OAuth refresh has repeatedly failed in the detached cron
 // environment. Use the company mailbox's Keychain-backed SMTP connection so
 // delivery does not depend on an interactive Google consent token.
 const {stdout}=await run('python3',[path.join(ROOT,'scripts/send_privateemail_smtp.py'),'--to',recipient,'--subject',subject,'--html-file',htmlPath],{timeout:90000,maxBuffer:1024*1024});
 const receipt=JSON.parse(stdout);const id=receipt.messageId||receipt.id||receipt.message?.id;
 if(!id)throw Error('Missing delivery message ID');
 await fs.writeFile(sentFile,JSON.stringify({audience,date,recipient,subject,messageId:id,provider:receipt.provider||'unknown',sender:receipt.sender||'unknown',sentAt:new Date().toISOString()},null,2),{mode:0o600});await fs.unlink(lock);
 console.log(JSON.stringify({sent:true,audience,to:recipient,messageId:id,provider:receipt.provider||'unknown'}));
}catch(error){
 const detail=error?.stderr?.trim()||error?.stdout?.trim()||error?.message||String(error);
 throw Error(`Delivery failed or unknown. Lock retained: inspect sent mail before another send. Cause: ${detail}`);
}
