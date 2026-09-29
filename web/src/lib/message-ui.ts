export type MessageOption={label:string;value:string};
export type MessageField={id:string;label:string;type:"radio"|"select"|"text"|"textarea"|"number"|"date"|"checkbox"|"checkboxes";required:boolean;placeholder:string;options:MessageOption[]};
export type MessageAction={id:string;label:string;value:string};
export type MessageForm={title:string;fields:MessageField[];actions:MessageAction[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const label=(value:unknown,max=200):value is string=>typeof value==="string"&&!!value.trim()&&value.length<=max;
const id=(value:unknown):value is string=>typeof value==="string"&&/^[a-z][a-z0-9_]{0,39}$/i.test(value)&&!["constructor","prototype","__proto__"].includes(value);
export function parseMessageForm(json:string):MessageForm|null{
 if(json.length>24000)return null;
 try{const raw:unknown=JSON.parse(json);if(!object(raw)||!label(raw.title)||!Array.isArray(raw.fields)||raw.fields.length>8||!Array.isArray(raw.actions)||!raw.actions.length||raw.actions.length>4)return null;
 const fields:MessageField[]=[];const ids=new Set<string>();
 for(const field of raw.fields){if(!object(field)||!id(field.id)||ids.has(field.id)||!label(field.label)||typeof field.type!=="string"||!["radio","select","text","textarea","number","date","checkbox","checkboxes"].includes(field.type))return null;ids.add(field.id);const options:MessageOption[]=[];
 if(["radio","select","checkboxes"].includes(field.type)){if(!Array.isArray(field.options)||!field.options.length||field.options.length>20)return null;for(const option of field.options){if(!object(option)||!label(option.label)||!label(option.value)||options.some(old=>old.value===option.value))return null;options.push({label:option.label,value:option.value});}}
 fields.push({id:field.id,label:field.label,type:field.type as MessageField["type"],required:field.required===true,placeholder:typeof field.placeholder==="string"?field.placeholder.slice(0,200):"",options});}
 const actions:MessageAction[]=[];for(const action of raw.actions){if(!object(action)||!id(action.id)||actions.some(old=>old.id===action.id)||!label(action.label)||!label(action.value,500))return null;actions.push({id:action.id,label:action.label,value:action.value});}
 return {title:raw.title,fields,actions};
 }catch{return null;}
}
export type FormValues=Record<string,string|boolean|string[]>;
export function formResponse(form:MessageForm,values:FormValues,action:MessageAction):string{
 const lines=[form.title];
 for(const field of form.fields){const value=values[field.id];let answer="";
 if(field.type==="checkbox")answer=value===true?"Yes":"No";
 else if(field.type==="checkboxes")answer=field.options.filter(option=>Array.isArray(value)&&value.includes(option.value)).map(option=>option.label).join(", ");
 else if(field.options.length)answer=field.options.find(option=>option.value===value)?.label||"";
 else answer=typeof value==="string"?value.slice(0,4000):"";
 if(field.required&&(!answer||field.type==="checkbox"&&value!==true))throw Error(`Please complete ${field.label}.`);
 if(answer)lines.push(`${field.label}: ${answer}`);
 }
 return [...lines,`Response: ${action.value}`].join("\n");
}
export function messageParts(text:string):({text:string}|{form:MessageForm})[]{
 const match=/```blew-ui\s*\n([\s\S]*?)```/.exec(text);if(!match)return [{text}];const form=parseMessageForm(match[1]);if(!form)return [{text}];return [{text:text.slice(0,match.index)},{form},{text:text.slice(match.index+match[0].length)}];
}

export function messagePreview(text:string){return text.replace(/```blew-(ui|schedule|task)\s*\n[\s\S]*?```/g,(_,kind:string)=>kind==="ui"?"[Interactive choices]":kind==="schedule"?"[Schedule proposal]":"[Linux task]").replace(/[*_`]/g,"").replace(/\+\+/g,"").replace(/\s+/g," ").slice(0,240);}
