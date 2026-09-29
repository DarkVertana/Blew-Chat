"use client";
import {useEffect,useRef,useState} from "react";
import {Mic,MicOff,PhoneOff,Volume2} from "lucide-react";
import {speechChunks} from "@/lib/speech";
export function VoiceCall({name,onMessage,onClose,onPhaseChange}:{name:string;onMessage:(text:string)=>Promise<string>;onClose:()=>void;onPhaseChange?:(phase:string)=>void}){
 const [phase,setPhase]=useState("Starting microphone…");const [error,setError]=useState("");const [muted,setMuted]=useState(false);const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);const [voice,setVoice]=useState("");
 useEffect(()=>{onPhaseChange?.(phase);},[phase,onPhaseChange]);
 const session=useRef({active:true,muted:false});const resume=useRef<()=>void>(()=>{});const interrupt=useRef<()=>void>(()=>{});const handler=useRef(onMessage);const voiceRef=useRef(voice);useEffect(()=>{handler.current=onMessage;voiceRef.current=voice;},[onMessage,voice]);
 useEffect(()=>{
  const state={active:true,muted:false};session.current=state;
  let stream:MediaStream|undefined;let context:AudioContext|undefined;let recorder:MediaRecorder|undefined;let frame=0;let generation=0;let request:AbortController|undefined;
  const updateVoices=()=>setVoices(window.speechSynthesis?.getVoices()||[]);updateVoices();window.speechSynthesis?.addEventListener("voiceschanged",updateVoices);
  function stopCapture(){cancelAnimationFrame(frame);if(recorder?.state==="recording")recorder.stop();}
  function speak(text:string){
   if(!state.active)return;if(!window.speechSynthesis){setError("Speech playback is unavailable in this browser.");listen();return;}
   const chunks=speechChunks(text);let index=0;const current=++generation;
   function next(){if(!state.active||current!==generation)return;if(index>=chunks.length){listen();return;}setPhase("Speaking");const utterance=new SpeechSynthesisUtterance(chunks[index++]);utterance.voice=window.speechSynthesis.getVoices().find(v=>v.voiceURI===voiceRef.current)||null;utterance.onend=next;utterance.onerror=()=>{if(state.active&&current===generation){setError("Speech playback stopped. You can read the reply in chat.");listen();}};window.speechSynthesis.speak(utterance);}
   next();
  }
  function listen(){
   if(!state.active||!stream||!context)return;if(state.muted){setPhase("Microphone muted");return;}
   const current=++generation;setPhase("Listening…");
   const mime=MediaRecorder.isTypeSupported("audio/webm;codecs=opus")?"audio/webm;codecs=opus":MediaRecorder.isTypeSupported("audio/mp4")?"audio/mp4":"";
   recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);const chunks:BlobPart[]=[];
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
   const source=context.createMediaStreamSource(stream);const analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
   const samples=new Float32Array(analyser.fftSize);const started=performance.now();let lastSound=started,speech=0;
   recorder.onstop=async()=>{
    source.disconnect();analyser.disconnect();cancelAnimationFrame(frame);
    if(!state.active||state.muted||current!==generation)return;
    if(speech<250){listen();return;}
    const audio=new Blob(chunks,{type:recorder?.mimeType||"audio/webm"});
    try{setPhase("Transcribing…");request=new AbortController();const response=await fetch("/api/speech/transcribe",{method:"POST",headers:{"Content-Type":audio.type},body:audio,signal:request.signal});const result=await response.json();if(!response.ok)throw Error(result.error);if(!state.active||current!==generation)return;if(!result.text?.trim()){listen();return;}setPhase("Thinking…");const reply=await handler.current(result.text);if(state.active&&current===generation)speak(reply);}
    catch(e){if(state.active&&current===generation){setError(e instanceof Error?e.message:"Voice call interrupted.");setPhase("Paused — press Resume to try again");}}
   };
   recorder.start(250);let previous=started;
   function check(){if(!state.active||state.muted||current!==generation)return;const now=performance.now();analyser.getFloatTimeDomainData(samples);let energy=0;for(const n of samples)energy+=n*n;if(Math.sqrt(energy/samples.length)>0.018){speech+=now-previous;lastSound=now;}previous=now;if((speech>=250&&now-lastSound>1000)||now-started>25000){recorder?.stop();return;}frame=requestAnimationFrame(check);}
   frame=requestAnimationFrame(check);
  }
  resume.current=()=>{generation++;request?.abort();stopCapture();window.speechSynthesis?.cancel();setError("");listen();};
  interrupt.current=resume.current;
  (async()=>{try{if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error("Voice calls need a browser with microphone recording on HTTPS or localhost.");stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!state.active){stream.getTracks().forEach(t=>t.stop());return;}context=new AudioContext();await context.resume();listen();}catch(e){if(state.active){setError(e instanceof Error?e.message:"Microphone access failed.");setPhase("Microphone unavailable");}}})();
  return()=>{state.active=false;generation++;request?.abort();cancelAnimationFrame(frame);stopCapture();stream?.getTracks().forEach(t=>t.stop());void context?.close();window.speechSynthesis?.cancel();window.speechSynthesis?.removeEventListener("voiceschanged",updateVoices);};
 },[]);
 return <div className="space-y-3 border-b border-wa-border bg-wa-green-deep p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-medium">Voice call · {name}</p><p role="status" className="mt-1 text-sm text-wa-muted">{phase}</p></div><button title="End call" aria-label="End call" className="rounded-full bg-red-500 p-3 text-white" onClick={onClose}><PhoneOff size={20}/></button></div>
 <div className="flex flex-wrap items-center gap-2"><button className="flex items-center gap-2 rounded-full border border-wa-border px-3 py-2 text-sm" onClick={()=>{session.current.muted=!muted;setMuted(!muted);interrupt.current();}}>{muted?<MicOff size={16}/>:<Mic size={16}/>} {muted?"Unmute":"Mute"}</button><button className="rounded-full border border-wa-border px-3 py-2 text-sm" onClick={()=>resume.current()}>Interrupt / Resume</button><label className="flex min-w-0 items-center gap-2 text-sm"><Volume2 size={16}/><select aria-label="Bot voice" value={voice} onChange={e=>setVoice(e.target.value)} className="max-w-48 rounded-lg bg-wa-input p-2"><option value="">System voice</option>{voices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select></label></div>
 <p className="text-xs text-wa-muted">Whisper tiny transcribes your speech on the server. Your selected Engine replies; this device speaks it. Listening pauses during replies. Transcripts remain in this bot’s chat; microphone audio is not saved.</p>{error&&<p role="alert" className="text-sm text-red-500">{error}</p>}</div>;
}
