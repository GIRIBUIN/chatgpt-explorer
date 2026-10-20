import { it, expect, vi, afterEach } from 'vitest';
import { AutoSync, IDLE_MS, type AutoState, type AutoPorts } from '../src/sync/auto';
import { payload } from '../src/sync/payload';
import { hash, credentials } from '../src/sync/crypto';
import { defaults, addConversation } from '../src/models/state';
import type { Local, Preview, SyncStore } from '../src/sync/client';
import { SyncClient } from '../src/sync/client';
import { SyncApi } from '../src/sync/api';
import { server } from '../sync-server/tests/harness';
import { syncCode } from '../src/sync/crypto';
import { webext } from '../src/utils/browser';
import { manifestFor } from '../scripts/manifest';
import { installAutoSync } from '../src/sync/background';
const origin = 'https://sync.example.com';
it('normal browser window is not registered even if it contains an Explorer tab',async()=>{
 const {discoverExplorerWindow}=await import('../src/sync/window');const set=vi.fn();vi.stubGlobal('browser',undefined);vi.stubGlobal('chrome',{runtime:{getURL:()=> 'extension://explorer.html'},storage:{session:{set}},windows:{getAll:async()=>[{id:5,type:'normal',tabs:[{url:'extension://explorer.html'}]}]}});await discoverExplorerWindow();expect(set).not.toHaveBeenCalled();
});
it('clean close makes no request',async()=>{const f=await fixture();await f.auto.close();expect(f.sync).not.toHaveBeenCalled();});
it('dirty close flushes immediately and clears dirty/alarm',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();await f.auto.close();expect(f.sync).toHaveBeenCalledExactlyOnceWith(true);expect(f.state().dirty).toBe(false);expect(f.alarm()).toBeNull();
});
it('OFF prevents close flush',async()=>{const f=await fixture();f.edit();await f.auto.changed();await f.auto.setEnabled(false);await f.auto.close();expect(f.sync).not.toHaveBeenCalled();expect(f.state().dirty).toBe(true);});
it('disconnected close makes no request',async()=>{const f=await fixture();f.local.sync=null;f.edit();await f.auto.close();expect(f.sync).not.toHaveBeenCalled();});
it('failed close preserves dirty, synced baseline and idle deadline',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();const baseline=structuredClone(f.local.sync),deadline=f.alarm();f.sync.mockRejectedValueOnce(Error('offline'));await f.auto.close();expect(f.local.sync).toEqual(baseline);expect(f.state().dirty).toBe(true);expect(f.state().scheduledAt).toBe(deadline);expect(f.alarm()).toBe(deadline);
});
it('failed close does not invent a retry alarm',async()=>{const f=await fixture();f.sync.mockRejectedValueOnce(Error());await f.auto.startup();f.sync.mockRejectedValueOnce(Error());await f.auto.close();expect(f.state().dirty).toBe(true);expect(f.alarm()).toBeNull();});
it('close after idle success makes no duplicate request',async()=>{const f=await fixture();f.edit();await f.auto.changed();f.time(301000);await f.auto.alarm();await f.auto.close();expect(f.sync).toHaveBeenCalledTimes(1);});
it('alarm after close success is a no-op',async()=>{const f=await fixture();f.edit();await f.auto.changed();await f.auto.close();f.time(301000);await f.auto.alarm();expect(f.sync).toHaveBeenCalledTimes(1);});
it.each(['alarm-first','close-first'] as const)('%s race attempts only once even on failure',async order=>{
 const f=await fixture();f.edit();await f.auto.changed();f.time(301000);f.sync.mockRejectedValueOnce(Error());const one=order==='alarm-first'?f.auto.alarm():f.auto.close();const two=order==='alarm-first'?f.auto.close():f.auto.alarm();await Promise.all([one,two]);expect(f.sync).toHaveBeenCalledTimes(1);
});
it('close conflict stays pending without overwriting local metadata',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();const before=structuredClone(f.local);f.ports.sync=async()=>({kind:'conflict',remote:{revision:2}} as Preview);await f.auto.close();expect(f.local).toEqual(before);expect(f.state().conflict).toBe(true);expect(f.state().dirty).toBe(true);
});
it('restart recovers idle deadline and startup after failed close',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();f.sync.mockRejectedValueOnce(Error());await f.auto.close();const restarted=new AutoSync(f.ports);await f.ports.schedule(null);await restarted.recover();expect(f.alarm()).toBe(301000);await restarted.startup();expect(f.sync).toHaveBeenCalledTimes(2);expect(f.state().dirty).toBe(false);
});
it('manual sync in flight prevents another close request',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();const deadline=f.alarm();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const fetcher=vi.fn(async()=>{await gate;throw Error('test network end');});const client=new SyncClient(new SyncApi(origin,fetcher),{read:async()=>structuredClone(f.local),transaction:async()=>{}});
 const manual=client.now().catch(()=>{});await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));f.ports.sync=dirty=>client.now(dirty);await f.auto.close();expect(fetcher).toHaveBeenCalledTimes(1);expect(f.alarm()).toBe(deadline);expect(f.state().error).toBeNull();release();await manual;
});
it('close client rechecks a clean hash before GET',async()=>{const f=await fixture(),fetcher=vi.fn();const client=new SyncClient(new SyncApi(origin,fetcher),{read:async()=>f.local,transaction:async()=>{}});expect(await client.now(true)).toEqual({kind:'none'});expect(fetcher).not.toHaveBeenCalled();});
it.each(['chromium','firefox'] as const)('%s consumes only Explorer popup close once',async target=>{
 const {discoverExplorerWindow,consumeExplorerClose,EXPLORER_WINDOW_KEY}=await import('../src/sync/window');const data:Record<string,unknown>={};const api={storage:{session:{get:async()=>data,set:async(v:object)=>{Object.assign(data,v);},remove:async(k:string)=>{delete data[k];}}},runtime:{getURL:()=> 'extension://explorer.html'},windows:{getAll:async()=>[{id:11,type:'normal',tabs:[{url:'https://chatgpt.com/'}]},{id:12,type:'popup',tabs:[{url:'extension://explorer.html'}]}]}};
 vi.stubGlobal('browser',target==='firefox'?api:undefined);vi.stubGlobal('chrome',api);await discoverExplorerWindow();expect(data[EXPLORER_WINDOW_KEY]).toBe(12);expect(await consumeExplorerClose(11)).toBe(false);expect(await consumeExplorerClose(12)).toBe(true);expect(await consumeExplorerClose(12)).toBe(false);
});
it('window identity survives worker memory loss in session storage',async()=>{
 const {consumeExplorerClose,EXPLORER_WINDOW_KEY}=await import('../src/sync/window');const data:Record<string,unknown>={[EXPLORER_WINDOW_KEY]:90};vi.stubGlobal('browser',undefined);vi.stubGlobal('chrome',{storage:{session:{get:async()=>data,remove:async(k:string)=>{delete data[k];}}}});expect(await consumeExplorerClose(90)).toBe(true);
});
async function fixture() {
 let time=1000, saved: AutoState | undefined, alarm: number | null=null;
 const local: Local = {state: defaults(), sync: { ...credentials(origin), lastSyncedRevision:1, lastSyncedPayloadHash: await hash(payload(defaults())), lastSyncedAt:1 }};
 const sync = vi.fn(async () => {
   local.sync!.lastSyncedPayloadHash=await hash(payload(local.state));
   return {kind:'done'} as const;
 });
 const ports: AutoPorts = {local:async()=>local, read:async()=>saved && structuredClone(saved), write:async a=>{saved=structuredClone(a);},
  schedule:async when=>{alarm=when;}, now:()=>time, sync, result:async()=>{} };
 const auto = new AutoSync(ports);
 await auto.recover();
 return {auto, ports, local, sync, state:()=>saved!, alarm:()=>alarm, time:(n:number)=>{time=n;},
  edit:()=>{local.state=addConversation(local.state, 'Chat', 'https://chatgpt.com/c/test',null).state;},
  rename:()=>{local.state.conversations[0].title+=' edited';} };
}
it('durable mutation marks dirty and schedules one-shot five-minute alarm',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();expect(f.state().dirty).toBe(true);expect(f.alarm()).toBe(1000+IDLE_MS);
});
it('another mutation reschedules from latest edit and coalesces to one push',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();f.time(100000);f.rename();await f.auto.changed();expect(f.alarm()).toBe(400000);
 f.time(400000);await f.auto.alarm();await f.auto.alarm();expect(f.sync).toHaveBeenCalledTimes(1);expect(f.state().dirty).toBe(false);expect(f.alarm()).toBeNull();
});
it('early alarm cannot sync before five minutes since last edit',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();f.time(2000);await f.auto.alarm();expect(f.sync).not.toHaveBeenCalled();expect(f.alarm()).toBe(301000);
});
it('Auto Sync off removes alarm but preserves local dirty state',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();await f.auto.setEnabled(false);f.time(400000);await f.auto.alarm();await f.auto.startup();expect(f.sync).not.toHaveBeenCalled();expect(f.alarm()).toBeNull();expect(f.state().dirty).toBe(true);
});
it('turning auto back on schedules pending change',async()=>{
 const f=await fixture();await f.auto.setEnabled(false);f.edit();await f.auto.changed();await f.auto.setEnabled(true);expect(f.alarm()).toBe(301000);
});
it('connected migration defaults ON and startup checks remote once',async()=>{
 const f=await fixture();expect(f.state().enabled).toBe(true);await f.auto.startup();expect(f.sync).toHaveBeenCalledTimes(1);
});
it('disconnected startup and alarms never make network requests',async()=>{
 const f=await fixture();f.local.sync=null;f.edit();await f.auto.changed();await f.auto.startup();await f.auto.alarm();expect(f.sync).not.toHaveBeenCalled();expect(f.alarm()).toBeNull();
});
it('non-syncable selection/search/window/filter state does not create dirty work',async()=>{
 const f=await fixture();f.local.state.settings.colorFilter='#ffffff';f.local.state.settings.projectFilter='all';f.local.state.settings.alwaysCentered=true;
 await f.auto.changed();expect(f.state().dirty).toBe(false);expect(f.alarm()).toBeNull();
});
it('manual success clears dirty and pending alarm including while auto is off',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();await f.auto.setEnabled(false);await f.sync();await f.auto.manualSuccess();expect(f.state().dirty).toBe(false);expect(f.alarm()).toBeNull();
});
it('network failure keeps dirty and baseline; recovery does not retry failed attempt',async()=>{
 const f=await fixture();const baseline=f.local.sync!.lastSyncedPayloadHash;f.edit();await f.auto.changed();f.sync.mockRejectedValueOnce(Error('offline'));f.time(301000);await f.auto.alarm();
 expect(f.state().dirty).toBe(true);expect(f.state().error).toBeTruthy();expect(f.local.sync!.lastSyncedPayloadHash).toBe(baseline);expect(f.alarm()).toBeNull();
 await new AutoSync(f.ports).recover();await new AutoSync(f.ports).alarm();expect(f.sync).toHaveBeenCalledTimes(1);
});
it('a new mutation after failure schedules another attempt',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();f.sync.mockRejectedValueOnce(Error());f.time(301000);await f.auto.alarm();f.time(400000);f.rename();await f.auto.changed();expect(f.alarm()).toBe(700000);
});
it('restart recovers missing alarm from persisted dirty deadline without network',async()=>{
 const f=await fixture();f.edit();await f.auto.changed();await f.ports.schedule(null);await new AutoSync(f.ports).recover();expect(f.alarm()).toBe(301000);expect(f.sync).not.toHaveBeenCalled();
});
it('failure on remote-only startup still records dirty and error',async()=>{
 const f=await fixture();f.sync.mockRejectedValueOnce(Error());await f.auto.startup();await f.auto.recover();expect(f.state().dirty).toBe(true);expect(f.state().error).toBeTruthy();expect(f.alarm()).toBeNull();
});
it('manual success clears previous automatic error',async()=>{
 const f=await fixture();f.sync.mockRejectedValueOnce(Error());await f.auto.startup();await f.sync();await f.auto.manualSuccess();expect(f.state().dirty).toBe(false);expect(f.state().error).toBeNull();
});
it('automatic pull uses existing backup and conflict never overwrites local data',async()=>{
 const backend=server();
 try {
  const api=new SyncApi(origin,backend.fetcher);
  const make=()=>{
   const local:Local={state:defaults(),sync:null}, backups:unknown[]=[];
   const store:SyncStore={read:async()=>structuredClone(local), transaction:async fn=>{const change=await fn(structuredClone(local));if(change.backup)backups.push(structuredClone(local.state));if(change.state)local.state=change.state;if(change.sync!==undefined)local.sync=change.sync;}};
   return {local,backups,client:new SyncClient(api,store)};
  };
  const a=make(),b=make();await a.client.enable();await b.client.resolve(await b.client.connect(syncCode(a.local.sync!)),'remote');
  const f=await fixture();f.ports.local=async()=>b.local;f.ports.sync=()=>b.client.now();const auto=new AutoSync(f.ports);await auto.recover();
  a.local.state=addConversation(a.local.state,'Remote','https://chatgpt.com/c/remote',null).state;await a.client.now();await auto.startup();expect(b.local.state.conversations).toHaveLength(1);expect(b.backups).toHaveLength(2);
  a.local.state.conversations[0].title='A';b.local.state.conversations[0].title='B';await a.client.now();await auto.changed();await auto.startup();expect(f.state().conflict).toBe(true);expect(f.state().dirty).toBe(true);expect(b.local.state.conversations[0].title).toBe('B');
 } finally {backend.db.close();}
});
it('conflict result is delivered for existing UI resolution',async()=>{
 const f=await fixture();const conflict={kind:'conflict'} as Preview;f.ports.sync=async()=>conflict;const received=vi.fn();f.ports.result=received;
 await new AutoSync(f.ports).startup();expect(received).toHaveBeenCalledWith(conflict);
});
afterEach(()=>vi.unstubAllGlobals());
it.each(['chromium','firefox'] as const)('%s shared alarms path recovers one-shot schedule',async target=>{
 const f=await fixture();f.edit();const data:Record<string,unknown>={explorerState:f.local.state,explorerSync:f.local.sync};
 const listener=()=>({addListener:vi.fn()});
 const api={storage:{local:{get:vi.fn(async()=>data),set:vi.fn(async (v:object)=>{Object.assign(data,v);})},onChanged:listener()},alarms:{create:vi.fn(),clear:vi.fn(),onAlarm:listener()},runtime:{onMessage:listener(),onStartup:listener(),getURL:()=>'',id:'test'}};
 vi.stubGlobal('browser',target==='firefox'?api:undefined);vi.stubGlobal('chrome',api);
 expect(webext()).toBe(api);expect(manifestFor(target).permissions).toContain('alarms');installAutoSync();await vi.waitFor(()=>expect(api.alarms.create).toHaveBeenCalled());
 expect(api.alarms.create.mock.calls[0][1]).not.toHaveProperty('periodInMinutes');
});

it('storage adapter rejects a remote apply if a local edit lands during its network wait', async()=>{
 const {extensionSyncStore}=await import('../src/sync/store');
 const f=await fixture();f.edit();
 const data:Record<string,unknown>={explorerState:f.local.state,explorerSync:f.local.sync};
 const set=vi.fn(async(v:object)=>{Object.assign(data,v);});
 vi.stubGlobal('browser',undefined);vi.stubGlobal('chrome',{storage:{local:{get:async()=>structuredClone(data),set}}});
 await expect(extensionSyncStore.transaction(async before=>{
   const edited=structuredClone(before.state);edited.conversations[0].title='Saved while fetching remote';
   data.explorerState=edited;
   return {state:defaults(),backup:true};
 })).rejects.toThrow('stale');
 expect((data.explorerState as Local['state']).conversations[0].title).toBe('Saved while fetching remote');
 expect(set).not.toHaveBeenCalled();
});
it('storage adapter writes backup before remote snapshot and credentials',async()=>{
 const {extensionSyncStore}=await import('../src/sync/store');
 const f=await fixture();f.edit();const data:Record<string,unknown>={explorerState:f.local.state,explorerSync:f.local.sync};
 const writes:object[]=[];
 vi.stubGlobal('browser',undefined);vi.stubGlobal('chrome',{storage:{local:{get:async()=>structuredClone(data),set:async(v:object)=>{writes.push(v);Object.assign(data,v);}}}});
 await extensionSyncStore.transaction(async()=>({state:defaults(),sync:f.local.sync,backup:true}));
 expect(writes[0]).toHaveProperty('workspaceBackup');expect(writes[1]).toHaveProperty('explorerState');expect(writes[1]).toHaveProperty('explorerSync');
});

it('Disconnect can remove invalid saved credentials without changing workspace',async()=>{
 const {extensionSyncStore}=await import('../src/sync/store');
 const original=defaults(), data:Record<string,unknown>={explorerState:original,explorerSync:{invalid:true}};
 vi.stubGlobal('browser',undefined);vi.stubGlobal('chrome',{storage:{local:{get:async()=>structuredClone(data),set:async(v:object)=>{Object.assign(data,v);},remove:async(k:string)=>{delete data[k];}}}});
 await expect(extensionSyncStore.read()).rejects.toThrow('credentials');
 await extensionSyncStore.transaction(async()=>({sync:null}));
 expect(data.explorerSync).toBeUndefined();expect(data.explorerState).toEqual(original);
});
