import 'dotenv/config'; import WebSocket from 'ws';
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream', { handshakeTimeout: 60000 });
const T=[0,120,300,600]; const kept=Object.fromEntries(T.map(t=>[t,0])); const last=new Map(); let t0, pos=0;
ws.on('open',()=>{t0=Date.now();ws.send(JSON.stringify({APIKey:process.env.AISSTREAM_API_KEY,BoundingBoxes:[[[-90,-180],[90,180]]],FilterMessageTypes:['PositionReport','StandardClassBPositionReport','ExtendedClassBPositionReport']}))});
ws.on('message',d=>{const m=JSON.parse(d);const id=m.MetaData?.MMSI;if(!id)return;pos++;const now=Date.now();const l=last.get(id)??{};
 for(const t of T){if(!(now-(l[t]??-1e12)<t*1000)){kept[t]++;l[t]=now}} last.set(id,l)});
setTimeout(()=>{const s=(Date.now()-t0)/1000;console.log(JSON.stringify({secs:Math.round(s),posPerSec:+(pos/s).toFixed(1),vessels:last.size,keptPerSecByThrottle:Object.fromEntries(T.map(t=>[t,+(kept[t]/s).toFixed(1)]))}));process.exit(0)},600000);
