#!/usr/bin/env node
// Install the existing companion as an ordinary user's systemd service.
import {mkdir,copyFile,writeFile,access,chmod,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export function unitArgument(value){
 if(/[\0\r\n]/.test(value))throw Error('Invalid service path');
 return JSON.stringify(value.replaceAll('%','%%').replaceAll('$',()=> '$$'));
}
export function serviceUnit(node,script){
 return `[Unit]
Description=Blew Chats Linux computer agent
After=network.target
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
ExecStart=${unitArgument(node)} ${unitArgument(script)} --service
Restart=on-failure
RestartSec=10
RestartPreventExitStatus=78
TimeoutStopSec=5
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
`;
}
function systemctl(args,optional=false){
 const result=spawnSync('systemctl',['--user',...args],{stdio:'inherit'});
 if(!optional&&(result.error||result.status!==0))throw Error('systemd user service operation failed. Run this inside your Linux user session.');
}
async function main(){
 if(process.platform!=='linux')throw Error('Install this service on the Linux computer the bots will use.');
 if(process.getuid?.()===0)throw Error('Run as your regular desktop user, without sudo.');
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or newer is required.');
 const operation=process.argv[2]||'install';
 if(!['install','uninstall','status','stop','start','logs'].includes(operation))throw Error('Usage: node scripts/linux/companion-service.mjs [install|uninstall|status|stop|start|logs]');
 const config=process.env.XDG_CONFIG_HOME||path.join(homedir(),'.config');
 const directory=path.join(process.env.XDG_DATA_HOME||path.join(homedir(),'.local','share'),'blew-chats','agent');
 const script=path.join(directory,'companion.mjs');
 const unitDirectory=path.join(config,'systemd','user');
 const unitFile=path.join(unitDirectory,'blew-companion.service');
 if(operation==='status'||operation==='stop'||operation==='start'){systemctl([operation,'blew-companion.service']);return;}
 if(operation==='logs'){const r=spawnSync('journalctl',['--user','-u','blew-companion.service','-n','50','--no-pager'],{stdio:'inherit'});if(r.status!==0)throw Error('Could not read agent logs');return;}
 if(operation==='uninstall'){
  systemctl(['disable','--now','blew-companion.service'],true);
  await unlink(unitFile).catch(e=>{if(e.code!=='ENOENT')throw e;});
  systemctl(['daemon-reload']);
  console.log('Service removed. Pairing credentials and downloaded task files are retained. Disconnect this computer in Blew to revoke its access.');return;
 }
 await access(path.join(config,'blew-code','companion.json')).catch(()=>{throw Error('Pair first: node web/public/blew-linux-companion.mjs --pair. Stop that foreground process with Ctrl+C, then rerun this installer.');});
 // Probe systemd before writing. Reinstall updates the same unit, not a second agent.
 systemctl(['list-units','--type=service','--no-pager','--quiet']);
 systemctl(['stop','blew-companion.service'],true);
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
 await copyFile(fileURLToPath(new URL('../../web/public/blew-linux-companion.mjs',import.meta.url)),script);await chmod(script,0o600);
 await mkdir(unitDirectory,{recursive:true});
 await writeFile(unitFile,serviceUnit(process.execPath,script),{mode:0o600});
 const desktopVariables=['DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','XDG_RUNTIME_DIR','XDG_CONFIG_HOME'].filter(key=>process.env[key]);
 if(desktopVariables.length)systemctl(['import-environment',...desktopVariables]);
 systemctl(['daemon-reload']);systemctl(['enable','--now','blew-companion.service']);
 console.log('Blew agent installed. It starts with your user session. Close the browser freely; the agent keeps running. Use stop to pause it. Desktop tools still require a graphical session.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
