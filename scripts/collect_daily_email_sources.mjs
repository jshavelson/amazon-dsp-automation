/** Read-only prior-day inbox collection. No sends, flag updates, or credential export. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const ROOT=path.resolve(import.meta.dirname,'..');
const tz='America/New_York';
const allSources=[
 {account:'jeclogisticssolutions@gmail.com',kind:'gmail'},
 {account:'jason@jeclogs.com',kind:'privateemail',keychainService:'openclaw-jeclogs-imap-jason'},
 {account:'management@jeclogs.com',kind:'privateemail',keychainService:'openclaw-jeclogs-imap-management'},
];
const dayAt=d=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const requested=process.argv[2];
const audience=process.argv[3];
if(!['owner','management'].includes(audience)||process.argv.length>4)throw new Error('Usage: node collect_daily_email_sources.mjs YYYY-MM-DD owner|management');
const policies=JSON.parse(await fs.readFile(path.join(ROOT,'data/email_inbox/config/report-audiences.json'),'utf8'));
const policy=policies[audience];
const sources=allSources.filter(s=>policy.accounts.includes(s.account));
if(sources.length!==policy.accounts.length)throw new Error('Invalid source policy');
let date=requested;
if(!date){const now=dayAt(new Date());date=new Date(Date.parse(now+'T12:00:00Z')-86400000).toISOString().slice(0,10);}
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Expected YYYY-MM-DD');
const out=path.join(ROOT,'data/email_inbox',audience,date);await fs.mkdir(out,{recursive:true,mode:0o700});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex').slice(0,20);
function cleanBody(x){return String(x||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/https?:\/\/[^\s<>"']+/g,'[link omitted; see original email]').replace(/\b((?:verification|security|one[- ]time|authentication)\s+(?:code|password)\s*[:=]?\s*)[A-Z0-9 -]{4,12}\b/gi,'$1[redacted]');}
const authNotice=s=>/(verification code|one.time (?:code|password)|password reset|reset your password|sign.in code)/i.test(s||'');
const safeName=s=>String(s||'attachment').replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,120);
async function atomicJson(file,data){const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});await fs.rename(tmp,file);}
async function gmail(src){
 // Epoch bounds are determined in Python ZoneInfo, not Gmail's default date timezone.
 const {stdout:bounds}=await run('python3',['-c','import sys,datetime,zoneinfo;d=datetime.date.fromisoformat(sys.argv[1]);z=zoneinfo.ZoneInfo("America/New_York");print(int(datetime.datetime.combine(d,datetime.time(),z).timestamp()),int(datetime.datetime.combine(d+datetime.timedelta(days=1),datetime.time(),z).timestamp()))',date]);
 const [start,end]=bounds.trim().split(' ');
 const query=`in:inbox after:${Number(start)-1} before:${end} -in:spam -in:trash -in:drafts`;
 let j;try{const r=await run('/Users/claw/.local/bin/gog',['gmail','messages','search',query,'--account',src.account,'--max','100','--all','--include-body','--include-attachments','--json','--gmail-no-send','--readonly','--no-input'],{timeout:150000,maxBuffer:40*1024*1024});j=JSON.parse(r.stdout);}catch{return {status:'unavailable',reason:'gmail_authorization_or_api_failed',messages:[]};}
 const warnings=[];if(j.nextPageToken)warnings.push('pagination_incomplete');const messages=[];
 for(const m of j.messages||[]){
  const ms=Date.parse(m.internalDateIso||m.date);if(!Number.isFinite(ms)){warnings.push('message_date_unreadable');continue;}if(ms<Number(start)*1000||ms>=Number(end)*1000)continue;
  const security=authNotice(m.subject);const item={providerId:m.id,threadId:m.threadId,date:m.internalDateIso||m.date,dateBasis:'Gmail internal date',from:m.from,subject:m.subject,body:security?'Authentication notice; content omitted.':cleanBody(m.body),attachments:[],warnings:[]};
  for(const [i,a] of (m.attachments||[]).entries()){
   const meta={name:a.filename||a.name||`attachment-${i}`,mimeType:a.mimeType,size:a.size||a.sizeBytes};
   if(security){meta.status='omitted_security_notice';}
   else if(Number(meta.size)>20*1024*1024){meta.status='too_large';item.warnings.push('attachment_not_read');}
   else {
    const aid=a.attachmentId||a.id;
    if(!aid){meta.status='missing_attachment_id';item.warnings.push('attachment_not_read');}
    else{const dir=path.join(out,src.account,'attachments');await fs.mkdir(dir,{recursive:true,mode:0o700});const target=path.join(dir,hash(m.id+'-'+i)+'-'+safeName(meta.name));try{await run('/Users/claw/.local/bin/gog',['gmail','attachment',m.id,String(aid),'--account',src.account,'--out',target,'--gmail-no-send','--readonly','--no-input'],{timeout:45000,maxBuffer:1024*1024});meta.path=target;meta.status='downloaded';}catch{meta.status='download_failed';item.warnings.push('attachment_not_read');}}
   }item.attachments.push(meta);
  }messages.push(item);
 }
 return {status:warnings.length||messages.some(m=>m.warnings.length)?'partial':'ok',warnings,messages};
}
async function privateEmail(src){
 try{
  const helper=path.join(ROOT,'scripts/collect_privateemail_imap.py');
  const r=await run('python3',[helper,date,src.account,src.keychainService,out],{timeout:180000,maxBuffer:40*1024*1024});
  const result=JSON.parse(r.stdout);
  for(const m of result.messages||[]){
   m.body=authNotice(m.subject)?'Authentication notice; content omitted.':cleanBody(m.body);
   if(authNotice(m.subject))for(const a of m.attachments||[])a.status='omitted_security_notice';
  }
  return result;
 }catch(error){
  const detail=String(error?.stderr||error?.message||'').toLowerCase();
  const reason=detail.includes('keychain credential unavailable')||detail.includes('could not be found in the keychain')?'keychain_credential_unavailable':detail.includes('authentication failed')||detail.includes('login failed')?'privateemail_authentication_failed':'privateemail_imap_failed';
  return {status:'unavailable',reason,messages:[]};
 }
}
const results=[];
const briefSources=[];
for(const src of sources){let r;try{r=src.kind==='gmail'?await gmail(src):await privateEmail(src);}catch{r={status:'unavailable',reason:'collector_error',messages:[]};}const result={account:src.account,kind:src.kind,...r};for(const m of result.messages){m.excludeFromBrief=/^\s*(?:HIGH PRIORITY\s*[—-]\s*)?Daily Operations Brief\s*[—-]/i.test(m.subject||'');m.dedupeKey=m.messageId?m.messageId.replace(/[<>]/g,'').toLowerCase():hash(JSON.stringify([m.from,m.subject,m.date,m.body]));}await atomicJson(path.join(out,src.account+'.json'),result);results.push({account:src.account,status:result.status,reason:result.reason,messageCount:result.messages.length,attachmentCount:result.messages.reduce((n,m)=>n+m.attachments.length,0),warnings:result.warnings||[]});}
// Build a compact, audience-local reading packet. Raw evidence remains available.
// Do not summarize or truncate bodies here: only omit previously generated briefs.
for(const src of sources){
 const archive=src.account+'.json';
 const raw=JSON.parse(await fs.readFile(path.join(out,archive),'utf8'));
 briefSources.push({account:src.account,archive,status:raw.status,reason:raw.reason,warnings:raw.warnings||[],excludedGeneratedBriefs:raw.messages.filter(m=>m.excludeFromBrief).length,messages:raw.messages.filter(m=>!m.excludeFromBrief).map(m=>({id:m.providerId,date:m.date,dateBasis:m.dateBasis,from:m.from,subject:m.subject,dedupeKey:m.dedupeKey,body:m.body,attachments:m.attachments,warnings:m.warnings}))});
}
await atomicJson(path.join(out,'brief-input.json'),{audience,reportDate:date,sources:briefSources});
const status={audience,reportDate:date,timeZone:tz,collectedAt:new Date().toISOString(),scope:'Inbox only, prior local calendar date; archived/sent/spam/trash excluded',sources:results};await atomicJson(path.join(out,'status.json'),status);console.log(JSON.stringify(status,null,2));
